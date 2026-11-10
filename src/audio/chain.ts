// The effect chain. The SAME class is instantiated on the live AudioContext and
// on the OfflineAudioContext used for export, so the export matches the preview.
//
//  input → fade gain → [HPF → LPF] → bass shelf → EQ(low/mid/high) → reverb(dry+wet)
//        → balance → output gain → [limiter] → output

import { dbToGain, type EffectParams } from './params'
import { generateImpulse } from './reverb'

const RAMP = 0.012
// Web Audio interprets Q of lowpass/highpass biquads in dB, so a flat (Butterworth)
// 2nd-order response is 20·log10(1/√2) ≈ −3.01 dB, not 0.707.
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2)

/** A wet/dry switch so a stage can be bypassed for real (no processing in path). */
class BypassStage {
  readonly input: GainNode
  readonly output: GainNode
  private wet: GainNode
  private dry: GainNode
  constructor(ctx: BaseAudioContext, first: AudioNode, last: AudioNode) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.input.connect(first)
    last.connect(this.wet).connect(this.output)
    this.input.connect(this.dry).connect(this.output)
  }
  set(enabled: boolean, ctx: BaseAudioContext, immediate: boolean) {
    setParam(this.wet.gain, enabled ? 1 : 0, ctx, immediate)
    setParam(this.dry.gain, enabled ? 0 : 1, ctx, immediate)
  }
}

function setParam(p: AudioParam, v: number, ctx: BaseAudioContext, immediate: boolean) {
  if (immediate) {
    p.cancelScheduledValues(0)
    p.value = v
  } else {
    p.setTargetAtTime(v, ctx.currentTime, RAMP)
  }
}

export class EffectChain {
  readonly input: GainNode
  readonly output: GainNode
  /** Automated by the engine/renderer for fade in/out. */
  readonly fade: GainNode

  private ctx: BaseAudioContext
  private hp: BiquadFilterNode
  private lp: BiquadFilterNode
  private filterStage: BypassStage
  private bass: BiquadFilterNode
  private low: BiquadFilterNode
  private mid: BiquadFilterNode
  private high: BiquadFilterNode
  private dry: GainNode
  private wet: GainNode
  private preDelay: DelayNode
  private wetHp1: BiquadFilterNode
  private wetHp2: BiquadFilterNode
  private convolver: ConvolverNode
  private panner: StereoPannerNode
  private outGain: GainNode
  private limiter: DynamicsCompressorNode
  private limiterMakeup: GainNode
  private limiterStage: BypassStage
  private clipper: WaveShaperNode
  private clipKey = NaN
  private irKey = ''

  constructor(ctx: BaseAudioContext, params: EffectParams) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.fade = ctx.createGain()

    this.hp = new BiquadFilterNode(ctx, { type: 'highpass', Q: BUTTERWORTH_Q_DB })
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', Q: BUTTERWORTH_Q_DB })
    this.hp.connect(this.lp)
    this.filterStage = new BypassStage(ctx, this.hp, this.lp)

    this.bass = new BiquadFilterNode(ctx, { type: 'lowshelf' })
    this.low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 250 })
    this.mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.8 })
    this.high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000 })

    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.preDelay = new DelayNode(ctx, { maxDelayTime: 0.5 })
    this.convolver = new ConvolverNode(ctx, { disableNormalization: true })
    // 24 dB/oct high-pass on the reverb send: the dry signal keeps its full low end,
    // but bass and low-mids don't smear into a long tail (the main source of mud).
    this.wetHp1 = new BiquadFilterNode(ctx, { type: 'highpass', Q: 20 * Math.log10(0.5412) })
    this.wetHp2 = new BiquadFilterNode(ctx, { type: 'highpass', Q: 20 * Math.log10(1.3066) })
    const reverbSum = ctx.createGain()

    this.panner = new StereoPannerNode(ctx)
    this.outGain = ctx.createGain()

    this.limiter = new DynamicsCompressorNode(ctx, { knee: 0, ratio: 20, attack: 0.001, release: 0.08 })
    this.limiterMakeup = ctx.createGain()
    // The compressor catches most peaks smoothly; the shaper after it is a
    // transparent-below-knee safety ceiling so nothing can exceed the limit.
    this.clipper = new WaveShaperNode(ctx, { oversample: 'none' })
    this.limiter.connect(this.limiterMakeup).connect(this.clipper)
    this.limiterStage = new BypassStage(ctx, this.limiter, this.clipper)

    // Fades sit before the reverb so faded/trimmed endings still ring out naturally.
    this.input.connect(this.fade).connect(this.filterStage.input)
    this.filterStage.output.connect(this.bass).connect(this.low).connect(this.mid).connect(this.high)
    this.high.connect(this.dry).connect(reverbSum)
    this.high.connect(this.preDelay).connect(this.wetHp1).connect(this.wetHp2).connect(this.convolver).connect(this.wet).connect(reverbSum)
    reverbSum.connect(this.panner).connect(this.outGain).connect(this.limiterStage.input)
    this.limiterStage.output.connect(this.output)

    this.update(params, true)
  }

  update(p: EffectParams, immediate = false) {
    const ctx = this.ctx
    const nyq = ctx.sampleRate / 2

    this.filterStage.set(p.filters.enabled, ctx, immediate)
    setParam(this.hp.frequency, Math.min(p.filters.highpass, nyq * 0.9), ctx, immediate)
    setParam(this.lp.frequency, Math.min(p.filters.lowpass, nyq * 0.98), ctx, immediate)

    setParam(this.bass.frequency, p.bass.frequency, ctx, immediate)
    setParam(this.bass.gain, p.bass.enabled ? p.bass.gain : 0, ctx, immediate)

    const eqOn = p.eq.enabled
    setParam(this.low.gain, eqOn ? p.eq.low : 0, ctx, immediate)
    setParam(this.mid.gain, eqOn ? p.eq.mid : 0, ctx, immediate)
    setParam(this.high.gain, eqOn ? p.eq.high : 0, ctx, immediate)

    const r = p.reverb
    const mix = r.enabled ? r.mix : 0
    setParam(this.dry.gain, Math.cos((mix * Math.PI) / 2), ctx, immediate)
    setParam(this.wet.gain, Math.sin((mix * Math.PI) / 2), ctx, immediate)
    setParam(this.preDelay.delayTime, r.preDelay / 1000, ctx, immediate)
    const lowCut = Math.min(Number.isFinite(r.lowCut) ? r.lowCut : 20, nyq * 0.5)
    setParam(this.wetHp1.frequency, lowCut, ctx, immediate)
    setParam(this.wetHp2.frequency, lowCut, ctx, immediate)
    const key = [r.roomSize, r.decay, r.damping, r.width].map((v) => v.toFixed(3)).join('|')
    if (key !== this.irKey && (r.enabled || !this.convolver.buffer)) {
      this.irKey = key
      this.convolver.buffer = generateImpulse(ctx.sampleRate, r)
    }

    const v = p.volume
    setParam(this.panner.pan, v.enabled ? v.balance : 0, ctx, immediate)
    setParam(this.outGain.gain, v.enabled ? dbToGain(v.outputGain) : 1, ctx, immediate)

    this.limiterStage.set(p.limiter.enabled, ctx, immediate)
    // Compressor threshold at the ceiling with 20:1 and a fast attack works as a
    // peak limiter; a tiny trim keeps overshoot below the ceiling.
    setParam(this.limiter.threshold, p.limiter.ceiling - 0.5, ctx, immediate)
    setParam(this.limiterMakeup.gain, 1, ctx, immediate)
    if (p.limiter.ceiling !== this.clipKey) {
      this.clipKey = p.limiter.ceiling
      this.clipper.curve = ceilingCurve(dbToGain(p.limiter.ceiling))
    }
  }

  /** Extra seconds of output to render so the reverb tail can ring out. */
  static tailSeconds(p: EffectParams) {
    if (!p.reverb.enabled || p.reverb.mix <= 0) return 0
    return Math.min(12, p.reverb.decay * 1.1 + p.reverb.preDelay / 1000 + 0.1)
  }

  disconnect() {
    this.output.disconnect()
  }
}

/** Identity up to 85% of the ceiling, then a tanh knee that never exceeds it. */
function ceilingCurve(ceiling: number): Float32Array<ArrayBuffer> {
  const n = 16385
  const curve = new Float32Array(n)
  const knee = ceiling * 0.85
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee))
    curve[i] = Math.sign(x) * Math.min(y, ceiling)
  }
  return curve
}

/**
 * Schedule fade automation on a gain param.
 * Output timeline (seconds of processed audio) runs 0..outLen across the active
 * range; `outPos` is where playback starts within it, at context time `when`.
 */
export function scheduleFades(
  param: AudioParam,
  when: number,
  outPos: number,
  outLen: number,
  fadeIn: number,
  fadeOut: number,
) {
  param.cancelScheduledValues(0)
  const fi = Math.max(0, Math.min(fadeIn, outLen))
  const fo = Math.max(0, Math.min(fadeOut, outLen - fi))
  const foStart = outLen - fo
  const gainAt = (o: number) => {
    let g = 1
    if (fi > 0 && o < fi) g = Math.min(g, o / fi)
    if (fo > 0 && o > foStart) g = Math.min(g, Math.max(0, (outLen - o) / fo))
    return Math.max(0, g)
  }
  param.setValueAtTime(gainAt(outPos), when)
  if (fi > 0 && outPos < fi) param.linearRampToValueAtTime(1, when + (fi - outPos))
  if (fo > 0) {
    if (outPos < foStart) param.setValueAtTime(1, when + (foStart - outPos))
    if (outPos < outLen) param.linearRampToValueAtTime(0, when + (outLen - outPos))
  }
}

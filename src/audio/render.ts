// Offline (faster-than-real-time) render of the processed mix for export.
// Uses the identical EffectChain + fade scheduling the live preview uses.

import { EffectChain, scheduleFades } from './chain'
import { processingPlan, type EffectParams } from './params'
import type { ProcessedBuffer } from './engine'

export interface RenderOptions {
  processed: ProcessedBuffer
  params: EffectParams
  /** Original-song seconds. */
  start: number
  end: number
  fadeIn: number
  fadeOut: number
  includeTail: boolean
  onProgress?: (p: number) => void
}

export async function renderMix(o: RenderOptions): Promise<AudioBuffer> {
  const plan = processingPlan(o.params)
  const proc = o.processed
  const sr = proc.buffer.sampleRate
  const rate = proc.tempo === 1 ? plan.playbackRate : 1
  const origRate = proc.tempo * rate
  const outLen = (o.end - o.start) / origRate
  const tail = o.includeTail ? EffectChain.tailSeconds(o.params) : 0
  const frames = Math.max(1, Math.ceil((outLen + tail) * sr))

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: sr })
  const chain = new EffectChain(ctx, o.params)
  chain.output.connect(ctx.destination)
  const src = new AudioBufferSourceNode(ctx, { buffer: proc.buffer, playbackRate: rate })
  src.connect(chain.input)
  src.start(0, o.start / proc.tempo)
  src.stop(outLen)
  scheduleFades(chain.fade.gain, 0, 0, outLen, o.fadeIn, o.fadeOut)

  if (o.onProgress) {
    const total = frames / sr
    const steps = 40
    for (let i = 1; i < steps; i++) {
      // suspend() times must be quantised to the 128-frame render quantum.
      const t = (Math.floor(((total * i) / steps) * (sr / 128)) * 128) / sr
      if (t <= 0 || t >= total) continue
      ctx.suspend(t).then(() => {
        o.onProgress!(t / total)
        ctx.resume()
      }).catch(() => {})
    }
  }
  const out = await ctx.startRendering()
  o.onProgress?.(1)
  return out
}

export function interleave(buf: AudioBuffer): Float32Array {
  const l = buf.getChannelData(0)
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l
  const out = new Float32Array(buf.length * 2)
  for (let i = 0, j = 0; i < buf.length; i++, j += 2) {
    out[j] = l[i]
    out[j + 1] = r[i]
  }
  return out
}

export function peakDb(buf: AudioBuffer) {
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i])
      if (a > peak) peak = a
    }
  }
  return 20 * Math.log10(peak || 1e-9)
}

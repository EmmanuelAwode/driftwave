// Real-time preview engine.
//
// Time model: everything the UI sees ("position", region, trim) is in ORIGINAL
// song seconds. The processed buffer may be time-stretched by factor `tempo`
// (bufferTime = origTime / tempo) and is played at `playbackRate`; original
// time therefore advances at tempo × playbackRate (= speed) per real second.

import { EffectChain, scheduleFades } from './chain'
import { clone, DEFAULT_PARAMS, processingPlan, type EffectParams } from './params'

export interface ProcessedBuffer {
  buffer: AudioBuffer
  tempo: number
  key: string
}

export type RenderFn = (tempo: number, pitchRatio: number) => Promise<AudioBuffer>

export interface PlaybackRange {
  start: number
  end: number
}

export interface EngineSnapshot {
  playing: boolean
  rendering: boolean
  renderError: string | null
}

type Listener = (s: EngineSnapshot) => void

export class AudioEngine {
  ctx: AudioContext | null = null
  private chain: EffectChain | null = null
  private monitor: GainNode | null = null
  analyserL: AnalyserNode | null = null
  analyserR: AnalyserNode | null = null
  spectrum: AnalyserNode | null = null

  original: AudioBuffer | null = null
  processed: ProcessedBuffer | null = null
  params: EffectParams = clone(DEFAULT_PARAMS)
  private renderFn: RenderFn | null = null

  private source: AudioBufferSourceNode | null = null
  private startCtx = 0
  private startOrig = 0
  private origRate = 1
  private pausedAt = 0
  private range: PlaybackRange = { start: 0, end: 0 }
  private loop = false
  private fadeIn = 0
  private fadeOut = 0
  private masterVolume = 0.9

  private snapshot: EngineSnapshot = { playing: false, rendering: false, renderError: null }
  private listeners = new Set<Listener>()
  private renderSeq = 0
  private renderTimer: number | null = null
  private pendingRender: Promise<void> | null = null
  private tickTimer: number | null = null

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    fn(this.snapshot)
    return () => this.listeners.delete(fn)
  }
  private emit(patch: Partial<EngineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((l) => l(this.snapshot))
  }
  get isPlaying() {
    return this.snapshot.playing
  }

  /** Load a decoded track. A new AudioContext is created at the track's sample
   *  rate so live processing runs at exactly the same rate as the export. */
  async load(buffer: AudioBuffer, renderFn: RenderFn) {
    this.stopSource()
    this.emit({ playing: false, rendering: false, renderError: null })
    if (!this.ctx || this.ctx.sampleRate !== buffer.sampleRate) {
      await this.ctx?.close().catch(() => {})
      this.ctx = new AudioContext({ sampleRate: buffer.sampleRate, latencyHint: 'interactive' })
      this.buildGraph()
    }
    this.original = buffer
    this.renderFn = renderFn
    this.processed = { buffer, tempo: 1, key: 'original' }
    this.pausedAt = 0
    this.range = { start: 0, end: buffer.duration }
    this.renderSeq++
    this.cache.clear()
    this.finishPending()
    this.scheduleRender(0)
    this.startTicker()
  }

  private buildGraph() {
    const ctx = this.ctx!
    this.chain = new EffectChain(ctx, this.params)
    this.monitor = ctx.createGain()
    this.monitor.gain.value = this.masterVolume
    const split = ctx.createChannelSplitter(2)
    this.analyserL = new AnalyserNode(ctx, { fftSize: 2048 })
    this.analyserR = new AnalyserNode(ctx, { fftSize: 2048 })
    this.spectrum = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0.78 })
    // Meters measure the rendered signal (pre-monitor) so the clip light reflects the export.
    this.chain.output.connect(split)
    split.connect(this.analyserL, 0)
    split.connect(this.analyserR, 1)
    this.chain.output.connect(this.spectrum)
    this.chain.output.connect(this.monitor).connect(ctx.destination)
  }

  get duration() {
    return this.original?.duration ?? 0
  }

  setParams(p: EffectParams) {
    const prevPlan = processingPlan(this.params)
    this.params = clone(p)
    this.chain?.update(this.params)
    const plan = processingPlan(this.params)
    if (plan.key !== prevPlan.key) {
      this.scheduleRender(220)
    }
    // Classic mode: speed is live via playbackRate — rebase without restarting.
    if (this.source && this.processed) {
      const rate = this.rateFor(this.processed)
      if (Math.abs(this.source.playbackRate.value - rate) > 1e-6) {
        const pos = this.position
        const now = this.ctx!.currentTime
        this.source.playbackRate.setValueAtTime(rate, now)
        this.startOrig = pos
        this.startCtx = now
        this.origRate = this.processed.tempo * rate
        this.applyFades(pos, now)
      }
    }
  }

  setMasterVolume(v: number) {
    this.masterVolume = v
    if (this.monitor && this.ctx) this.monitor.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015)
  }

  setPlaybackRange(range: PlaybackRange, loop: boolean) {
    const changed = range.start !== this.range.start || range.end !== this.range.end
    this.range = { start: Math.max(0, range.start), end: Math.min(this.duration, range.end) }
    this.loop = loop
    if (changed && this.source) {
      const pos = this.position
      if (pos < this.range.start || pos > this.range.end) this.restartAt(this.range.start)
      else this.applyFades(pos, this.ctx!.currentTime)
    }
  }

  setFades(fadeIn: number, fadeOut: number) {
    this.fadeIn = fadeIn
    this.fadeOut = fadeOut
    if (this.source) this.applyFades(this.position, this.ctx!.currentTime)
  }

  /** Current position in original-song seconds. */
  get position(): number {
    if (!this.source || !this.ctx) return this.pausedAt
    return this.startOrig + (this.ctx.currentTime - this.startCtx) * this.origRate
  }

  private resolvePending: (() => void) | null = null
  private cache = new Map<string, ProcessedBuffer>()

  private finishPending() {
    this.resolvePending?.()
    this.resolvePending = null
    this.pendingRender = null
  }

  private scheduleRender(delay: number) {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = null
    if (!this.original) return
    const plan = processingPlan(this.params)
    const cached = plan.needsRender ? this.cache.get(plan.key) : undefined
    if (!plan.needsRender || this.processed?.key === plan.key || cached) {
      this.renderSeq++ // invalidate any in-flight render
      if (!plan.needsRender && this.processed?.key !== 'original') {
        this.swapProcessed({ buffer: this.original, tempo: 1, key: 'original' })
      } else if (cached && this.processed?.key !== plan.key) {
        this.swapProcessed(cached)
      }
      this.emit({ rendering: false, renderError: null })
      this.finishPending()
      return
    }
    this.emit({ rendering: true, renderError: null })
    if (!this.pendingRender) this.pendingRender = new Promise<void>((r) => (this.resolvePending = r))
    this.renderTimer = window.setTimeout(async () => {
      const seq = ++this.renderSeq
      try {
        const buf = await this.renderFn!(plan.tempo, plan.pitchRatio)
        if (seq !== this.renderSeq) return
        const proc = { buffer: buf, tempo: plan.tempo, key: plan.key }
        this.cache.set(plan.key, proc)
        while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!)
        this.swapProcessed(proc)
        this.emit({ rendering: false })
        this.finishPending()
      } catch (e) {
        if (seq !== this.renderSeq) return
        this.emit({ rendering: false, renderError: String(e) })
        this.finishPending()
      }
    }, delay)
  }

  /** playbackRate to use for a given processed buffer under the current params. */
  private rateFor(proc: ProcessedBuffer) {
    // A time-stretched buffer already carries its tempo; only unstretched
    // buffers get the live (classic, pitch-follows-speed) playbackRate.
    return proc.tempo === 1 ? processingPlan(this.params).playbackRate : 1
  }

  /** Resolves once the processed buffer matches the current params. */
  async ensureProcessed(): Promise<ProcessedBuffer> {
    for (let i = 0; i < 50; i++) {
      const plan = processingPlan(this.params)
      if (this.processed && this.processed.key === plan.key) return this.processed
      if (this.snapshot.renderError) throw new Error(this.snapshot.renderError)
      if (!this.pendingRender) this.scheduleRender(0)
      await (this.pendingRender ?? new Promise((r) => setTimeout(r, 100)))
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('Preview render did not complete')
  }

  private swapProcessed(p: ProcessedBuffer) {
    const playing = !!this.source
    const pos = this.position
    this.processed = p
    if (playing) this.restartAt(pos)
  }

  async play(from?: number) {
    if (!this.ctx || !this.processed) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    let pos = from ?? this.pausedAt
    if (pos < this.range.start || pos >= this.range.end - 0.02) pos = this.range.start
    this.restartAt(pos)
    this.emit({ playing: true })
  }

  pause() {
    if (!this.source) return
    this.pausedAt = Math.min(this.position, this.duration)
    this.stopSource()
    this.emit({ playing: false })
  }

  stop() {
    this.stopSource()
    this.pausedAt = this.range.start
    this.emit({ playing: false })
  }

  seek(t: number) {
    // Seeking stays inside the active (trimmed / looped) range.
    const pos = Math.max(this.range.start, Math.min(t, this.range.end || this.duration))
    if (this.source) this.restartAt(pos)
    else this.pausedAt = pos
  }

  private restartAt(pos: number) {
    const ctx = this.ctx!
    const proc = this.processed!
    this.stopSource()
    const src = new AudioBufferSourceNode(ctx, { buffer: proc.buffer })
    const rate = this.rateFor(proc)
    src.playbackRate.value = rate
    src.connect(this.chain!.input)
    const now = ctx.currentTime + 0.01
    const offset = Math.min(pos / proc.tempo, proc.buffer.duration)
    src.start(now, offset)
    this.source = src
    this.startCtx = now
    this.startOrig = pos
    this.origRate = proc.tempo * rate
    this.applyFades(pos, now)
  }

  private applyFades(pos: number, when: number) {
    if (!this.chain) return
    const speed = this.origRate || 1
    const outLen = (this.range.end - this.range.start) / speed
    const outPos = Math.max(0, (pos - this.range.start) / speed)
    scheduleFades(this.chain.fade.gain, when, outPos, outLen, this.fadeIn, this.fadeOut)
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.onended = null
        this.source.stop()
      } catch {
        /* already stopped */
      }
      this.source.disconnect()
      this.source = null
    }
  }

  private startTicker() {
    if (this.tickTimer) return
    this.tickTimer = window.setInterval(() => {
      if (!this.source) return
      const pos = this.position
      if (pos >= this.range.end || pos >= this.duration) {
        if (this.loop) {
          this.restartAt(this.range.start)
        } else {
          this.stopSource()
          this.pausedAt = this.range.start
          this.emit({ playing: false })
        }
      }
    }, 15)
  }
}

export const engine = new AudioEngine()

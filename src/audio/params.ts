export type StretchMode = 'classic' | 'stretch'

export interface EffectParams {
  speed: { enabled: boolean; value: number; mode: StretchMode }
  pitch: { enabled: boolean; semitones: number }
  reverb: {
    enabled: boolean
    /** 0..1 wet amount (equal-power crossfade with dry). */
    mix: number
    /** 0..1 — early reflection spread and density. */
    roomSize: number
    /** RT60 in seconds. */
    decay: number
    /** ms */
    preDelay: number
    /** 0..1 — high-frequency absorption over the tail. */
    damping: number
    /** 0..1 — stereo decorrelation of the tail. */
    width: number
    /** Hz — high-pass on the reverb send only, keeps low end out of the tail (de-mud). */
    lowCut: number
  }
  bass: { enabled: boolean; gain: number; frequency: number }
  eq: { enabled: boolean; low: number; mid: number; high: number }
  filters: { enabled: boolean; highpass: number; lowpass: number }
  volume: { enabled: boolean; outputGain: number; balance: number }
  limiter: { enabled: boolean; ceiling: number }
}

export type EffectKey = keyof EffectParams

export const DEFAULT_PARAMS: EffectParams = {
  speed: { enabled: true, value: 1, mode: 'classic' },
  pitch: { enabled: true, semitones: 0 },
  reverb: { enabled: false, mix: 0.4, roomSize: 0.7, decay: 3, preDelay: 10, damping: 0.15, width: 1, lowCut: 220 },
  bass: { enabled: false, gain: 6, frequency: 90 },
  eq: { enabled: true, low: 0, mid: 0, high: 0 },
  filters: { enabled: false, highpass: 20, lowpass: 20000 },
  volume: { enabled: true, outputGain: 0, balance: 0 },
  limiter: { enabled: true, ceiling: -1 },
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Merge a partial (e.g. preset) over defaults, field-by-field. */
export function mergeParams(base: EffectParams, patch: DeepPartial<EffectParams>): EffectParams {
  const out = clone(base)
  for (const k of Object.keys(patch) as EffectKey[]) {
    Object.assign(out[k], patch[k])
  }
  return out
}

export type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> }

export interface Range {
  min: number
  max: number
  step: number
  unit?: string
  digits?: number
}

export const RANGES = {
  speed: { min: 0.25, max: 2, step: 0.01, unit: 'x', digits: 2 },
  semitones: { min: -12, max: 12, step: 0.1, unit: 'st', digits: 1 },
  mix: { min: 0, max: 1, step: 0.01, unit: '%', digits: 0 },
  roomSize: { min: 0, max: 1, step: 0.01, unit: '%', digits: 0 },
  decay: { min: 0.2, max: 12, step: 0.1, unit: 's', digits: 1 },
  preDelay: { min: 0, max: 250, step: 1, unit: 'ms', digits: 0 },
  damping: { min: 0, max: 1, step: 0.01, unit: '%', digits: 0 },
  width: { min: 0, max: 1, step: 0.01, unit: '%', digits: 0 },
  lowCut: { min: 20, max: 1000, step: 1, unit: 'Hz', digits: 0 },
  bassGain: { min: 0, max: 18, step: 0.1, unit: 'dB', digits: 1 },
  bassFreq: { min: 40, max: 200, step: 1, unit: 'Hz', digits: 0 },
  eqBand: { min: -12, max: 12, step: 0.1, unit: 'dB', digits: 1 },
  highpass: { min: 20, max: 2000, step: 1, unit: 'Hz', digits: 0 },
  lowpass: { min: 200, max: 20000, step: 10, unit: 'Hz', digits: 0 },
  outputGain: { min: -24, max: 12, step: 0.1, unit: 'dB', digits: 1 },
  balance: { min: -1, max: 1, step: 0.01, unit: '', digits: 2 },
  ceiling: { min: -12, max: 0, step: 0.1, unit: 'dB', digits: 1 },
  master: { min: 0, max: 1.5, step: 0.01, unit: '%', digits: 0 },
} satisfies Record<string, Range>

export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** The playback speed actually applied (bypass = 1x). */
export const effectiveSpeed = (p: EffectParams) => (p.speed.enabled ? p.speed.value : 1)
export const effectiveSemitones = (p: EffectParams) => (p.pitch.enabled ? p.pitch.semitones : 0)

/**
 * How a set of params maps onto (offline Rubber Band render) + (real-time playbackRate):
 *  - classic: the buffer is only pitch-shifted by the semitone control; speed is
 *    applied live via playbackRate, which changes pitch with speed (vinyl style).
 *  - stretch: Rubber Band renders tempo + pitch together; playback rate stays 1.
 */
export function processingPlan(p: EffectParams) {
  const speed = effectiveSpeed(p)
  const semis = effectiveSemitones(p)
  const pitchRatio = Math.pow(2, semis / 12)
  const stretch = p.speed.mode === 'stretch'
  const tempo = stretch ? speed : 1
  const needsRender = Math.abs(tempo - 1) > 1e-4 || Math.abs(semis) > 1e-4
  return {
    speed,
    tempo,
    pitchRatio,
    playbackRate: stretch ? 1 : speed,
    needsRender,
    key: needsRender ? `${tempo.toFixed(4)}|${pitchRatio.toFixed(6)}` : 'original',
  }
}

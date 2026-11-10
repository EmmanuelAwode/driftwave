import { DEFAULT_PARAMS, mergeParams, type DeepPartial, type EffectParams } from './params'

export interface Preset {
  id: string
  name: string
  builtIn: boolean
  params: EffectParams
}

const p = (id: string, name: string, patch: DeepPartial<EffectParams>): Preset => ({
  id,
  name,
  builtIn: true,
  params: mergeParams(DEFAULT_PARAMS, patch),
})

export const BUILT_IN_PRESETS: Preset[] = [
  p('original', 'Original', {}),
  p('slowed-reverb', 'Slowed + Reverb', {
    speed: { value: 0.8, mode: 'classic' },
    reverb: { enabled: true, mix: 0.4, roomSize: 0.7, decay: 3, preDelay: 10, damping: 0.12, width: 1, lowCut: 220 },
  }),
  p('super-slowed', 'Super Slowed', {
    speed: { value: 0.7, mode: 'classic' },
    reverb: { enabled: true, mix: 0.45, roomSize: 0.85, decay: 4.5, preDelay: 20, damping: 0.2, width: 1, lowCut: 250 },
  }),
  p('sped-up', 'Sped Up', { speed: { value: 1.25, mode: 'classic' } }),
  p('nightcore', 'Nightcore', {
    speed: { value: 1.3, mode: 'classic' },
    pitch: { semitones: 1 },
    eq: { high: 2, low: 1 },
  }),
  p('daycore', 'Daycore', {
    speed: { value: 0.8, mode: 'classic' },
    pitch: { semitones: -1 },
    reverb: { enabled: true, mix: 0.25, roomSize: 0.55, decay: 2.2, preDelay: 10, damping: 0.2, width: 0.9, lowCut: 220 },
  }),
  p('bass-boosted', 'Bass Boosted', {
    bass: { enabled: true, gain: 12, frequency: 80 },
    eq: { low: 2 },
    limiter: { enabled: true, ceiling: -1 },
  }),
  p('dreamy', 'Dreamy', {
    speed: { value: 0.9, mode: 'stretch' },
    pitch: { semitones: -1 },
    reverb: { enabled: true, mix: 0.5, roomSize: 0.9, decay: 6, preDelay: 40, damping: 0.3, width: 1, lowCut: 280 },
    eq: { high: -3 },
    filters: { enabled: true, highpass: 30, lowpass: 9000 },
  }),
  p('lofi', 'Lo-Fi', {
    speed: { value: 0.92, mode: 'classic' },
    reverb: { enabled: true, mix: 0.16, roomSize: 0.3, decay: 1.2, preDelay: 8, damping: 0.6, width: 0.6, lowCut: 200 },
    bass: { enabled: true, gain: 2.5 },
    eq: { mid: 2, high: -4 },
    filters: { enabled: true, highpass: 140, lowpass: 4500 },
  }),
  p('underwater', 'Underwater', {
    speed: { value: 0.9, mode: 'classic' },
    reverb: { enabled: true, mix: 0.42, roomSize: 0.6, decay: 3, preDelay: 10, damping: 0.9, width: 0.9, lowCut: 60 },
    bass: { enabled: true, gain: 4 },
    filters: { enabled: true, highpass: 20, lowpass: 600 },
  }),
]

export const REVERB_PRESETS: { name: string; values: Omit<EffectParams['reverb'], 'enabled'> }[] = [
  { name: 'Small Room', values: { mix: 0.25, roomSize: 0.25, decay: 0.8, preDelay: 5, damping: 0.35, width: 0.6, lowCut: 200 } },
  { name: 'Large Hall', values: { mix: 0.33, roomSize: 0.8, decay: 3.2, preDelay: 25, damping: 0.25, width: 0.9, lowCut: 220 } },
  { name: 'Dreamy', values: { mix: 0.5, roomSize: 0.9, decay: 6, preDelay: 40, damping: 0.3, width: 1, lowCut: 280 } },
  { name: 'Ambient', values: { mix: 0.45, roomSize: 0.75, decay: 8, preDelay: 60, damping: 0.45, width: 1, lowCut: 300 } },
  { name: 'Cathedral', values: { mix: 0.4, roomSize: 1, decay: 9.5, preDelay: 80, damping: 0.2, width: 1, lowCut: 250 } },
  { name: 'Slowed + Reverb', values: { mix: 0.4, roomSize: 0.7, decay: 3, preDelay: 10, damping: 0.12, width: 1, lowCut: 220 } },
]

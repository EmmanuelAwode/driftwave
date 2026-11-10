// Algorithmic impulse-response synthesis for the convolution reverb.
// The IR is deterministic (seeded) so the offline export render uses exactly the
// same response the user heard in the live preview.

export interface ReverbShape {
  roomSize: number
  decay: number
  damping: number
  width: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WET_ENERGY = 0.3

export function generateImpulse(sampleRate: number, shape: ReverbShape): AudioBuffer {
  const decay = Math.max(0.2, shape.decay)
  const size = Math.min(1, Math.max(0, shape.roomSize))
  const damping = Math.min(1, Math.max(0, shape.damping))
  const width = Math.min(1, Math.max(0, shape.width))

  // Early reflections span 8-90 ms depending on room size.
  const erSpan = (0.008 + 0.082 * size) * sampleRate
  const length = Math.ceil(decay * 1.1 * sampleRate + erSpan)
  const buf = new AudioBuffer({ length, numberOfChannels: 2, sampleRate })
  const L = buf.getChannelData(0)
  const R = buf.getChannelData(1)

  const rngA = mulberry32(0x5eed1)
  const rngB = mulberry32(0x5eed2)

  // RT60: amplitude reaches -60 dB (×0.001) at `decay` seconds after the tail onset.
  const k = Math.log(1000) / decay
  // Tail fades in (diffusion build-up) over a size-dependent window.
  const attack = (0.004 + 0.03 * size) * sampleRate

  // Late diffuse tail with time-varying one-pole low-pass (frequency-dependent decay).
  const nyq = sampleRate / 2
  const startCut = Math.min(nyq * 0.95, 18000)
  const endCut = Math.max(400, startCut * (1 - 0.93 * damping))
  let yl = 0
  let yr = 0
  let coef = 0
  for (let i = 0; i < length; i++) {
    if ((i & 63) === 0) {
      const t = i / length
      const fc = startCut * Math.pow(endCut / startCut, Math.min(1, t * (0.6 + damping)))
      coef = Math.exp((-2 * Math.PI * fc) / sampleRate)
    }
    const t = Math.max(0, i - erSpan * 0.5) / sampleRate
    const env = Math.exp(-k * t) * Math.min(1, i / attack)
    const nl = rngA() * 2 - 1
    const nr = rngB() * 2 - 1
    // Mid/side width control on the raw noise.
    const m = (nl + nr) * 0.5
    const s = (nl - nr) * 0.5 * width
    const xl = (m + s) * env
    const xr = (m - s) * env
    yl = (1 - coef) * xl + coef * yl
    yr = (1 - coef) * xr + coef * yr
    L[i] = yl
    R[i] = yr
  }

  // Discrete early reflections: count and spacing scale with room size.
  const rngE = mulberry32(0xea71)
  const count = Math.round(6 + 26 * size)
  for (let n = 0; n < count; n++) {
    const pos = Math.floor(Math.pow(rngE(), 0.8) * erSpan) + 1
    const amp = (0.9 - 0.6 * (pos / erSpan)) * (rngE() < 0.5 ? -1 : 1) * (0.6 + 0.4 * (1 - size))
    const pan = (rngE() * 2 - 1) * width
    if (pos < length) {
      L[pos] += amp * (1 - Math.max(0, pan)) * 0.7
      R[pos] += amp * (1 + Math.min(0, pan)) * 0.7
    }
  }

  // Normalise to a fixed energy so changing shape doesn't jump the wet level.
  // WET_ENERGY ≈ what Web Audio's own convolver normalisation gives a typical
  // noise IR (≈ −5 dB); unit energy made the tail sit too loud and washy.
  let energy = 0
  for (let i = 0; i < length; i++) energy += L[i] * L[i] + R[i] * R[i]
  const norm = Math.sqrt(WET_ENERGY / (energy / 2 + 1e-12))
  for (let i = 0; i < length; i++) {
    L[i] *= norm
    R[i] *= norm
  }
  return buf
}

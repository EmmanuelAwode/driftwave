import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { processingPlan } from '../audio/params'
import { formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { Icon, Toggle } from './ui'

function useEngineTime() {
  const [t, setT] = useState(0)
  useEffect(() => {
    let raf = 0
    const f = () => {
      setT(engine.position)
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  return t
}

export function Transport() {
  const track = useApp((s) => s.track)
  const playing = useApp((s) => s.playing)
  const loop = useApp((s) => s.loop)
  const region = useApp((s) => s.region)
  const params = useApp((s) => s.params)
  const rendering = useApp((s) => s.rendering)
  const renderError = useApp((s) => s.renderError)
  const compare = useApp((s) => s.compare)
  const { togglePlay, stop, seek, setLoop, setCompare } = useApp.getState()
  const t = useEngineTime()
  const speed = processingPlan(params).speed
  const dur = track?.duration ?? 0
  const disabled = !track

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <RoundBtn title="Back 5s (←)" onClick={() => seek(Math.max(0, t - 5))} disabled={disabled}>
          <Icon name="back" size={16} />
        </RoundBtn>
        <button
          type="button"
          title="Play / Pause (Space)"
          disabled={disabled}
          onClick={togglePlay}
          className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-accent-strong to-cool text-white shadow-[0_6px_28px_-8px_#7a57ff] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <RoundBtn title="Stop" onClick={stop} disabled={disabled}>
          <Icon name="stop" size={14} />
        </RoundBtn>
        <RoundBtn title="Forward 5s (→)" onClick={() => seek(Math.min(dur, t + 5))} disabled={disabled}>
          <Icon name="fwd" size={16} />
        </RoundBtn>
      </div>

      <div className="min-w-[200px]">
        <div className="font-mono text-2xl font-light tracking-tight text-ink-100 tabular-nums">
          {formatTime(t / (compare ? 1 : speed))}
          <span className="text-base text-ink-400"> / {formatTime(dur / (compare ? 1 : speed), false)}</span>
        </div>
        <div className="font-mono text-[11px] text-ink-400">
          source {formatTime(t)} · {compare ? '1.00x (original)' : `${speed.toFixed(2)}x`}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setCompare(!compare)}
        title="A/B compare: hear the untouched original (B)"
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-40 ${
          compare ? 'border-warn/60 bg-warn/15 text-warn' : 'border-ink-700 bg-ink-800 text-ink-300 hover:text-ink-100'
        }`}
      >
        <Icon name="compare" size={14} /> {compare ? 'Hearing original' : 'A/B'}
      </button>

      <label className={`flex items-center gap-2 text-xs ${region ? 'text-ink-200' : 'text-ink-400'}`} title="Loop the selected region (L)">
        <Toggle checked={loop} onChange={setLoop} label="Loop region" small />
        <Icon name="loop" size={14} /> Loop region
      </label>

      <div className="ml-auto flex items-center gap-3">
        {rendering && (
          <span className="flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1 text-xs font-medium text-warn dw-pulse">
            <Icon name="reset" size={12} className="dw-spin" /> Updating preview…
          </span>
        )}
        {renderError && !rendering && (
          <span className="max-w-[260px] truncate rounded-full bg-bad/15 px-3 py-1 text-xs text-bad" title={renderError}>
            Preview render failed
          </span>
        )}
        <Meter />
      </div>
    </div>
  )
}

function RoundBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-full bg-ink-750 text-ink-200 transition-colors hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** Stereo peak/RMS meter with clip latch, fed from the post-chain analysers. */
function Meter() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [clip, setClip] = useState(false)
  const [peakDb, setPeakDb] = useState(-Infinity)
  useEffect(() => {
    let raf = 0
    const buf = new Float32Array(2048)
    const hold = [0, 0]
    let peakHold = 0
    let peakTimer = 0
    let lastUi = 0
    const draw = (now: number) => {
      const c = canvas.current
      const ctx = c?.getContext('2d')
      if (c && ctx) {
        const W = c.width
        const H = c.height
        ctx.clearRect(0, 0, W, H)
        const analysers = [engine.analyserL, engine.analyserR]
        analysers.forEach((a, i) => {
          let peak = 0
          let rms = 0
          if (a && engine.isPlaying) {
            a.getFloatTimeDomainData(buf)
            for (let k = 0; k < buf.length; k++) {
              const v = Math.abs(buf[k])
              if (v > peak) peak = v
              rms += buf[k] * buf[k]
            }
            rms = Math.sqrt(rms / buf.length)
          }
          if (peak >= 0.999) setClip(true)
          if (peak > peakHold) {
            peakHold = peak
            peakTimer = now
          }
          hold[i] = Math.max(peak, hold[i] * 0.94)
          const toX = (v: number) => {
            const db = 20 * Math.log10(v || 1e-9)
            return Math.max(0, Math.min(1, (db + 48) / 48)) * W
          }
          const y = i * (H / 2) + 1
          const h = H / 2 - 2
          ctx.fillStyle = '#22222a'
          ctx.fillRect(0, y, W, h)
          const g = ctx.createLinearGradient(0, 0, W, 0)
          g.addColorStop(0, '#46d39a')
          g.addColorStop(0.75, '#5aa8ff')
          g.addColorStop(0.9, '#ffb547')
          g.addColorStop(1, '#ff5a6e')
          ctx.fillStyle = g
          ctx.globalAlpha = 0.45
          ctx.fillRect(0, y, toX(hold[i]), h)
          ctx.globalAlpha = 1
          ctx.fillRect(0, y, toX(rms * 1.414), h)
        })
        if (now - peakTimer > 1500) peakHold *= 0.9
        if (now - lastUi > 150) {
          lastUi = now
          setPeakDb(20 * Math.log10(peakHold || 1e-9))
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end">
        <canvas ref={canvas} width={180} height={16} className="h-4 w-[180px] rounded" title="Output level (L / R)" />
        <div className="mt-0.5 flex w-[180px] justify-between font-mono text-[9px] text-ink-500">
          <span>-48</span>
          <span>-24</span>
          <span>-12</span>
          <span>-6</span>
          <span>0</span>
        </div>
      </div>
      <span className="w-12 text-right font-mono text-[11px] text-ink-300">{isFinite(peakDb) && peakDb > -90 ? peakDb.toFixed(1) : '-∞'}</span>
      <button
        type="button"
        onClick={() => setClip(false)}
        title={clip ? 'Clipping detected — click to reset' : 'No clipping'}
        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide transition-colors ${clip ? 'bg-bad text-white' : 'bg-ink-750 text-ink-500'}`}
      >
        CLIP
      </button>
    </div>
  )
}

export function Spectrum() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let data = new Float32Array(2048)
    const draw = () => {
      const c = canvas.current
      const ctx = c?.getContext('2d')
      const a = engine.spectrum
      if (c && ctx) {
        const dpr = window.devicePixelRatio || 1
        const W = Math.floor(c.clientWidth * dpr)
        const H = Math.floor(c.clientHeight * dpr)
        if (c.width !== W || c.height !== H) {
          c.width = W
          c.height = H
        }
        ctx.clearRect(0, 0, W, H)
        if (a) {
          if (data.length !== a.frequencyBinCount) data = new Float32Array(a.frequencyBinCount)
          a.getFloatFrequencyData(data)
          const bars = 96
          const nyq = a.context.sampleRate / 2
          const bw = W / bars
          const g = ctx.createLinearGradient(0, H, 0, 0)
          g.addColorStop(0, '#7a57ff')
          g.addColorStop(1, '#5aa8ff')
          ctx.fillStyle = g
          for (let i = 0; i < bars; i++) {
            const f0 = 30 * Math.pow(16000 / 30, i / bars)
            const f1 = 30 * Math.pow(16000 / 30, (i + 1) / bars)
            const b0 = Math.floor((f0 / nyq) * data.length)
            const b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * data.length))
            let m = -140
            for (let b = b0; b < b1 && b < data.length; b++) m = Math.max(m, data[b])
            const v = engine.isPlaying ? Math.max(0, Math.min(1, (m + 90) / 80)) : 0
            const h = Math.max(1.5 * dpr, v * H)
            ctx.globalAlpha = 0.35 + 0.65 * v
            const x = i * bw
            ctx.beginPath()
            ctx.roundRect(x + bw * 0.15, H - h, bw * 0.7, h, 2 * dpr)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={canvas} className="h-full w-full" />
}

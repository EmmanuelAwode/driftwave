import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region as WsRegion } from 'wavesurfer.js/dist/plugins/regions.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.js'
import { engine } from '../audio/engine'
import { formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { Icon } from './ui'

const REGION_COLOR = 'rgba(139,108,255,0.16)'

export function Waveform() {
  const container = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const regions = useRef<RegionsPlugin | null>(null)
  const wsRegion = useRef<WsRegion | null>(null)
  const peaks = useApp((s) => s.peaks)
  const track = useApp((s) => s.track)
  const region = useApp((s) => s.region)
  const trimEnabled = useApp((s) => s.trimEnabled)
  const loop = useApp((s) => s.loop)
  const zoom = useApp((s) => s.zoom)
  const setZoom = useApp((s) => s.setZoom)
  const playing = useApp((s) => s.playing)

  // (Re)create WaveSurfer whenever a new track is loaded.
  useEffect(() => {
    if (!container.current || !peaks || !track) return
    const regionsPlugin = RegionsPlugin.create()
    const w = WaveSurfer.create({
      container: container.current,
      height: 'auto',
      waveColor: '#4b4b62',
      progressColor: '#8b6cff',
      cursorColor: '#ececf3',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      peaks,
      duration: track.duration,
      backend: 'WebAudio',
      autoScroll: true,
      autoCenter: true,
      dragToSeek: false,
      plugins: [
        regionsPlugin,
        TimelinePlugin.create({
          height: 18,
          timeInterval: 5,
          primaryLabelInterval: 30,
          style: { fontSize: '10px', color: '#6c6c7c' },
        }),
        HoverPlugin.create({ lineColor: '#9a9aab', lineWidth: 1, labelBackground: '#22222a', labelColor: '#ececf3', labelSize: '11px' }),
      ],
    })
    ws.current = w
    regions.current = regionsPlugin
    wsRegion.current = null

    w.on('interaction', (t) => engine.seek(t))
    regionsPlugin.enableDragSelection({ color: REGION_COLOR }, 4)
    regionsPlugin.on('region-created', (r) => {
      for (const other of regionsPlugin.getRegions()) if (other !== r) other.remove()
      wsRegion.current = r
      useApp.getState().setRegion({ start: r.start, end: r.end })
    })
    regionsPlugin.on('region-updated', (r) => {
      useApp.getState().setRegion({ start: r.start, end: r.end })
    })
    regionsPlugin.on('region-clicked', (r, e) => {
      e.stopPropagation()
      engine.seek(r.start)
    })
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const z = useApp.getState().zoom
      const base = z || container.current!.clientWidth / track.duration
      const next = Math.min(1000, Math.max(0, base * (e.deltaY < 0 ? 1.25 : 0.8)))
      setZoom(next <= container.current!.clientWidth / track.duration ? 0 : next)
    }
    const el = container.current
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('wheel', onWheel)
      w.destroy()
      ws.current = null
      regions.current = null
    }
  }, [peaks, track, setZoom])

  // Store → WaveSurfer region sync (timestamp inputs, clear, etc).
  useEffect(() => {
    const rp = regions.current
    if (!rp) return
    if (!region) {
      rp.clearRegions()
      wsRegion.current = null
      return
    }
    const existing = wsRegion.current ?? rp.getRegions()[0]
    if (existing) {
      if (Math.abs(existing.start - region.start) > 1e-4 || Math.abs(existing.end - region.end) > 1e-4) {
        existing.setOptions({ start: region.start, end: region.end })
      }
      wsRegion.current = existing
    } else {
      wsRegion.current = rp.addRegion({ start: region.start, end: region.end, color: REGION_COLOR, drag: true, resize: true })
    }
  }, [region, peaks])

  useEffect(() => {
    wsRegion.current?.setOptions({ color: trimEnabled || loop ? 'rgba(90,168,255,0.18)' : REGION_COLOR })
  }, [trimEnabled, loop, region])

  useEffect(() => {
    if (ws.current && ws.current.getDuration() > 0) {
      try {
        ws.current.zoom(zoom)
      } catch {
        /* not ready */
      }
    }
  }, [zoom])

  // Drive the cursor from the audio engine clock.
  useEffect(() => {
    let raf = 0
    let last = -1
    const loopFn = () => {
      const t = engine.position
      if (ws.current && Math.abs(t - last) > 0.005) {
        ws.current.setTime(t)
        last = t
      }
      raf = requestAnimationFrame(loopFn)
    }
    raf = requestAnimationFrame(loopFn)
    return () => cancelAnimationFrame(raf)
  }, [peaks, playing])

  const pxFit = track && container.current ? container.current.clientWidth / track.duration : 1
  const zoomBy = (f: number) => {
    const base = zoom || pxFit
    const next = Math.min(1000, base * f)
    setZoom(next <= pxFit * 1.01 ? 0 : next)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
        <span>Drag on the waveform to select a region · click to seek · Ctrl + wheel to zoom</span>
        {region && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-accent">
            {formatTime(region.start)} – {formatTime(region.end)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Zoom out" onClick={() => zoomBy(0.66)} className="rounded-md p-1.5 hover:bg-ink-750 hover:text-ink-100">
            <Icon name="zoomOut" size={15} />
          </button>
          <button type="button" title="Fit" onClick={() => setZoom(0)} className="rounded-md px-2 py-1 font-mono text-[11px] hover:bg-ink-750 hover:text-ink-100">
            {zoom ? `${Math.round((zoom / pxFit) * 100)}%` : 'Fit'}
          </button>
          <button type="button" title="Zoom in" onClick={() => zoomBy(1.5)} className="rounded-md p-1.5 hover:bg-ink-750 hover:text-ink-100">
            <Icon name="zoomIn" size={15} />
          </button>
        </div>
      </div>
      <div className="relative min-h-[180px] flex-1 overflow-hidden rounded-xl border border-ink-750 bg-ink-950/60 px-1 pt-1">
        <div id="waveform" ref={container} className="h-full w-full" />
      </div>
    </div>
  )
}

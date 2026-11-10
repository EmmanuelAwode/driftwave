import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { engine } from '../audio/engine'
import { pathExists, revealPath } from '../lib/backend'
import { formatTime, joinPath, parseTime, sanitizeFilename } from '../lib/format'
import { isExportBusy, useApp } from '../state/store'
import { Button, Icon, Segmented, Select, Toggle } from './ui'

function TimeInput({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <input
        type="text"
        disabled={disabled}
        value={text ?? formatTime(value)}
        onFocus={(e) => {
          setText(formatTime(value))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text !== null ? parseTime(text) : null
          if (v !== null) onCommit(v)
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="h-9 w-[104px] rounded-xl border border-ink-700 bg-ink-900 px-2.5 font-mono text-sm outline-none focus:border-accent disabled:opacity-40"
      />
    </label>
  )
}

function NumInput({ label, value, onCommit, suffix, step = 0.1, max = 30 }: { label: string; value: number; onCommit: (v: number) => void; suffix: string; step?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <div className="flex h-9 items-center rounded-xl border border-ink-700 bg-ink-900 pr-2 focus-within:border-accent">
        <input
          type="number"
          min={0}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onCommit(Math.min(max, Math.max(0, Number(e.target.value) || 0)))}
          className="w-14 bg-transparent px-2.5 font-mono text-sm outline-none"
        />
        <span className="text-[11px] text-ink-400">{suffix}</span>
      </div>
    </label>
  )
}

export function TrimControls() {
  const track = useApp((s) => s.track)
  const region = useApp((s) => s.region)
  const trimEnabled = useApp((s) => s.trimEnabled)
  const fadeIn = useApp((s) => s.fadeIn)
  const fadeOut = useApp((s) => s.fadeOut)
  const { setRegion, setTrimEnabled, setFades } = useApp.getState()
  const dur = track?.duration ?? 0
  const r = region ?? { start: 0, end: dur }
  const disabled = !track

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Trim</span>
        <label className="flex h-9 items-center gap-2 rounded-xl border border-ink-700 bg-ink-800 px-3 text-sm">
          <Toggle checked={trimEnabled} onChange={setTrimEnabled} label="Trim to selection" small />
          <Icon name="scissors" size={14} className="text-ink-300" />
          <span className={trimEnabled ? 'text-ink-100' : 'text-ink-300'}>Trim to selection</span>
        </label>
      </div>
      <TimeInput label="Start" value={r.start} disabled={disabled} onCommit={(v) => setRegion({ start: Math.min(v, r.end - 0.05), end: r.end })} />
      <Button variant="soft" disabled={disabled} title="Set start to playhead" className="!px-2.5" onClick={() => setRegion({ start: Math.min(engine.position, r.end - 0.05), end: r.end })}>
        [ ◂
      </Button>
      <TimeInput label="End" value={r.end} disabled={disabled} onCommit={(v) => setRegion({ start: r.start, end: Math.max(v, r.start + 0.05) })} />
      <Button variant="soft" disabled={disabled} title="Set end to playhead" className="!px-2.5" onClick={() => setRegion({ start: r.start, end: Math.max(engine.position, r.start + 0.05) })}>
        ▸ ]
      </Button>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Length</span>
        <div className="flex h-9 items-center font-mono text-sm text-ink-200">{formatTime(r.end - r.start)}</div>
      </div>
      <Button variant="ghost" disabled={!region} onClick={() => setRegion(null)} title="Clear selection">
        <Icon name="x" size={14} /> Clear
      </Button>
      <div className="mx-1 h-9 w-px self-end bg-ink-750" />
      <NumInput label="Fade in" value={fadeIn} suffix="s" onCommit={(v) => setFades(v, fadeOut)} />
      <NumInput label="Fade out" value={fadeOut} suffix="s" onCommit={(v) => setFades(fadeIn, v)} />
    </div>
  )
}

const MP3_Q = [
  { value: '320', label: '320 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '128', label: '128 kbps' },
  { value: 'v0', label: 'VBR V0' },
]
const WAV_Q = [
  { value: '16', label: '16-bit PCM' },
  { value: '24', label: '24-bit PCM' },
  { value: '32f', label: '32-bit float' },
]
const FLAC_Q = [
  { value: '16', label: '16-bit' },
  { value: '24', label: '24-bit' },
]

export function ExportOptionsBar() {
  const track = useApp((s) => s.track)
  const o = useApp((s) => s.exportOpts)
  const region = useApp((s) => s.region)
  const es = useApp((s) => s.exportState)
  const { setExportOpts, runExport } = useApp.getState()
  const busy = isExportBusy(es)
  const [exists, setExists] = useState(false)

  useEffect(() => {
    let alive = true
    if (!o.dir || !o.filename.trim()) {
      setExists(false)
      return
    }
    const path = joinPath(o.dir, `${sanitizeFilename(o.filename)}.${o.format}`)
    pathExists(path).then((v) => alive && setExists(v)).catch(() => {})
    return () => {
      alive = false
    }
  }, [o.dir, o.filename, o.format, es.status])

  const pickDir = async () => {
    const d = await open({ directory: true, title: 'Choose export folder', defaultPath: o.dir || undefined })
    if (typeof d === 'string') setExportOpts({ dir: d })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Format</span>
        <Segmented
          value={o.format}
          onChange={(f) => setExportOpts({ format: f })}
          options={[
            { value: 'mp3', label: 'MP3' },
            { value: 'wav', label: 'WAV' },
            { value: 'flac', label: 'FLAC' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Quality</span>
        {o.format === 'mp3' && <Select value={o.mp3Quality} onChange={(v) => setExportOpts({ mp3Quality: v })} options={MP3_Q} />}
        {o.format === 'wav' && <Select value={o.wavDepth} onChange={(v) => setExportOpts({ wavDepth: v })} options={WAV_Q} />}
        {o.format === 'flac' && <Select value={o.flacDepth} onChange={(v) => setExportOpts({ flacDepth: v })} options={FLAC_Q} />}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Sample rate</span>
        <Select
          value={o.outRate}
          onChange={(v) => setExportOpts({ outRate: v as typeof o.outRate })}
          options={[
            { value: 'source', label: track ? `Source (${track.sourceSampleRate / 1000} kHz)` : 'Source' },
            { value: '44100', label: '44.1 kHz' },
            { value: '48000', label: '48 kHz' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Range</span>
        <Segmented
          value={o.range}
          onChange={(v) => setExportOpts({ range: v })}
          options={[
            { value: 'full', label: 'Full song' },
            { value: 'selection', label: 'Selection' },
          ]}
          disabled={!region}
        />
      </div>
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Save to</span>
        <div className="flex h-9 items-center rounded-xl border border-ink-700 bg-ink-900 focus-within:border-accent">
          <button type="button" onClick={pickDir} title={o.dir || 'Choose folder'} className="flex h-full max-w-[40%] items-center gap-1.5 truncate rounded-l-xl border-r border-ink-700 px-2.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100">
            <Icon name="folder" size={14} className="shrink-0" />
            <span className="truncate">{o.dir ? o.dir.split(/[\\/]/).filter(Boolean).pop() : 'Choose…'}</span>
          </button>
          <input
            value={o.filename}
            onChange={(e) => setExportOpts({ filename: e.target.value })}
            placeholder="File name"
            className="min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
          />
          <span className="pr-3 font-mono text-xs text-ink-400">.{o.format}</span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-1">
        <span className={`text-[10px] tracking-wide ${exists ? 'text-warn' : 'text-transparent'}`}>Will overwrite existing file</span>
        <Button variant="primary" disabled={!track || busy || !o.filename.trim()} onClick={() => void runExport()} className="min-w-[130px]">
          <Icon name="export" /> {busy ? `${Math.round(es.progress * 100)}%` : 'Export'}
        </Button>
      </div>
      {es.status !== 'idle' && (
        <div className="basis-full">
          <div className="flex items-center gap-3 text-xs">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-750">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${es.status === 'error' ? 'bg-bad' : es.status === 'done' ? 'bg-ok' : 'bg-gradient-to-r from-accent to-cool'}`}
                style={{ width: `${(es.status === 'error' ? 1 : es.progress) * 100}%` }}
              />
            </div>
            <span className={`max-w-[60%] truncate ${es.status === 'error' ? 'text-bad' : es.status === 'done' ? 'text-ok' : 'text-ink-300'}`} title={es.message}>
              {es.message}
            </span>
            {es.status === 'done' && es.path && (
              <button type="button" onClick={() => revealPath(es.path!)} className="text-accent hover:underline">
                Show in folder
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

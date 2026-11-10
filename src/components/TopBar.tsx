import { useState } from 'react'
import { BUILT_IN_PRESETS } from '../audio/presets'
import { formatBytes, formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { Button, Icon, Modal } from './ui'
import { pickAudioFile } from './importing'

export function TopBar() {
  const track = useApp((s) => s.track)
  const loading = useApp((s) => s.loading)
  const exportState = useApp((s) => s.exportState)
  const busyExport = ['preparing', 'rendering', 'encoding'].includes(exportState.status)
  const panelOpen = useApp((s) => s.panelOpen)
  const set = useApp((s) => s.set)

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-ink-750 bg-ink-900/90 px-5">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-strong to-cool shadow-[0_4px_18px_-6px_#7a57ff]">
          <Icon name="reverb" size={18} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide">Driftwave</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-400">slowed + reverb</div>
        </div>
      </div>

      <Button variant="soft" onClick={() => void pickAudioFile()} disabled={!!loading}>
        <Icon name="import" /> Import
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {track ? (
          <>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium" title={track.path}>
                {track.name}
              </div>
              <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-ink-400">
                <span>{formatTime(track.duration, false)}</span>
                <span>{track.format}{track.codec && track.codec.toUpperCase() !== track.format ? ` · ${track.codec}` : ''}</span>
                <span>{(track.sourceSampleRate / 1000).toFixed(1)} kHz</span>
                <span>{track.channelLayout}</span>
                {track.bitrateKbps ? <span>{track.bitrateKbps} kbps</span> : null}
                <span>{formatBytes(track.sizeBytes)}</span>
              </div>
            </div>
          </>
        ) : (
          <span className="text-sm text-ink-400">No song loaded</span>
        )}
      </div>

      <HistoryButtons />
      <PresetPicker />

      <Button variant="ghost" title="Settings" onClick={() => set({ settingsOpen: true })}>
        <Icon name="settings" />
      </Button>
      <Button variant="ghost" title={panelOpen ? 'Hide effects panel' : 'Show effects panel'} active={panelOpen} onClick={() => set({ panelOpen: !panelOpen })}>
        <Icon name="panel" />
      </Button>
      <Button variant="primary" disabled={!track || busyExport} onClick={() => void useApp.getState().runExport()}>
        <Icon name="export" /> {busyExport ? 'Exporting…' : 'Export'}
      </Button>
    </header>
  )
}

function HistoryButtons() {
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const { undo, redo } = useApp.getState()
  return (
    <div className="flex items-center">
      <Button variant="ghost" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} className="!px-2.5">
        <Icon name="undo" />
      </Button>
      <Button variant="ghost" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} className="!px-2.5">
        <Icon name="redo" />
      </Button>
    </div>
  )
}

function PresetPicker() {
  const activeId = useApp((s) => s.activePresetId)
  const userPresets = useApp((s) => s.userPresets)
  const { applyPreset, deleteUserPreset } = useApp.getState()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const all = [...BUILT_IN_PRESETS, ...userPresets]
  const active = all.find((p) => p.id === activeId)

  return (
    <div className="relative">
      <Button variant="soft" onClick={() => setOpen(!open)} className="min-w-[190px] !justify-between">
        <span className="text-ink-400">Preset</span>
        <span className="truncate">{active?.name ?? 'Custom'}</span>
        <Icon name="chevron" size={14} />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="dw-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl">
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-ink-400">Built-in</div>
            {BUILT_IN_PRESETS.map((p) => (
              <PresetRow key={p.id} name={p.name} active={p.id === activeId} onClick={() => { applyPreset(p.id); setOpen(false) }} />
            ))}
            <div className="mt-1 border-t border-ink-750 px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-wider text-ink-400">My presets</div>
            {userPresets.length === 0 && <div className="px-2.5 py-1.5 text-xs text-ink-500">None yet</div>}
            {userPresets.map((p) => (
              <PresetRow
                key={p.id}
                name={p.name}
                active={p.id === activeId}
                onClick={() => { applyPreset(p.id); setOpen(false) }}
                onDelete={() => deleteUserPreset(p.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => { setSaving(true); setOpen(false) }}
              className="mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-accent hover:bg-accent-soft"
            >
              <Icon name="save" size={14} /> Save current as preset…
            </button>
          </div>
        </>
      )}
      {saving && <SavePresetModal onClose={() => setSaving(false)} initial={active && !active.builtIn ? active.name : ''} />}
    </div>
  )
}

function PresetRow({ name, active, onClick, onDelete }: { name: string; active: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <div className={`group flex items-center rounded-xl ${active ? 'bg-accent-soft text-accent' : 'hover:bg-ink-750'}`}>
      <button type="button" onClick={onClick} className="flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm">
        <span className="w-3.5">{active && <Icon name="check" size={13} />}</span>
        {name}
      </button>
      {onDelete && (
        <button type="button" title="Delete preset" onClick={onDelete} className="mr-1 rounded-md p-1 text-ink-400 opacity-0 hover:text-bad group-hover:opacity-100">
          <Icon name="trash" size={13} />
        </button>
      )}
    </div>
  )
}

function SavePresetModal({ onClose, initial }: { onClose: () => void; initial: string }) {
  const [name, setName] = useState(initial)
  const exists = useApp((s) => s.userPresets.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()))
  const save = () => {
    if (!name.trim()) return
    useApp.getState().saveUserPreset(name)
    onClose()
  }
  return (
    <Modal title="Save preset" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-400">Saves all effect settings (speed, pitch, reverb, bass, EQ, filters, volume, limiter).</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Preset name"
        maxLength={60}
        className="h-10 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm outline-none focus:border-accent"
      />
      {exists && <p className="mt-2 text-xs text-warn">A preset with this name exists and will be updated.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          <Icon name="save" size={14} /> Save
        </Button>
      </div>
    </Modal>
  )
}

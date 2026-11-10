import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { ExportOptionsBar, TrimControls } from './components/BottomBar'
import { EffectsPanel } from './components/EffectsPanel'
import { listenForDrops, pickAudioFile } from './components/importing'
import { TopBar } from './components/TopBar'
import { Spectrum, Transport } from './components/Transport'
import { Button, Icon, Modal, Toggle } from './components/ui'
import { Waveform } from './components/Waveform'
import { engine } from './audio/engine'
import { isTauri, openUrl } from './lib/backend'
import { REPO_URL } from './lib/meta'
import { getVersion } from '@tauri-apps/api/app'
import { useApp } from './state/store'

export default function App() {
  const track = useApp((s) => s.track)
  const loading = useApp((s) => s.loading)
  const panelOpen = useApp((s) => s.panelOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    void useApp.getState().loadUserData()
    const un = listenForDrops(setDragging)
    return () => {
      void un.then((f) => f())
    }
  }, [])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const s = useApp.getState()
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void pickAudioFile()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void s.runExport()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        s.togglePlay()
      } else if (e.key === 'ArrowLeft') s.seek(Math.max(0, engine.position - (e.shiftKey ? 1 : 5)))
      else if (e.key === 'ArrowRight') s.seek(engine.position + (e.shiftKey ? 1 : 5))
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        s.redo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        s.undo()
      } else if (e.ctrlKey || e.altKey || e.metaKey) return
      else if (e.key.toLowerCase() === 'l') s.setLoop(!s.loop)
      else if (e.key.toLowerCase() === 'b') s.setCompare(!s.compare)
      else if (e.key === 'Escape' && s.region && !s.settingsOpen) s.setRegion(null)
      else if (e.key === 'Home') s.seek(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(ellipse_at_top_left,#1d1830_0%,transparent_55%),radial-gradient(ellipse_at_bottom_right,#14203a_0%,transparent_50%)]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">
          {track ? (
            <>
              <Waveform />
              <div className="h-20 shrink-0 overflow-hidden rounded-xl border border-ink-750 bg-ink-950/40 px-2 pt-2">
                <Spectrum />
              </div>
              <Transport />
            </>
          ) : (
            <EmptyState />
          )}
        </main>
        <aside
          className={`shrink-0 overflow-hidden border-l border-ink-750 bg-ink-900/70 transition-[width] duration-300 ${panelOpen ? 'w-[360px]' : 'w-0'}`}
        >
          <div className="h-full w-[360px] overflow-y-auto p-4">
            <div className="mb-3 flex items-center">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">Effects</h2>
              <button
                type="button"
                className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-400 hover:bg-ink-750 hover:text-ink-100"
                onClick={() => useApp.getState().applyPreset('original')}
              >
                Reset all
              </button>
            </div>
            <EffectsPanel />
          </div>
        </aside>
      </div>
      <footer className="shrink-0 space-y-3 border-t border-ink-750 bg-ink-900/90 px-5 py-3.5">
        <TrimControls />
        <div className="h-px bg-ink-750" />
        <ExportOptionsBar />
      </footer>

      {(dragging || loading) && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
          <div className="dw-in flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/70 bg-ink-850/80 px-16 py-12">
            <Icon name={loading ? 'reset' : 'import'} size={36} className={`text-accent ${loading ? 'dw-spin' : ''}`} />
            <div className="text-lg font-medium">{loading ?? 'Drop to import'}</div>
            {!loading && <div className="text-xs text-ink-400">MP3 · WAV · FLAC · M4A · OGG · AAC</div>}
          </div>
        </div>
      )}
      {settingsOpen && <SettingsModal />}
      <Toasts />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center">
      <button
        type="button"
        onClick={() => void pickAudioFile()}
        className="group flex w-[min(560px,90%)] flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-ink-700 bg-ink-850/50 px-10 py-16 transition-colors hover:border-accent/70 hover:bg-ink-850"
      >
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent-strong to-cool shadow-[0_10px_40px_-10px_#7a57ff] transition-transform group-hover:scale-105">
          <Icon name="music" size={28} className="text-white" />
        </div>
        <div className="text-xl font-semibold">Drop a song here</div>
        <div className="text-sm text-ink-400">or click to browse — MP3, WAV, FLAC, M4A, OGG, AAC</div>
        <div className="text-xs text-ink-500">Your original file is never modified.</div>
      </button>
    </div>
  )
}

function SettingsModal() {
  const settings = useApp((s) => s.settings)
  const { setSettings, set, setExportOpts } = useApp.getState()
  const close = () => set({ settingsOpen: false })
  return (
    <Modal title="Settings" onClose={close} width={480}>
      <div className="space-y-4 text-sm">
        <Row
          title="High-quality time stretch"
          desc="Rubber Band 'quality' pitch mode. Turn off for faster preview renders on slow PCs."
          control={<Toggle checked={settings.highQuality} onChange={(v) => setSettings({ highQuality: v })} />}
        />
        <Row
          title="Include reverb tail in export"
          desc="Lets the reverb ring out after the song (or selection) ends."
          control={<Toggle checked={settings.includeTail} onChange={(v) => setSettings({ includeTail: v })} />}
        />
        <div>
          <div className="font-medium">Default export folder</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-9 flex-1 truncate rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300" title={settings.defaultExportDir}>
              {settings.defaultExportDir || 'Not set'}
            </div>
            <Button
              variant="soft"
              onClick={async () => {
                const d = await open({ directory: true, defaultPath: settings.defaultExportDir || undefined })
                if (typeof d === 'string') {
                  setSettings({ defaultExportDir: d })
                  setExportOpts({ dir: d })
                }
              }}
            >
              <Icon name="folder" size={14} /> Browse
            </Button>
          </div>
        </div>
        <div className="rounded-xl bg-ink-900 p-3 text-xs leading-relaxed text-ink-400">
          <div className="mb-1 font-medium text-ink-300">Shortcuts</div>
          Space play/pause · ←/→ seek 5s (Shift: 1s) · L loop · B A/B compare · Esc clear selection · Home go to start ·
          Ctrl+Z / Ctrl+Y undo / redo · Ctrl+O import · Ctrl+E export · Ctrl+wheel zoom · double-click a slider to reset it
        </div>
        <About />
      </div>
    </Modal>
  )
}

function About() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    if (isTauri()) void getVersion().then(setVersion).catch(() => {})
  }, [])
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-750 p-3 text-xs">
      <Icon name="info" size={16} className="shrink-0 text-accent" />
      <div className="flex-1 text-ink-400">
        <div className="font-medium text-ink-200">Driftwave {version && `v${version}`}</div>
        Free and open source (GPL-3.0). Audio engine: Web Audio + FFmpeg with Rubber Band.
      </div>
      <Button variant="soft" onClick={() => void openUrl(`${REPO_URL}/releases`)} title="Open the releases page on GitHub">
        <Icon name="link" size={14} /> Updates
      </Button>
    </div>
  )
}

function Row({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-ink-400">{desc}</div>
      </div>
      {control}
    </div>
  )
}

function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="fixed bottom-40 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`dw-in max-w-[640px] cursor-pointer rounded-xl border px-4 py-2.5 text-sm shadow-2xl backdrop-blur ${
            t.kind === 'error' ? 'border-bad/40 bg-[#2a1419]/95 text-[#ffc2ca]' : t.kind === 'success' ? 'border-ok/40 bg-[#10241c]/95 text-[#b4f1d6]' : 'border-ink-700 bg-ink-800/95'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

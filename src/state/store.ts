import { create } from 'zustand'
import { engine } from '../audio/engine'
import { clone, DEFAULT_PARAMS, mergeParams, processingPlan, type EffectKey, type EffectParams } from '../audio/params'
import { BUILT_IN_PRESETS, type Preset } from '../audio/presets'
import { interleave, peakDb, renderMix } from '../audio/render'
import * as backend from '../lib/backend'
import { joinPath, sanitizeFilename } from '../lib/format'

export interface Region {
  start: number
  end: number
}

export interface Settings {
  highQuality: boolean
  includeTail: boolean
  defaultExportDir: string
}

export interface ExportOptions {
  format: backend.ExportFormat
  mp3Quality: string
  wavDepth: string
  flacDepth: string
  outRate: 'source' | '44100' | '48000'
  filename: string
  dir: string
  range: 'full' | 'selection'
}

export interface ExportState {
  status: 'idle' | 'preparing' | 'rendering' | 'encoding' | 'done' | 'error'
  progress: number
  message: string
  path?: string
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

interface AppState {
  track: backend.TrackInfo | null
  loading: string | null
  peaks: Float32Array[] | null
  params: EffectParams
  masterVolume: number
  activePresetId: string | null
  userPresets: Preset[]
  region: Region | null
  trimEnabled: boolean
  loop: boolean
  fadeIn: number
  fadeOut: number
  playing: boolean
  rendering: boolean
  renderError: string | null
  zoom: number
  panelOpen: boolean
  settingsOpen: boolean
  exportOpen: boolean
  settings: Settings
  exportOpts: ExportOptions
  exportState: ExportState
  toasts: Toast[]
  /** A/B: monitor the untouched original (speed 1, no effects) without losing settings. */
  compare: boolean
  past: HistoryEntry[]
  future: HistoryEntry[]

  importFile: (path: string) => Promise<void>
  setSection: <K extends EffectKey>(key: K, patch: Partial<EffectParams[K]>) => void
  resetSection: (key: EffectKey) => void
  setAllParams: (p: EffectParams) => void
  applyPreset: (id: string) => void
  saveUserPreset: (name: string) => void
  deleteUserPreset: (id: string) => void
  setMasterVolume: (v: number) => void
  setRegion: (r: Region | null) => void
  setTrimEnabled: (v: boolean) => void
  setLoop: (v: boolean) => void
  setFades: (fadeIn: number, fadeOut: number) => void
  togglePlay: () => void
  stop: () => void
  seek: (t: number) => void
  setZoom: (z: number) => void
  set: (patch: Partial<AppState>) => void
  setExportOpts: (patch: Partial<ExportOptions>) => void
  setSettings: (patch: Partial<Settings>) => void
  runExport: () => Promise<void>
  toast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  loadUserData: () => Promise<void>
  undo: () => void
  redo: () => void
  setCompare: (v: boolean) => void
}

interface HistoryEntry {
  params: EffectParams
  presetId: string | null
}

const HISTORY_LIMIT = 100
/** Changes closer together than this (one slider drag) collapse into one undo step. */
const HISTORY_COALESCE_MS = 600
let lastHistoryAt = 0
const EXPORT_BUSY: ExportState['status'][] = ['preparing', 'rendering', 'encoding']
export const isExportBusy = (s: ExportState) => EXPORT_BUSY.includes(s.status)

const MIN_REGION = 0.05

/** Min/max pairs per bucket, merged across channels, for WaveSurfer. */
function computePeaks(buf: AudioBuffer, perSecond = 200): Float32Array[] {
  const bucket = Math.max(1, Math.floor(buf.sampleRate / perSecond))
  const n = Math.ceil(buf.length / bucket)
  const p = new Float32Array(n * 2)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let b = 0; b < n; b++) {
      let mx = p[b * 2]
      let mn = p[b * 2 + 1]
      const end = Math.min(d.length, (b + 1) * bucket)
      for (let i = b * bucket; i < end; i++) {
        const v = d[i]
        if (v > mx) mx = v
        else if (v < mn) mn = v
      }
      p[b * 2] = mx
      p[b * 2 + 1] = mn
    }
  }
  return [p]
}

let saveTimer: number | undefined
let toastId = 1

export const useApp = create<AppState>((set, get) => {
  const syncRange = () => {
    const { region, trimEnabled, loop, track, fadeIn, fadeOut } = get()
    const dur = track?.duration ?? 0
    const r = region && (trimEnabled || loop) ? region : { start: 0, end: dur }
    engine.setPlaybackRange(r, loop)
    engine.setFades(fadeIn, fadeOut)
  }

  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      const { userPresets, settings, exportOpts, params, masterVolume, activePresetId } = get()
      const { filename: _f, ...opts } = exportOpts
      void _f
      const session = { params, masterVolume, activePresetId }
      backend
        .saveUserData(JSON.stringify({ version: 1, presets: userPresets, settings, exportOpts: opts, session }))
        .catch((e) => get().toast('error', `Could not save settings: ${e}`))
    }, 400)
  }

  const applyParams = (params: EffectParams, presetId: string | null = null, record = true) => {
    if (record) {
      const now = Date.now()
      const cur = get()
      if (now - lastHistoryAt > HISTORY_COALESCE_MS) {
        set({ past: [...cur.past, { params: cur.params, presetId: cur.activePresetId }].slice(-HISTORY_LIMIT), future: [] })
      } else if (cur.future.length) {
        set({ future: [] })
      }
      lastHistoryAt = now
    }
    set({ params, activePresetId: presetId, compare: false })
    engine.setParams(params)
    syncRange()
    persist()
  }

  return {
    track: null,
    loading: null,
    peaks: null,
    params: clone(DEFAULT_PARAMS),
    masterVolume: 0.9,
    activePresetId: 'original',
    userPresets: [],
    region: null,
    trimEnabled: false,
    loop: false,
    fadeIn: 0,
    fadeOut: 0,
    playing: false,
    rendering: false,
    renderError: null,
    zoom: 0,
    panelOpen: true,
    settingsOpen: false,
    exportOpen: false,
    settings: { highQuality: true, includeTail: true, defaultExportDir: '' },
    exportOpts: {
      format: 'mp3',
      mp3Quality: '320',
      wavDepth: '24',
      flacDepth: '24',
      outRate: 'source',
      filename: '',
      dir: '',
      range: 'full',
    },
    exportState: { status: 'idle', progress: 0, message: '' },
    toasts: [],
    compare: false,
    past: [],
    future: [],

    async importFile(path) {
      if (isExportBusy(get().exportState)) {
        get().toast('info', 'Wait for the export to finish before importing another song.')
        return
      }
      if (get().loading) return
      const prev = get().track
      engine.stop()
      set({ loading: `Decoding ${path.split(/[\\/]/).pop()}…` })
      try {
        const info = await backend.importAudio(path)
        set({ loading: 'Loading audio…' })
        const pcm = await backend.getPcm(info.id)
        const buffer = backend.pcmToAudioBuffer(pcm, info.sampleRate)
        const peaks = computePeaks(buffer)
        await engine.load(buffer, async (tempo, pitch) => {
          const data = await backend.renderStretch(info.id, tempo, pitch, get().settings.highQuality)
          return backend.pcmToAudioBuffer(data, info.sampleRate)
        })
        if (prev) backend.releaseTrack(prev.id)
        const base = info.name.replace(/\.[^.]+$/, '')
        set((s) => ({
          track: info,
          peaks,
          loading: null,
          region: null,
          trimEnabled: false,
          loop: false,
          fadeIn: 0,
          fadeOut: 0,
          exportState: { status: 'idle', progress: 0, message: '' },
          exportOpts: {
            ...s.exportOpts,
            filename: sanitizeFilename(`${base} (${presetLabel(s)})`),
            dir: s.exportOpts.dir || s.settings.defaultExportDir,
            range: 'full',
          },
        }))
        set({ compare: false })
        engine.setParams(get().params)
        engine.setMasterVolume(get().masterVolume)
        syncRange()
      } catch (e) {
        set({ loading: null })
        get().toast('error', `Import failed: ${e}`)
      }
    },

    setSection(key, patch) {
      const params = clone(get().params)
      Object.assign(params[key], patch)
      applyParams(params, null)
    },
    resetSection(key) {
      const params = clone(get().params)
      params[key] = clone(DEFAULT_PARAMS[key]) as never
      if (key === 'speed') params.speed.mode = get().params.speed.mode
      applyParams(params, null)
    },
    setAllParams(p) {
      applyParams(clone(p), null)
    },
    applyPreset(id) {
      const preset = [...BUILT_IN_PRESETS, ...get().userPresets].find((p) => p.id === id)
      if (!preset) return
      applyParams(clone(preset.params), id)
      const { track } = get()
      if (track) {
        const base = track.name.replace(/\.[^.]+$/, '')
        get().setExportOpts({ filename: sanitizeFilename(`${base} (${preset.id === 'original' ? 'edit' : preset.name.toLowerCase()})`) })
      }
    },
    saveUserPreset(name) {
      const trimmed = name.trim()
      if (!trimmed) return
      const existing = get().userPresets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
      const preset: Preset = {
        id: existing?.id ?? `user-${Date.now()}`,
        name: trimmed,
        builtIn: false,
        params: clone(get().params),
      }
      const list = existing
        ? get().userPresets.map((p) => (p.id === existing.id ? preset : p))
        : [...get().userPresets, preset]
      set({ userPresets: list, activePresetId: preset.id })
      persist()
      get().toast('success', `Preset “${trimmed}” saved`)
    },
    deleteUserPreset(id) {
      set((s) => ({
        userPresets: s.userPresets.filter((p) => p.id !== id),
        activePresetId: s.activePresetId === id ? null : s.activePresetId,
      }))
      persist()
    },
    setMasterVolume(v) {
      set({ masterVolume: v })
      engine.setMasterVolume(v)
      persist()
    },
    setRegion(r) {
      const dur = get().track?.duration ?? 0
      if (r) {
        const start = Math.max(0, Math.min(r.start, dur))
        const end = Math.max(0, Math.min(r.end, dur))
        if (end - start < MIN_REGION) return
        set((s) => ({ region: { start, end }, exportOpts: { ...s.exportOpts, range: 'selection' } }))
      } else {
        set((s) => ({ region: null, trimEnabled: false, loop: false, exportOpts: { ...s.exportOpts, range: 'full' } }))
      }
      syncRange()
    },
    setTrimEnabled(v) {
      if (v && !get().region) {
        const dur = get().track?.duration ?? 0
        set({ region: { start: 0, end: dur } })
      }
      set((s) => ({ trimEnabled: v, exportOpts: { ...s.exportOpts, range: v ? 'selection' : s.exportOpts.range } }))
      syncRange()
    },
    setLoop(v) {
      if (v && !get().region) {
        const dur = get().track?.duration ?? 0
        set({ region: { start: 0, end: dur } })
      }
      set({ loop: v })
      syncRange()
    },
    setFades(fadeIn, fadeOut) {
      set({ fadeIn: Math.max(0, fadeIn), fadeOut: Math.max(0, fadeOut) })
      syncRange()
    },
    togglePlay() {
      if (!get().track) return
      if (engine.isPlaying) engine.pause()
      else void engine.play()
    },
    stop() {
      engine.stop()
    },
    seek(t) {
      engine.seek(t)
    },
    setZoom(z) {
      set({ zoom: z })
    },
    set(patch) {
      set(patch)
    },
    setExportOpts(patch) {
      set((s) => ({ exportOpts: { ...s.exportOpts, ...patch } }))
      if (!('filename' in patch && Object.keys(patch).length === 1)) persist()
    },
    setSettings(patch) {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      persist()
    },

    async runExport() {
      const s = get()
      const { track, exportOpts: o } = s
      if (!track || isExportBusy(s.exportState)) return
      const st = (patch: Partial<ExportState>) => set((x) => ({ exportState: { ...x.exportState, ...patch } }))
      if (!o.dir) {
        st({ status: 'error', message: 'Choose an output folder first.' })
        return
      }
      const range = o.range === 'selection' && s.region ? s.region : { start: 0, end: track.duration }
      const ext = o.format
      const filename = sanitizeFilename(o.filename || track.name.replace(/\.[^.]+$/, ''))
      const outPath = joinPath(o.dir, `${filename}.${ext}`)
      const quality = o.format === 'mp3' ? o.mp3Quality : o.format === 'wav' ? o.wavDepth : o.flacDepth
      const outRate = o.outRate === 'source' ? track.sourceSampleRate : Number(o.outRate)
      let unlisten: (() => void) | undefined
      // Mark busy synchronously so a second Export click / Ctrl+E can't start a parallel run.
      st({ status: 'preparing', progress: 0, message: 'Checking output folder…', path: undefined })
      if (!(await backend.pathExists(o.dir).catch(() => false))) {
        st({ status: 'error', progress: 0, message: `Output folder does not exist: ${o.dir}` })
        get().toast('error', 'Export failed: output folder does not exist')
        return
      }
      try {
        st({ status: 'preparing', progress: 0, message: 'Preparing time-stretch render…', path: undefined })
        const processed = await engine.ensureProcessed()
        st({ status: 'rendering', progress: 0, message: 'Rendering effects…' })
        const params = clone(get().params)
        const mix = await renderMix({
          processed,
          params,
          start: range.start,
          end: range.end,
          fadeIn: s.fadeIn,
          fadeOut: s.fadeOut,
          includeTail: s.settings.includeTail,
          onProgress: (p) => st({ progress: p * 0.5 }),
        })
        const peak = peakDb(mix)
        st({ status: 'encoding', progress: 0.5, message: `Encoding ${ext.toUpperCase()}…` })
        unlisten = await backend.onExportProgress((p) => st({ progress: 0.5 + p.progress * 0.5 }))
        const res = await backend.exportAudio({
          outPath,
          format: o.format,
          quality,
          sampleRate: mix.sampleRate,
          outRate,
          title: filename,
          pcm: interleave(mix),
        })
        st({
          status: 'done',
          progress: 1,
          path: res.path,
          message: `Saved ${res.path.split(/[\\/]/).pop()} (${(res.sizeBytes / 1048576).toFixed(1)} MB · ${processingPlan(params).speed.toFixed(2)}x · peak ${peak.toFixed(1)} dBFS)`,
        })
        get().toast('success', 'Export complete')
      } catch (e) {
        st({ status: 'error', message: String(e) })
        get().toast('error', `Export failed: ${e}`)
      } finally {
        unlisten?.()
      }
    },

    toast(kind, text) {
      const id = toastId++
      set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 3500)
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    },

    undo() {
      const { past, future, params, activePresetId } = get()
      const prev = past.at(-1)
      if (!prev) return
      set({ past: past.slice(0, -1), future: [...future, { params, presetId: activePresetId }] })
      applyParams(clone(prev.params), prev.presetId, false)
      lastHistoryAt = 0
    },
    redo() {
      const { past, future, params, activePresetId } = get()
      const next = future.at(-1)
      if (!next) return
      set({ future: future.slice(0, -1), past: [...past, { params, presetId: activePresetId }] })
      applyParams(clone(next.params), next.presetId, false)
      lastHistoryAt = 0
    },
    setCompare(v) {
      if (!get().track) return
      set({ compare: v })
      engine.setParams(v ? clone(DEFAULT_PARAMS) : get().params)
    },

    async loadUserData() {
      try {
        const [raw, dir] = await Promise.all([backend.loadUserData(), backend.defaultExportDir()])
        const data = JSON.parse(raw || '{}')
        const settings: Settings = { highQuality: true, includeTail: true, defaultExportDir: dir, ...(data.settings ?? {}) }
        if (!settings.defaultExportDir) settings.defaultExportDir = dir
        const session = data.session ?? {}
        const params = session.params ? mergeParams(DEFAULT_PARAMS, session.params) : get().params
        const masterVolume = typeof session.masterVolume === 'number' ? session.masterVolume : get().masterVolume
        set((s) => ({
          userPresets: Array.isArray(data.presets)
            ? data.presets.map((p: Preset) => ({ ...p, params: mergeParams(DEFAULT_PARAMS, p.params ?? {}) }))
            : [],
          settings,
          params,
          masterVolume,
          activePresetId: session.params ? (session.activePresetId ?? null) : s.activePresetId,
          exportOpts: { ...s.exportOpts, ...(data.exportOpts ?? {}), dir: data.exportOpts?.dir || settings.defaultExportDir, filename: '' },
        }))
        engine.setParams(params)
        engine.setMasterVolume(masterVolume)
      } catch (e) {
        get().toast('error', `Could not load saved presets: ${e}`)
      }
    },
  }
})

function presetLabel(s: { activePresetId: string | null; userPresets: Preset[] }) {
  const p = [...BUILT_IN_PRESETS, ...s.userPresets].find((x) => x.id === s.activePresetId)
  return p && p.id !== 'original' ? p.name.toLowerCase() : 'edit'
}

// Mirror engine playback state into the store.
engine.subscribe((snap) => {
  useApp.setState({ playing: snap.playing, rendering: snap.rendering, renderError: snap.renderError })
})

// All native (Tauri/FFmpeg) calls live here so later phases (URL import,
// video export, batch jobs) can add sources/sinks without touching the UI.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface TrackInfo {
  id: string
  path: string
  name: string
  format: string
  codec: string
  sourceSampleRate: number
  /** Internal (decoded) sample rate used for all processing. */
  sampleRate: number
  sourceChannels: number
  channelLayout: string
  duration: number
  sizeBytes: number
  bitrateKbps: number | null
}

export type ExportFormat = 'mp3' | 'wav' | 'flac'

export interface ExportRequest {
  outPath: string
  format: ExportFormat
  quality: string
  sampleRate: number
  outRate: number
  title: string
  /** Interleaved stereo float32 PCM. */
  pcm: Float32Array
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function importAudio(path: string): Promise<TrackInfo> {
  return invoke<TrackInfo>('import_audio', { path })
}

export async function getPcm(id: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('get_pcm', { id })
}

export async function renderStretch(id: string, tempo: number, pitch: number, highQuality: boolean): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('render_stretch', { id, tempo, pitch, highQuality })
}

export function releaseTrack(id: string) {
  return invoke<void>('release_track', { id }).catch(() => {})
}

export async function exportAudio(req: ExportRequest): Promise<{ path: string; sizeBytes: number }> {
  const bytes = new Uint8Array(req.pcm.buffer, req.pcm.byteOffset, req.pcm.byteLength)
  return invoke('export_audio', bytes, {
    headers: {
      'x-out-path': encodeURIComponent(req.outPath),
      'x-format': req.format,
      'x-quality': req.quality,
      'x-sample-rate': String(req.sampleRate),
      'x-out-rate': String(req.outRate),
      'x-title': encodeURIComponent(req.title),
    },
  })
}

export function onExportProgress(cb: (p: { stage: string; progress: number }) => void): Promise<UnlistenFn> {
  return listen<{ stage: string; progress: number }>('export-progress', (e) => cb(e.payload))
}

export const loadUserData = () => invoke<string>('load_user_data')
export const saveUserData = (json: string) => invoke<void>('save_user_data', { json })
export const defaultExportDir = () => invoke<string>('default_export_dir')
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path })
export const revealPath = (path: string) => invoke<void>('reveal_path', { path })
export const openUrl = (url: string) => invoke<void>('open_url', { url })

/** Convert interleaved stereo f32 bytes from the backend into an AudioBuffer. */
export function pcmToAudioBuffer(data: ArrayBuffer, sampleRate: number): AudioBuffer {
  const interleaved = new Float32Array(data)
  const frames = Math.floor(interleaved.length / 2)
  const buf = new AudioBuffer({ length: Math.max(1, frames), numberOfChannels: 2, sampleRate })
  const l = buf.getChannelData(0)
  const r = buf.getChannelData(1)
  for (let i = 0, j = 0; i < frames; i++, j += 2) {
    l[i] = interleaved[j]
    r[i] = interleaved[j + 1]
  }
  return buf
}

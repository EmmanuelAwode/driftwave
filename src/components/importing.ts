import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useApp } from '../state/store'

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'oga', 'opus']

export async function pickAudioFile() {
  const file = await open({
    multiple: false,
    directory: false,
    title: 'Import audio',
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
  })
  if (typeof file === 'string') await useApp.getState().importFile(file)
}

/** Subscribe to native drag & drop (Tauri delivers real file paths). */
export async function listenForDrops(onHover: (hovering: boolean) => void) {
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload
    if (p.type === 'enter' || p.type === 'over') onHover(true)
    else if (p.type === 'leave') onHover(false)
    else if (p.type === 'drop') {
      onHover(false)
      const file = p.paths.find((x) => AUDIO_EXTENSIONS.includes(x.split('.').pop()?.toLowerCase() ?? ''))
      if (file) void useApp.getState().importFile(file)
      else if (p.paths.length) useApp.getState().toast('error', 'Unsupported file. Drop an MP3, WAV, FLAC, M4A, OGG or AAC file.')
    }
  })
}

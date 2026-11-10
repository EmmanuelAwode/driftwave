export function formatTime(sec: number, ms = true): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return ms ? `${m}:${s.toFixed(3).padStart(6, '0')}` : `${m}:${Math.floor(s).toString().padStart(2, '0')}`
}

/** Parses "m:ss.mmm", "ss.mmm", or "h:mm:ss" into seconds. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim())
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + Number(p)
  return sec >= 0 ? sec : null
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function sanitizeFilename(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || 'export'
}

export function joinPath(dir: string, file: string) {
  if (!dir) return file
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + file : `${dir}\\${file}`
}

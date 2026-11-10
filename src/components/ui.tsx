import { useEffect, useState, type ReactNode } from 'react'
import type { Range } from '../audio/params'

const ICONS: Record<string, ReactNode> = {
  play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  back: <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />,
  fwd: <path d="M13 6l6 6-6 6M5 6l6 6-6 6" />,
  loop: <path d="M17 2l3 3-3 3M3 11V9a4 4 0 014-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 01-4 4H4" />,
  reset: <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
  export: <path d="M12 21V9M7 14l5-5 5 5M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  save: <path d="M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 3v5h8M7 21v-7h10v7" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  music: <path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z" />,
  zoomIn: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.35-4.35M11 8v6M8 11h6" />,
  zoomOut: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.35-4.35M8 11h6" />,
  scissors: <path d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />,
  speed: <path d="M12 14l4-4M3.34 19a10 10 0 1117.32 0" />,
  pitch: <path d="M2 12h3l3-8 4 16 4-12 2 4h4" />,
  reverb: <path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />,
  bass: <path d="M4 18c3 0 4-12 8-12s5 12 8 12" />,
  eq: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  filter: <path d="M3 4h18l-7 9v6l-4 2v-8z" />,
  volume: <path d="M11 5L6 9H2v6h4l5 4zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />,
  limiter: <path d="M3 6h18M3 12h4l2-4 3 8 3-6 2 2h4M3 18h18" />,
  check: <path d="M20 6L9 17l-5-5" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />,
  compare: <path d="M12 3v18M5 7h4M7 5v4M15 7h4M4 17a3 3 0 006 0zM14 17a3 3 0 006 0z" />,
  info: <path d="M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01" />,
  link: <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />,
}

export function Icon({ name, size = 16, className = '' }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className = '',
  active,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  disabled?: boolean
  title?: string
  className?: string
  active?: boolean
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none'
  const styles = {
    primary:
      'h-9 px-4 bg-gradient-to-r from-accent-strong to-cool text-white shadow-[0_4px_20px_-6px_#7a57ff] hover:brightness-110 active:scale-[0.98]',
    soft: 'h-9 px-3.5 bg-ink-750 hover:bg-ink-700 border border-ink-700 text-ink-100',
    ghost: 'h-9 px-3 hover:bg-ink-750 text-ink-200 hover:text-ink-100',
    danger: 'h-9 px-3 hover:bg-bad/15 text-bad',
  }
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${styles[variant]} ${active ? '!bg-accent-soft !text-accent' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

export function Toggle({ checked, onChange, label, small }: { checked: boolean; onChange: (v: boolean) => void; label?: string; small?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative shrink-0 rounded-full transition-colors duration-200 ${small ? 'h-4 w-7' : 'h-5 w-9'} ${
        checked ? 'bg-accent' : 'bg-ink-600'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform duration-200 ${small ? 'h-3 w-3' : 'h-4 w-4'} ${
          checked ? (small ? 'translate-x-3' : 'translate-x-4') : ''
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex rounded-lg bg-ink-900 p-0.5 border border-ink-700 ${disabled ? 'opacity-50' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-ink-700 text-ink-100 shadow' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Format a parameter value for display. */
export function fmtValue(v: number, r: Range) {
  if (r.unit === '%') return `${Math.round(v * 100)}`
  if (r.unit === 'Hz' && v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 1 : 2)
  return v.toFixed(r.digits ?? 2)
}
function unitLabel(v: number, r: Range) {
  if (r.unit === 'Hz' && v >= 1000) return 'kHz'
  return r.unit ?? ''
}
function parseValue(text: string, r: Range, current: number) {
  const n = parseFloat(text.replace(',', '.'))
  if (isNaN(n)) return current
  let v = n
  if (r.unit === '%') v = n / 100
  else if (r.unit === 'Hz' && /k/i.test(text)) v = n * 1000
  else if (r.unit === 'Hz' && current >= 1000 && n < 100) v = n * 1000
  return Math.min(r.max, Math.max(r.min, v))
}

export function ParamSlider({
  label,
  value,
  range,
  defaultValue,
  onChange,
  disabled,
  log,
  hint,
  signed,
}: {
  label: string
  value: number
  range: Range
  defaultValue: number
  onChange: (v: number) => void
  disabled?: boolean
  /** Logarithmic slider mapping (for frequencies). */
  log?: boolean
  hint?: string
  signed?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const toPos = (v: number) =>
    log ? Math.log(v / range.min) / Math.log(range.max / range.min) : (v - range.min) / (range.max - range.min)
  const fromPos = (p: number) => {
    const raw = log ? range.min * Math.pow(range.max / range.min, p) : range.min + p * (range.max - range.min)
    const stepped = Math.round(raw / range.step) * range.step
    return Math.min(range.max, Math.max(range.min, Number(stepped.toFixed(4))))
  }
  const pos = toPos(value)
  const changed = Math.abs(value - defaultValue) > range.step / 2
  const display = fmtValue(value, range)
  return (
    <div className={`group ${disabled ? 'opacity-45' : ''}`}>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="text-xs text-ink-300" title={hint}>
          {label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Reset"
            onClick={() => onChange(defaultValue)}
            className={`rounded p-0.5 text-ink-400 transition-opacity hover:text-ink-100 ${changed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <Icon name="reset" size={11} />
          </button>
          <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={text ?? (signed && value > 0 ? `+${display}` : display)}
            onFocus={(e) => {
              setText(display)
              requestAnimationFrame(() => e.target.select())
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text !== null) onChange(parseValue(text, range, value))
              setText(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setText(null)
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const mult = e.shiftKey ? 10 : 1
                const nv = Math.min(range.max, Math.max(range.min, value + (e.key === 'ArrowUp' ? 1 : -1) * range.step * mult))
                onChange(Number(nv.toFixed(4)))
                setText(null)
              }
            }}
            className="w-14 rounded-md border border-transparent bg-ink-900/70 px-1.5 py-0.5 text-right font-mono text-xs text-ink-100 outline-none focus:border-accent"
          />
          <span className="w-6 text-[10px] text-ink-400">{unitLabel(value, range)}</span>
        </div>
      </div>
      <input
        type="range"
        className="dw-range"
        min={0}
        max={1}
        step={0.0005}
        disabled={disabled}
        value={pos}
        style={{ ['--fill' as string]: `${pos * 100}%` }}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
        onDoubleClick={() => onChange(defaultValue)}
      />
    </div>
  )
}

export function Section({
  title,
  icon,
  enabled,
  onToggle,
  onReset,
  children,
  badge,
  defaultOpen = true,
}: {
  title: string
  icon: string
  enabled: boolean
  onToggle: (v: boolean) => void
  onReset: () => void
  children: ReactNode
  badge?: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`rounded-2xl border transition-colors ${enabled ? 'border-ink-700 bg-ink-800' : 'border-ink-750 bg-ink-850'}`}>
      <header className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5" onClick={() => setOpen(!open)}>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${enabled ? 'bg-accent-soft text-accent' : 'bg-ink-750 text-ink-400'}`}>
          <Icon name={icon} size={15} />
        </span>
        <span className={`text-sm font-semibold ${enabled ? 'text-ink-100' : 'text-ink-300'}`}>{title}</span>
        {badge}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            title={`Reset ${title}`}
            onClick={(e) => {
              e.stopPropagation()
              onReset()
            }}
            className="rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"
          >
            <Icon name="reset" size={13} />
          </button>
          <Toggle checked={enabled} onChange={onToggle} label={enabled ? `Bypass ${title}` : `Enable ${title}`} small />
          <Icon name="chevron" size={14} className={`text-ink-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        </div>
      </header>
      {open && <div className="dw-in space-y-3 px-3.5 pb-3.5">{children}</div>}
    </section>
  )
}

export function Modal({ title, onClose, children, width = 420 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="dw-in rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Select({
  value,
  onChange,
  options,
  className = '',
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-xl border border-ink-700 bg-ink-800 px-2.5 text-sm text-ink-100 outline-none focus:border-accent disabled:opacity-40 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-ink-850">
          {o.label}
        </option>
      ))}
    </select>
  )
}

import { DEFAULT_PARAMS, RANGES, processingPlan } from '../audio/params'
import { REVERB_PRESETS } from '../audio/presets'
import { formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { ParamSlider, Section, Segmented, Icon } from './ui'

const D = DEFAULT_PARAMS

export function EffectsPanel() {
  const params = useApp((s) => s.params)
  const setSection = useApp((s) => s.setSection)
  const resetSection = useApp((s) => s.resetSection)
  const track = useApp((s) => s.track)
  const rendering = useApp((s) => s.rendering)
  const masterVolume = useApp((s) => s.masterVolume)
  const setMasterVolume = useApp((s) => s.setMasterVolume)
  const region = useApp((s) => s.region)
  const trimEnabled = useApp((s) => s.trimEnabled)

  const plan = processingPlan(params)
  const srcDur = track ? (trimEnabled && region ? region.end - region.start : track.duration) : 0
  const newDur = srcDur / plan.speed
  const { speed, pitch, reverb, bass, eq, filters, volume, limiter } = params
  const stretch = speed.mode === 'stretch'
  const totalPitch = 12 * Math.log2((stretch ? 1 : plan.speed) * plan.pitchRatio)

  return (
    <div className="space-y-2.5">
      <Section
        title="Speed"
        icon="speed"
        enabled={speed.enabled}
        onToggle={(v) => setSection('speed', { enabled: v })}
        onReset={() => resetSection('speed')}
        badge={rendering && stretch ? <RenderBadge /> : null}
      >
        <Segmented
          value={speed.mode}
          onChange={(m) => setSection('speed', { mode: m })}
          options={[
            { value: 'classic', label: 'Classic Slowed', title: 'Speed and pitch change together (like a turntable)' },
            { value: 'stretch', label: 'Time Stretch', title: 'Speed changes without changing pitch (Rubber Band)' },
          ]}
        />
        <ParamSlider
          label="Speed"
          value={speed.value}
          range={RANGES.speed}
          defaultValue={1}
          disabled={!speed.enabled}
          onChange={(v) => setSection('speed', { value: v })}
        />
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Original" value={track ? formatTime(srcDur, false) : '—'} />
          <Stat label="New duration" value={track ? formatTime(newDur, false) : '—'} accent />
        </div>
      </Section>

      <Section
        title="Pitch"
        icon="pitch"
        enabled={pitch.enabled}
        onToggle={(v) => setSection('pitch', { enabled: v })}
        onReset={() => resetSection('pitch')}
        badge={rendering && Math.abs(plan.pitchRatio - 1) > 1e-4 ? <RenderBadge /> : null}
      >
        <ParamSlider
          label="Semitones"
          value={pitch.semitones}
          range={RANGES.semitones}
          defaultValue={0}
          signed
          disabled={!pitch.enabled}
          onChange={(v) => setSection('pitch', { semitones: v })}
        />
        <div className="flex gap-1">
          {[-12, -5, -2, -1, 1, 2, 5, 12].map((n) => (
            <button
              key={n}
              type="button"
              disabled={!pitch.enabled}
              onClick={() => setSection('pitch', { semitones: Math.max(-12, Math.min(12, Number((pitch.semitones + n).toFixed(1)))) })}
              className="flex-1 rounded-md bg-ink-750 py-1 font-mono text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
            >
              {n > 0 ? `+${n}` : n}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">
          Overall pitch: <span className="font-mono text-ink-200">{totalPitch >= 0 ? '+' : ''}{totalPitch.toFixed(2)} st</span>
          {!stretch && plan.speed !== 1 && <> (includes {(12 * Math.log2(plan.speed)).toFixed(2)} st from Classic speed)</>}
        </p>
      </Section>

      <Section
        title="Reverb"
        icon="reverb"
        enabled={reverb.enabled}
        onToggle={(v) => setSection('reverb', { enabled: v })}
        onReset={() => resetSection('reverb')}
      >
        <div className="flex flex-wrap gap-1">
          {REVERB_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setSection('reverb', { ...p.values, enabled: true })}
              className="rounded-full border border-ink-700 bg-ink-750 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-accent hover:text-ink-100"
            >
              {p.name}
            </button>
          ))}
        </div>
        <ParamSlider label="Wet / Dry" value={reverb.mix} range={RANGES.mix} defaultValue={D.reverb.mix} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { mix: v })} />
        <ParamSlider label="Room size" value={reverb.roomSize} range={RANGES.roomSize} defaultValue={D.reverb.roomSize} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { roomSize: v })} />
        <ParamSlider label="Decay" value={reverb.decay} range={RANGES.decay} defaultValue={D.reverb.decay} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { decay: v })} />
        <ParamSlider label="Pre-delay" value={reverb.preDelay} range={RANGES.preDelay} defaultValue={D.reverb.preDelay} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { preDelay: v })} />
        <ParamSlider label="Damping" value={reverb.damping} range={RANGES.damping} defaultValue={D.reverb.damping} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { damping: v })} />
        <ParamSlider label="Stereo width" value={reverb.width} range={RANGES.width} defaultValue={D.reverb.width} disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { width: v })} />
        <ParamSlider label="Low cut" value={reverb.lowCut ?? D.reverb.lowCut} range={RANGES.lowCut} defaultValue={D.reverb.lowCut} log disabled={!reverb.enabled} onChange={(v) => setSection('reverb', { lowCut: v })} />
      </Section>

      <Section title="Bass Boost" icon="bass" enabled={bass.enabled} onToggle={(v) => setSection('bass', { enabled: v })} onReset={() => resetSection('bass')}>
        <ParamSlider label="Boost" value={bass.gain} range={RANGES.bassGain} defaultValue={D.bass.gain} signed disabled={!bass.enabled} onChange={(v) => setSection('bass', { gain: v })} />
        <ParamSlider label="Frequency" value={bass.frequency} range={RANGES.bassFreq} defaultValue={D.bass.frequency} log disabled={!bass.enabled} onChange={(v) => setSection('bass', { frequency: v })} />
      </Section>

      <Section title="Equalizer" icon="eq" enabled={eq.enabled} onToggle={(v) => setSection('eq', { enabled: v })} onReset={() => resetSection('eq')}>
        <ParamSlider label="Low (250 Hz shelf)" value={eq.low} range={RANGES.eqBand} defaultValue={0} signed disabled={!eq.enabled} onChange={(v) => setSection('eq', { low: v })} />
        <ParamSlider label="Mid (1 kHz)" value={eq.mid} range={RANGES.eqBand} defaultValue={0} signed disabled={!eq.enabled} onChange={(v) => setSection('eq', { mid: v })} />
        <ParamSlider label="High (4 kHz shelf)" value={eq.high} range={RANGES.eqBand} defaultValue={0} signed disabled={!eq.enabled} onChange={(v) => setSection('eq', { high: v })} />
      </Section>

      <Section title="Filters" icon="filter" enabled={filters.enabled} onToggle={(v) => setSection('filters', { enabled: v })} onReset={() => resetSection('filters')} defaultOpen={false}>
        <ParamSlider label="High-pass" value={filters.highpass} range={RANGES.highpass} defaultValue={D.filters.highpass} log disabled={!filters.enabled} onChange={(v) => setSection('filters', { highpass: v })} />
        <ParamSlider label="Low-pass" value={filters.lowpass} range={RANGES.lowpass} defaultValue={D.filters.lowpass} log disabled={!filters.enabled} onChange={(v) => setSection('filters', { lowpass: v })} />
      </Section>

      <Section title="Volume" icon="volume" enabled={volume.enabled} onToggle={(v) => setSection('volume', { enabled: v })} onReset={() => { resetSection('volume'); setMasterVolume(0.9) }}>
        <ParamSlider
          label="Master volume (monitor)"
          hint="Listening level only — not applied to the export"
          value={masterVolume}
          range={RANGES.master}
          defaultValue={0.9}
          onChange={setMasterVolume}
        />
        <ParamSlider label="Output gain" hint="Applied to playback and export" value={volume.outputGain} range={RANGES.outputGain} defaultValue={0} signed disabled={!volume.enabled} onChange={(v) => setSection('volume', { outputGain: v })} />
        <ParamSlider label="Stereo balance" value={volume.balance} range={RANGES.balance} defaultValue={0} signed disabled={!volume.enabled} onChange={(v) => setSection('volume', { balance: v })} />
      </Section>

      <Section title="Limiter" icon="limiter" enabled={limiter.enabled} onToggle={(v) => setSection('limiter', { enabled: v })} onReset={() => resetSection('limiter')} defaultOpen={false}>
        <ParamSlider label="Ceiling" value={limiter.ceiling} range={RANGES.ceiling} defaultValue={D.limiter.ceiling} disabled={!limiter.enabled} onChange={(v) => setSection('limiter', { ceiling: v })} />
        <p className="text-[11px] text-ink-400">Fast peak limiter at the end of the chain to prevent clipping.</p>
      </Section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-ink-900/70 px-2.5 py-1.5">
      <div className="text-ink-400">{label}</div>
      <div className={`font-mono text-sm ${accent ? 'text-accent' : 'text-ink-100'}`}>{value}</div>
    </div>
  )
}

function RenderBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
      <Icon name="reset" size={10} className="dw-spin" /> rendering
    </span>
  )
}

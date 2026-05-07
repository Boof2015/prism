import { useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { ScopeKind } from '../../types/scope'
import { SCOPE_LABELS } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import {
  MAX_SPECTROGRAM_CONTRAST,
  MIN_SPECTROGRAM_CONTRAST,
  SPECTROGRAM_CONTRAST_STEP,
} from '../../types/spectrogram'
import {
  DEFAULT_VU_REFERENCE_DBFS,
  VU_REFERENCE_MAX_DBFS,
  VU_REFERENCE_MIN_DBFS,
  VU_REFERENCE_PRESETS,
  findVUReferencePreset,
  sanitizeVUReferenceDbfs,
} from '../../types/vumeter'
import ThemedSelect from './ThemedSelect'

function vectorscopeModeLabel(mode: ScopeSettings['vectorscope']['mode']): string {
  switch (mode) {
    case 'lissajous':
      return 'Lissajous'
    case 'polar-unipolar':
      return 'Polar Uni'
    case 'polar-bipolar':
      return 'Polar Bi'
    case 'linear-unipolar':
      return 'Linear Uni'
    case 'linear-bipolar':
      return 'Linear Bi'
  }
}

function lufsReadoutLabel(readout: ScopeSettings['lufsmeter']['readout']): string {
  switch (readout) {
    case 'integrated':
      return 'Integrated'
    case 'shortTerm':
      return 'Short-term'
    case 'momentary':
      return 'Momentary'
  }
}

function nowPlayingVisibleLabels(settings: ScopeSettings['nowPlaying']): string[] {
  const labels: string[] = []
  if (settings.showCoverArt) labels.push('Cover')
  if (settings.showTitle) labels.push('Title')
  if (settings.showArtist) labels.push('Artist')
  if (settings.showProgress) labels.push('Bar')
  if (settings.showTime) labels.push('Time')
  if (settings.showControls) labels.push('Controls')
  return labels
}

export function scopeSummary(kind: ScopeKind, settings: ScopeSettings[ScopeKind]): string {
  switch (kind) {
    case 'spectrum': {
      const scopeSettings = settings as ScopeSettings['spectrum']
      const summary = `${scopeSettings.heatmap ? 'Heat' : 'Fill'} · FFT ${scopeSettings.fftSize}`
      const parts = [summary]
      if (scopeSettings.showSideLine) {
        parts.push('Side')
      }
      if (scopeSettings.peakInfoMode === 'on') {
        parts.push('Peak')
      } else if (scopeSettings.peakInfoMode === 'following') {
        parts.push('Peak Follow')
      }
      return parts.join(' · ')
    }
    case 'oscilloscope': {
      const scopeSettings = settings as ScopeSettings['oscilloscope']
      const mode = scopeSettings.pitchLock ? 'Pitch Lock' : 'Free Run'
      return scopeSettings.underfillEnabled ? `${mode} · Fill` : mode
    }
    case 'vectorscope': {
      const scopeSettings = settings as ScopeSettings['vectorscope']
      return scopeSettings.multiband
        ? `${vectorscopeModeLabel(scopeSettings.mode)} · RGB`
        : vectorscopeModeLabel(scopeSettings.mode)
    }
    case 'spectrogram': {
      const scopeSettings = settings as ScopeSettings['spectrogram']
      return `${scopeSettings.scaleMode.toUpperCase()} · ${scopeSettings.clarityMode}`
    }
    case 'vumeter': {
      const scopeSettings = settings as ScopeSettings['vumeter']
      const matchedPreset = findVUReferencePreset(scopeSettings.referenceDb)
      const refLabel = matchedPreset
        ? matchedPreset.label
        : `${scopeSettings.referenceDb.toFixed(1)} dBFS`
      const base = scopeSettings.mode === 'needle'
        ? `${scopeSettings.mode.toUpperCase()} · ${scopeSettings.needleChannels.toUpperCase()}`
        : `${scopeSettings.mode.toUpperCase()} · ${scopeSettings.orientation.toUpperCase()}`
      return `${base} · ${refLabel}`
    }
    case 'lufsmeter':
      return `${lufsReadoutLabel((settings as ScopeSettings['lufsmeter']).readout)} LUFS`
    case 'waveform': {
      const scopeSettings = settings as ScopeSettings['waveform']
      const summary = [scopeSettings.mode === 'stereo' ? 'Stereo' : 'Mono']
      if (scopeSettings.multiband) {
        summary.push('RGB')
      }
      return summary.join(' · ')
    }
    case 'nowPlaying': {
      const visible = nowPlayingVisibleLabels(settings as ScopeSettings['nowPlaying'])
      return visible.length > 0 ? visible.join(' · ') : 'Hidden'
    }
  }
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`settings-chip ${active ? 'is-active' : ''}`.trim()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function ToggleGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="settings-control settings-control--full settings-control--stack">
      <span className="settings-control__label">{label}</span>
      <div className="settings-chip-row">
        {children}
      </div>
    </div>
  )
}

function SelectControl({
  label,
  value,
  children,
  onChange,
}: {
  label: string
  value: string | number
  children: ReactNode
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="settings-control">
      <span className="settings-control__label">{label}</span>
      <ThemedSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </ThemedSelect>
    </label>
  )
}

function RangeControl({
  label,
  value,
  valueLabel,
  min,
  max,
  step,
  fullWidth = true,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  valueLabel: string
  min: number
  max: number
  step: number
  fullWidth?: boolean
  disabled?: boolean
  onChange: (value: number) => void
}): JSX.Element {
  const percent = max > min
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0

  return (
    <label className={`settings-control ${fullWidth ? 'settings-control--full' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}>
      <span className="settings-control__label">
        {label}
        <span className="settings-control__value">{valueLabel}</span>
      </span>
      <input
        className="settings-control__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--range-percent': `${percent}%` } as CSSProperties}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function VUReferenceControl({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  const matchedPreset = findVUReferencePreset(value)
  const [customExpanded, setCustomExpanded] = useState(matchedPreset === null)
  const showCustom = customExpanded || matchedPreset === null
  const selectValue = showCustom ? 'custom' : matchedPreset!.id

  return (
    <>
      <SelectControl
        label="Reference"
        value={selectValue}
        onChange={(next) => {
          if (next === 'custom') {
            setCustomExpanded(true)
            return
          }
          const preset = VU_REFERENCE_PRESETS.find((entry) => entry.id === next)
          if (preset) {
            setCustomExpanded(false)
            onChange(preset.dbfs)
          }
        }}
      >
        {VU_REFERENCE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {`${preset.label} (${preset.dbfs} dBFS) — ${preset.description}`}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </SelectControl>

      {showCustom && (
        <RangeControl
          label="Custom reference"
          value={value}
          valueLabel={`${value.toFixed(1)} dBFS`}
          min={VU_REFERENCE_MIN_DBFS}
          max={VU_REFERENCE_MAX_DBFS}
          step={0.5}
          onChange={(next) => onChange(sanitizeVUReferenceDbfs(next))}
        />
      )}
    </>
  )
}

interface ScopeSettingsSectionProps {
  kind: ScopeKind
  settings: ScopeSettings[ScopeKind]
  onUpdate: <K extends ScopeKind>(kind: K, partial: Partial<ScopeSettings[K]>) => void
}

export default function ScopeSettingsSection({
  kind,
  settings,
  onUpdate,
}: ScopeSettingsSectionProps): JSX.Element {
  return (
    <section className="settings-scope-section">
      <div className="settings-scope-section__header">
        <div className="settings-scope-section__title">{SCOPE_LABELS[kind]}</div>
        <div className="settings-scope-section__summary">{scopeSummary(kind, settings)}</div>
      </div>

      <div className="settings-scope-section__controls">
        {kind === 'spectrum' && (() => {
          const current = settings as ScopeSettings['spectrum']
          return (
            <>
              <SelectControl
                label="FFT Size"
                value={current.fftSize}
                onChange={(value) => onUpdate('spectrum', { fftSize: Number(value) })}
              >
                {[1024, 2048, 4096, 8192, 16384].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectControl>

              <SelectControl
                label="Peak"
                value={current.peakInfoMode}
                onChange={(value) => onUpdate('spectrum', {
                  peakInfoMode: value as ScopeSettings['spectrum']['peakInfoMode'],
                })}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="following">Following</option>
              </SelectControl>

              <ToggleGroup label="Display">
                <ToggleChip
                  label="Fill"
                  active={current.fillGradient}
                  onClick={() => onUpdate('spectrum', { fillGradient: !current.fillGradient })}
                />
                <ToggleChip
                  label="Heatmap"
                  active={current.heatmap}
                  onClick={() => onUpdate('spectrum', { heatmap: !current.heatmap })}
                />
                <ToggleChip
                  label="Grid"
                  active={current.showGrid}
                  onClick={() => onUpdate('spectrum', { showGrid: !current.showGrid })}
                />
                <ToggleChip
                  label="Side"
                  active={current.showSideLine}
                  onClick={() => onUpdate('spectrum', { showSideLine: !current.showSideLine })}
                />
              </ToggleGroup>

              <RangeControl
                label="Tilt"
                value={current.tiltDbPerOctave}
                valueLabel={`${current.tiltDbPerOctave.toFixed(1)} dB/oct`}
                min={0}
                max={6}
                step={0.5}
                fullWidth={false}
                onChange={(value) => onUpdate('spectrum', { tiltDbPerOctave: value })}
              />

              <RangeControl
                label="Heat Tilt"
                value={current.heatmapTiltDbPerOctave}
                valueLabel={`${current.heatmapTiltDbPerOctave.toFixed(1)} dB/oct`}
                min={0}
                max={6}
                step={0.5}
                fullWidth={false}
                disabled={!current.heatmap}
                onChange={(value) => onUpdate('spectrum', { heatmapTiltDbPerOctave: value })}
              />

              <RangeControl
                label="Heat Smoothing"
                value={current.heatmapSmoothing}
                valueLabel={current.heatmapSmoothing.toFixed(2)}
                min={0}
                max={0.99}
                step={0.01}
                fullWidth={false}
                disabled={!current.heatmap}
                onChange={(value) => onUpdate('spectrum', { heatmapSmoothing: value })}
              />

              <RangeControl
                label="Smoothing"
                value={current.smoothing}
                valueLabel={current.smoothing.toFixed(2)}
                min={0}
                max={0.99}
                step={0.01}
                fullWidth={false}
                onChange={(value) => onUpdate('spectrum', { smoothing: value })}
              />
            </>
          )
        })()}

        {kind === 'oscilloscope' && (() => {
          const current = settings as ScopeSettings['oscilloscope']
          return (
            <>
              <ToggleGroup label="Options">
                <ToggleChip
                  label="Pitch Lock"
                  active={current.pitchLock}
                  onClick={() => onUpdate('oscilloscope', { pitchLock: !current.pitchLock })}
                />
                <ToggleChip
                  label="Underfill"
                  active={current.underfillEnabled}
                  onClick={() => onUpdate('oscilloscope', { underfillEnabled: !current.underfillEnabled })}
                />
                <ToggleChip
                  label="Grid"
                  active={current.showGrid}
                  onClick={() => onUpdate('oscilloscope', { showGrid: !current.showGrid })}
                />
              </ToggleGroup>

              <RangeControl
                label="Line Width"
                value={current.lineWidth}
                valueLabel={`${current.lineWidth.toFixed(1)} px`}
                min={0.5}
                max={4}
                step={0.5}
                fullWidth={false}
                onChange={(value) => onUpdate('oscilloscope', { lineWidth: value })}
              />
            </>
          )
        })()}

        {kind === 'vectorscope' && (() => {
          const current = settings as ScopeSettings['vectorscope']
          return (
            <>
              <SelectControl
                label="Mode"
                value={current.mode}
                onChange={(value) => onUpdate('vectorscope', { mode: value as ScopeSettings['vectorscope']['mode'] })}
              >
                <option value="lissajous">Lissajous</option>
                <option value="polar-unipolar">Polar (Uni)</option>
                <option value="polar-bipolar">Polar (Bi)</option>
                <option value="linear-unipolar">Linear (Uni)</option>
                <option value="linear-bipolar">Linear (Bi)</option>
              </SelectControl>

              <ToggleGroup label="Overlays">
                <ToggleChip
                  label="RGB"
                  active={current.multiband}
                  onClick={() => onUpdate('vectorscope', { multiband: !current.multiband })}
                />
                <ToggleChip
                  label="Grid"
                  active={current.showGrid}
                  onClick={() => onUpdate('vectorscope', { showGrid: !current.showGrid })}
                />
              </ToggleGroup>

              <RangeControl
                label="Persistence"
                value={current.persistence}
                valueLabel={current.persistence.toFixed(2)}
                min={0}
                max={0.5}
                step={0.01}
                fullWidth={false}
                onChange={(value) => onUpdate('vectorscope', { persistence: value })}
              />

              <RangeControl
                label="Line Width"
                value={current.lineWidth}
                valueLabel={`${current.lineWidth.toFixed(1)} px`}
                min={0.5}
                max={4}
                step={0.5}
                fullWidth={false}
                onChange={(value) => onUpdate('vectorscope', { lineWidth: value })}
              />
            </>
          )
        })()}

        {kind === 'spectrogram' && (() => {
          const current = settings as ScopeSettings['spectrogram']
          return (
            <>
              <SelectControl
                label="FFT Size"
                value={current.fftSize}
                onChange={(value) => onUpdate('spectrogram', { fftSize: Number(value) })}
              >
                {[512, 1024, 2048, 4096].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectControl>

              <SelectControl
                label="Scale"
                value={current.scaleMode}
                onChange={(value) => onUpdate('spectrogram', { scaleMode: value as ScopeSettings['spectrogram']['scaleMode'] })}
              >
                <option value="log">Log</option>
                <option value="mel">Mel</option>
                <option value="linear">Linear</option>
              </SelectControl>

              <SelectControl
                label="Clarity"
                value={current.clarityMode}
                onChange={(value) => onUpdate('spectrogram', { clarityMode: value as ScopeSettings['spectrogram']['clarityMode'] })}
              >
                <option value="classic">Classic</option>
                <option value="sharp">Sharp</option>
                <option value="sharper">Sharper</option>
              </SelectControl>

              <SelectControl
                label="Color"
                value={current.colorScheme}
                onChange={(value) => onUpdate('spectrogram', { colorScheme: value as ScopeSettings['spectrogram']['colorScheme'] })}
              >
                <option value="heat">Heat</option>
                <option value="mono">Solid</option>
              </SelectControl>

              <RangeControl
                label="Speed"
                value={current.scrollSpeed}
                valueLabel={`x${current.scrollSpeed.toFixed(0)}`}
                min={1}
                max={8}
                step={1}
                fullWidth={false}
                onChange={(value) => onUpdate('spectrogram', { scrollSpeed: value })}
              />

              <RangeControl
                label="Contrast"
                value={current.contrast}
                valueLabel={`${current.contrast.toFixed(1)}x`}
                min={MIN_SPECTROGRAM_CONTRAST}
                max={MAX_SPECTROGRAM_CONTRAST}
                step={SPECTROGRAM_CONTRAST_STEP}
                fullWidth={false}
                onChange={(value) => onUpdate('spectrogram', { contrast: value })}
              />
            </>
          )
        })()}

        {kind === 'vumeter' && (() => {
          const current = settings as ScopeSettings['vumeter']
          return (
            <>
              <SelectControl
                label="Mode"
                value={current.mode}
                onChange={(value) => onUpdate('vumeter', { mode: value as ScopeSettings['vumeter']['mode'] })}
              >
                <option value="bar">Bar</option>
                <option value="needle">Needle</option>
              </SelectControl>

              {current.mode === 'bar' ? (
                <SelectControl
                  label="Orientation"
                  value={current.orientation}
                  onChange={(value) => onUpdate('vumeter', { orientation: value as ScopeSettings['vumeter']['orientation'] })}
                >
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </SelectControl>
              ) : (
                <SelectControl
                  label="Needles"
                  value={current.needleChannels}
                  onChange={(value) => onUpdate('vumeter', { needleChannels: value as ScopeSettings['vumeter']['needleChannels'] })}
                >
                  <option value="stereo">Stereo</option>
                  <option value="combined">Combined</option>
                </SelectControl>
              )}

              <VUReferenceControl
                value={current.referenceDb}
                onChange={(value) => onUpdate('vumeter', { referenceDb: value })}
              />

              {current.referenceDb !== DEFAULT_VU_REFERENCE_DBFS && (
                <ToggleGroup label="Calibration">
                  <ToggleChip
                    label="Reset to default"
                    active={false}
                    onClick={() => onUpdate('vumeter', { referenceDb: DEFAULT_VU_REFERENCE_DBFS })}
                  />
                </ToggleGroup>
              )}
            </>
          )
        })()}

        {kind === 'lufsmeter' && (() => {
          const current = settings as ScopeSettings['lufsmeter']
          return (
            <SelectControl
              label="Readout"
              value={current.readout}
              onChange={(value) => onUpdate('lufsmeter', { readout: value as ScopeSettings['lufsmeter']['readout'] })}
            >
              <option value="integrated">Integrated</option>
              <option value="shortTerm">Short-term</option>
              <option value="momentary">Momentary</option>
            </SelectControl>
          )
        })()}

        {kind === 'waveform' && (() => {
          const current = settings as ScopeSettings['waveform']
          return (
            <>
              <ToggleGroup label="Mode">
                <ToggleChip
                  label="Mono"
                  active={current.mode === 'mono'}
                  onClick={() => onUpdate('waveform', { mode: 'mono' })}
                />
                <ToggleChip
                  label="Stereo"
                  active={current.mode === 'stereo'}
                  onClick={() => onUpdate('waveform', { mode: 'stereo' })}
                />
              </ToggleGroup>

              <ToggleGroup label="Bands">
                <ToggleChip
                  label="Multiband"
                  active={current.multiband}
                  onClick={() => onUpdate('waveform', { multiband: !current.multiband })}
                />
              </ToggleGroup>

              <RangeControl
                label="Speed"
                value={current.scrollSpeed}
                valueLabel={`x${current.scrollSpeed.toFixed(0)}`}
                min={1}
                max={8}
                step={1}
                fullWidth={false}
                onChange={(value) => onUpdate('waveform', { scrollSpeed: value })}
              />
            </>
          )
        })()}

        {kind === 'nowPlaying' && (() => {
          const current = settings as ScopeSettings['nowPlaying']
          return (
            <ToggleGroup label="Visible Elements">
              <ToggleChip
                label="Cover"
                active={current.showCoverArt}
                onClick={() => onUpdate('nowPlaying', { showCoverArt: !current.showCoverArt })}
              />
              <ToggleChip
                label="Title"
                active={current.showTitle}
                onClick={() => onUpdate('nowPlaying', { showTitle: !current.showTitle })}
              />
              <ToggleChip
                label="Artist"
                active={current.showArtist}
                onClick={() => onUpdate('nowPlaying', { showArtist: !current.showArtist })}
              />
              <ToggleChip
                label="Bar"
                active={current.showProgress}
                onClick={() => onUpdate('nowPlaying', { showProgress: !current.showProgress })}
              />
              <ToggleChip
                label="Time"
                active={current.showTime}
                onClick={() => onUpdate('nowPlaying', { showTime: !current.showTime })}
              />
              <ToggleChip
                label="Controls"
                active={current.showControls}
                onClick={() => onUpdate('nowPlaying', { showControls: !current.showControls })}
              />
            </ToggleGroup>
          )
        })()}
      </div>
    </section>
  )
}

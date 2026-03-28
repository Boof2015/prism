import { useEffect, type CSSProperties, type JSX } from 'react'
import { useAudioStore } from '../stores/audioStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore, PRESETS, PRESET_IDS } from '../stores/themeStore'
import type { ScopeKind } from '../../types/scope'
import { SCOPE_KINDS } from '../../types/scope'

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'LUFS Meter',
  waveform: 'Waveform',
}

interface BottomBarProps {
  onClose: () => void
}

export default function BottomBar({ onClose }: BottomBarProps): JSX.Element {

  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const { presetId, accent, setPreset, setCustomAccent, customAccent } = useThemeStore()

  const {
    systemSources,
    devices,
    selectedSystemSourceId,
    selectedDeviceId,
    captureMode,
    isCapturing,
    captureStatus,
    captureError,
    inputGainDb,
    refreshSystemSources,
    refreshDevices,
    refreshBackendSupport,
    selectSystemSource,
    selectDevice,
    startCapture,
    setInputGain,
  } = useAudioStore()

  useEffect(() => {
    void refreshBackendSupport()
    void refreshSystemSources()
    void refreshDevices()
  }, [refreshBackendSupport, refreshSystemSources, refreshDevices])

  const handleSourceChange = async (value: string): Promise<void> => {
    if (value.startsWith('system:')) {
      const sourceId = value.slice('system:'.length)
      await selectSystemSource(sourceId)
      await startCapture()
      return
    }

    if (value.startsWith('device:')) {
      const deviceId = value.slice('device:'.length)
      await selectDevice(deviceId)
      await startCapture()
    }
  }

  const selectedSourceValue = captureMode === 'system'
    ? `system:${selectedSystemSourceId ?? systemSources[0]?.id ?? '__default_system_output__'}`
    : `device:${selectedDeviceId ?? ''}`

  const visibleSystemSources = systemSources.length
    ? systemSources
    : [{ id: '__default_system_output__', label: 'System Output', kind: 'system', isDefault: true }]

  const showInputDevices = devices.length > 0

  const indicatorLabel = isCapturing
    ? 'Capturing'
    : captureStatus === 'connecting'
      ? 'Connecting'
      : captureStatus === 'error'
        ? 'Capture Failed'
        : 'Idle'

  return (
    <div className="bottom-bar">
      <section className="bottom-bar__section">
        <div className="bottom-bar__section-title">Modules</div>
        <div className="bottom-bar__inline">
          {SCOPE_KINDS.map((kind) => {
            const active = !hiddenScopes.has(kind)
            return (
              <button
                key={kind}
                type="button"
                className={`settings-chip ${active ? 'is-active' : ''}`.trim()}
                onClick={() => toggleScope(kind)}
                title={SCOPE_LABELS[kind]}
              >
                {SCOPE_LABELS[kind]}
              </button>
            )
          })}
        </div>
      </section>

      <div className="bottom-bar__divider" />

      <section className="bottom-bar__section">
        <div className="bottom-bar__section-title">Theme</div>
        <div className="bottom-bar__inline">
          {PRESET_IDS.map((id) => {
            const preset = PRESETS[id]
            const active = presetId === id && !customAccent
            return (
              <button
                key={id}
                type="button"
                className={`settings-swatch ${active ? 'is-active' : ''}`.trim()}
                style={{ '--swatch-color': preset.accent } as CSSProperties}
                onClick={() => setPreset(id)}
                title={preset.name}
                aria-label={preset.name}
              />
            )
          })}
          <input
            className="settings-accent-input"
            type="color"
            value={accent}
            onChange={(event) => setCustomAccent(event.target.value)}
            title="Custom accent color"
          />
          {customAccent && (
            <button
              type="button"
              className="settings-chip"
              onClick={() => setCustomAccent(null)}
            >
              Reset
            </button>
          )}
        </div>
      </section>

      <div className="bottom-bar__divider" />

      <section className="bottom-bar__section">
        <div className="bottom-bar__section-title">Audio Source</div>
        <div className="bottom-bar__inline">
          <select
            className="settings-control__select"
            value={selectedSourceValue}
            onChange={(event) => {
              void handleSourceChange(event.target.value)
            }}
          >
            <optgroup label="Output Devices">
              {visibleSystemSources.map((source) => (
                <option key={source.id} value={`system:${source.id}`}>
                  {source.isDefault ? `${source.label} (Default)` : source.label}
                </option>
              ))}
            </optgroup>
            {showInputDevices ? (
              <optgroup label="Input Devices">
                {devices.map((device) => (
                  <option key={device.deviceId} value={`device:${device.deviceId}`}>
                    {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>

          <div className={`settings-status-pill is-${captureStatus}`.trim()}>
            <span className="settings-status-pill__dot" />
            <span>{indicatorLabel}</span>
          </div>
        </div>

        {captureError ? (
          <div className="settings-error-text">{captureError}</div>
        ) : null}
      </section>

      <div className="bottom-bar__divider" />

      <section className="bottom-bar__section">
        <div className="bottom-bar__section-title">Trim</div>
        <div className="bottom-bar__inline">
          <span className="bottom-bar__trim-value">
            {inputGainDb > 0 ? '+' : ''}{inputGainDb.toFixed(1)}dB
          </span>
          <input
            className="settings-control__range bottom-bar__trim-slider"
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={inputGainDb}
            onChange={(event) => setInputGain(Number(event.target.value))}
            onDoubleClick={() => setInputGain(0)}
          />
        </div>
      </section>

      <button
        type="button"
        className="settings-panel__close"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}

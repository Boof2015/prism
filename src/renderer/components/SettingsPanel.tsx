import { useEffect } from 'react'
import { useAudioStore } from '../stores/audioStore'
import { useSettingsStore, type ScopeSettings } from '../stores/settingsStore'
import { useThemeStore, PRESETS, PRESET_IDS } from '../stores/themeStore'
import type { ScopeKind } from '../../types/scope'

const PANEL_HEIGHT = 200

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'LUFS Meter',
  waveform: 'Waveform',
}

const labelStyle: React.CSSProperties = {
  fontSize: '9px',
  fontFamily: "'JetBrains Mono', monospace",
  color: 'rgba(255, 255, 255, 0.45)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '4px',
}

const selectStyle: React.CSSProperties = {
  backgroundColor: '#0a0a0a',
  color: 'rgba(255, 255, 255, 0.8)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '3px',
  padding: '4px 6px',
  fontSize: '11px',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  width: '100%',
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  color: 'rgba(255, 255, 255, 0.7)',
  fontFamily: 'Inter, sans-serif',
  cursor: 'pointer',
}

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const {
    devices,
    selectedDeviceId,
    captureMode,
    isCapturing,
    captureStatus,
    captureError,
    refreshDevices,
    selectDevice,
    setCaptureMode,
    startCapture,
  } = useAudioStore()
  const { scopeSettings, updateScopeSettings, hiddenScopes, scopeOrder } = useSettingsStore()
  const { presetId, accent, setPreset, setCustomAccent, customAccent } = useThemeStore()

  const visibleScopes = scopeOrder.filter((k) => !hiddenScopes.has(k))

  useEffect(() => {
    refreshDevices()
  }, [])

  const handleSourceChange = async (value: string): Promise<void> => {
    if (value === '__system__') {
      setCaptureMode('system')
      await startCapture()
    } else {
      await selectDevice(value)
      await startCapture()
    }
  }

  const indicatorColor = isCapturing
    ? '#22c55e'
    : captureStatus === 'error'
      ? '#ef4444'
      : '#71717a'
  const indicatorLabel = isCapturing
    ? 'Capturing'
    : captureStatus === 'connecting'
      ? 'Connecting...'
      : captureStatus === 'error'
        ? 'Capture Failed'
        : 'Idle'

  return (
    <div
      style={{
        height: `${PANEL_HEIGHT}px`,
        backgroundColor: '#050505',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Audio Source section */}
      <div
        style={{
          width: '200px',
          padding: '12px',
          borderRight: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        <div style={{ ...labelStyle, marginBottom: 0, fontSize: '10px', color: 'rgba(255, 255, 255, 0.55)' }}>
          Audio Source
        </div>

        <div>
          <div style={labelStyle}>Source</div>
          <select
            value={captureMode === 'system' ? '__system__' : selectedDeviceId ?? ''}
            onChange={(e) => {
              void handleSourceChange(e.target.value)
            }}
            style={selectStyle}
          >
            <option value="__system__">System Audio</option>
            <optgroup label="Devices">
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Input ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Signal indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.5)' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: indicatorColor,
              boxShadow: isCapturing ? '0 0 6px rgba(34, 197, 94, 0.4)' : 'none',
            }}
          />
          {indicatorLabel}
        </div>
        {captureError ? (
          <div style={{ fontSize: '10px', color: 'rgba(239, 68, 68, 0.8)', lineHeight: 1.4 }}>
            {captureError}
          </div>
        ) : null}

        {/* Theme section */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '10px', marginTop: '2px' }}>
          <div style={{ ...labelStyle, marginBottom: '6px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.55)' }}>
            Theme
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {PRESET_IDS.map((id) => {
              const p = PRESETS[id]
              const active = presetId === id && !customAccent
              return (
                <button
                  key={id}
                  onClick={() => setPreset(id)}
                  title={p.name}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    backgroundColor: p.accent,
                    border: active ? '2px solid #fff' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                    outline: 'none',
                    transition: 'border-color 120ms',
                  }}
                />
              )
            })}
          </div>
          <div style={{ marginTop: '6px' }}>
            <div style={labelStyle}>Custom</div>
            <input
              type="color"
              value={accent}
              onChange={(e) => setCustomAccent(e.target.value)}
              style={{
                width: '100%',
                height: '24px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '3px',
                backgroundColor: '#0a0a0a',
                cursor: 'pointer',
                padding: '2px',
              }}
            />
          </div>
        </div>
      </div>

      {/* Per-scope settings */}
      <div
        style={{
          flex: 1,
          padding: '12px',
          overflowX: 'auto',
          overflowY: 'hidden',
          display: 'flex',
          gap: '16px',
        }}
      >
        {visibleScopes.map((kind) => (
          <ScopeSettingsColumn
            key={kind}
            kind={kind}
            settings={scopeSettings}
            onUpdate={updateScopeSettings}
            accent={accent}
          />
        ))}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          right: '8px',
          bottom: '8px',
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: 'rgba(255, 255, 255, 0.4)',
          borderRadius: '3px',
          padding: '2px 8px',
          fontSize: '9px',
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}
      >
        Close
      </button>
    </div>
  )
}

function ScopeSettingsColumn({ kind, settings, onUpdate, accent }: {
  kind: ScopeKind
  settings: ScopeSettings
  onUpdate: <K extends ScopeKind>(kind: K, s: Partial<ScopeSettings[K]>) => void
  accent: string
}): JSX.Element {
  const s = settings[kind]

  return (
    <div style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ ...labelStyle, fontSize: '10px', color: accent, marginBottom: 0 }}>
        {SCOPE_LABELS[kind]}
      </div>

      {kind === 'spectrum' && (() => {
        const ss = s as ScopeSettings['spectrum']
        return (
          <>
            <div>
              <div style={labelStyle}>FFT Size</div>
              <select value={ss.fftSize} onChange={(e) => onUpdate('spectrum', { fftSize: Number(e.target.value) })} style={selectStyle}>
                {[1024, 2048, 4096, 8192, 16384].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Tilt (dB/oct)</div>
              <input type="range" min="0" max="6" step="0.5" value={ss.tiltDbPerOctave} onChange={(e) => onUpdate('spectrum', { tiltDbPerOctave: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.fillGradient} onChange={(e) => onUpdate('spectrum', { fillGradient: e.target.checked })} />
              Fill
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.heatmap} onChange={(e) => onUpdate('spectrum', { heatmap: e.target.checked })} />
              Heatmap
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.showGrid} onChange={(e) => onUpdate('spectrum', { showGrid: e.target.checked })} />
              Grid
            </label>
          </>
        )
      })()}

      {kind === 'oscilloscope' && (() => {
        const ss = s as ScopeSettings['oscilloscope']
        return (
          <>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.pitchLock} onChange={(e) => onUpdate('oscilloscope', { pitchLock: e.target.checked })} />
              Pitch Lock
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.showGrid} onChange={(e) => onUpdate('oscilloscope', { showGrid: e.target.checked })} />
              Grid
            </label>
            <div>
              <div style={labelStyle}>Line Width</div>
              <input type="range" min="0.5" max="4" step="0.5" value={ss.lineWidth} onChange={(e) => onUpdate('oscilloscope', { lineWidth: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
          </>
        )
      })()}

      {kind === 'vectorscope' && (() => {
        const ss = s as ScopeSettings['vectorscope']
        return (
          <>
            <div>
              <div style={labelStyle}>Mode</div>
              <select value={ss.mode} onChange={(e) => onUpdate('vectorscope', { mode: e.target.value as ScopeSettings['vectorscope']['mode'] })} style={selectStyle}>
                <option value="lissajous">Lissajous</option>
                <option value="polar-unipolar">Polar (Uni)</option>
                <option value="polar-bipolar">Polar (Bi)</option>
                <option value="linear-unipolar">Linear (Uni)</option>
                <option value="linear-bipolar">Linear (Bi)</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Persistence</div>
              <input type="range" min="0" max="0.5" step="0.01" value={ss.persistence} onChange={(e) => onUpdate('vectorscope', { persistence: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.multiband} onChange={(e) => onUpdate('vectorscope', { multiband: e.target.checked })} />
              Multiband
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.showGrid} onChange={(e) => onUpdate('vectorscope', { showGrid: e.target.checked })} />
              Grid
            </label>
          </>
        )
      })()}

      {kind === 'spectrogram' && (() => {
        const ss = s as ScopeSettings['spectrogram']
        return (
          <>
            <div>
              <div style={labelStyle}>FFT Size</div>
              <select value={ss.fftSize} onChange={(e) => onUpdate('spectrogram', { fftSize: Number(e.target.value) })} style={selectStyle}>
                {[512, 1024, 2048, 4096].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Scale</div>
              <select value={ss.scaleMode} onChange={(e) => onUpdate('spectrogram', { scaleMode: e.target.value as ScopeSettings['spectrogram']['scaleMode'] })} style={selectStyle}>
                <option value="log">Log</option>
                <option value="mel">Mel</option>
                <option value="linear">Linear</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Clarity</div>
              <select value={ss.clarityMode} onChange={(e) => onUpdate('spectrogram', { clarityMode: e.target.value as ScopeSettings['spectrogram']['clarityMode'] })} style={selectStyle}>
                <option value="classic">Classic</option>
                <option value="sharp">Sharp</option>
                <option value="sharper">Sharper</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Color</div>
              <select value={ss.colorScheme} onChange={(e) => onUpdate('spectrogram', { colorScheme: e.target.value as 'heat' | 'mono' })} style={selectStyle}>
                <option value="heat">Heat</option>
                <option value="mono">Mono</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Speed</div>
              <input type="range" min="1" max="8" step="1" value={ss.scrollSpeed} onChange={(e) => onUpdate('spectrogram', { scrollSpeed: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
          </>
        )
      })()}

      {kind === 'vumeter' && (() => {
        const ss = s as ScopeSettings['vumeter']
        return (
          <>
            <div>
              <div style={labelStyle}>Mode</div>
              <select value={ss.mode} onChange={(e) => onUpdate('vumeter', { mode: e.target.value as ScopeSettings['vumeter']['mode'] })} style={selectStyle}>
                <option value="bar">Bar</option>
                <option value="needle">Needle</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Orientation</div>
              <select value={ss.orientation} onChange={(e) => onUpdate('vumeter', { orientation: e.target.value as ScopeSettings['vumeter']['orientation'] })} style={selectStyle}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
          </>
        )
      })()}

      {kind === 'lufsmeter' && (() => {
        const ss = s as ScopeSettings['lufsmeter']
        return (
          <div>
            <div style={labelStyle}>Mode</div>
            <select value={ss.mode} onChange={(e) => onUpdate('lufsmeter', { mode: e.target.value as ScopeSettings['lufsmeter']['mode'] })} style={selectStyle}>
              <option value="bar">Bar</option>
            </select>
          </div>
        )
      })()}

      {kind === 'waveform' && (() => {
        const ss = s as ScopeSettings['waveform']
        return (
          <>
            <div>
              <div style={labelStyle}>Gain (dB)</div>
              <input type="range" min="-12" max="12" step="1" value={ss.gainDb} onChange={(e) => onUpdate('waveform', { gainDb: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <div>
              <div style={labelStyle}>Speed</div>
              <input type="range" min="1" max="8" step="1" value={ss.scrollSpeed} onChange={(e) => onUpdate('waveform', { scrollSpeed: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={ss.multiband} onChange={(e) => onUpdate('waveform', { multiband: e.target.checked })} />
              Multiband
            </label>
          </>
        )
      })()}
    </div>
  )
}

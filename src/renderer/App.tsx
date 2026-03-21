import { useEffect } from 'react'
import { useAudioStore } from './stores/audioStore'
import Strip from './components/Strip'

export default function App(): JSX.Element {
  const {
    devices,
    selectedDeviceId,
    captureMode,
    isCapturing,
    refreshDevices,
    selectDevice,
    setCaptureMode,
    startCapture,
    stopCapture,
  } = useAudioStore()

  // Enumerate devices on mount
  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = e.target.value
    if (value === '__system__') {
      setCaptureMode('system')
    } else {
      selectDevice(value)
    }
  }

  const handleToggleCapture = (): void => {
    if (isCapturing) {
      stopCapture()
    } else {
      startCapture()
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Scope strip — fills all available space */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Strip />
      </div>

      {/* Temporary source picker bar — will be replaced by Toolbar + Settings in Phase 6 */}
      <div
        style={{
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 8px',
          backgroundColor: 'var(--bg-secondary)',
          borderTop: '1px solid var(--glass-border)',
          flexShrink: 0,
        }}
      >
        {/* Signal indicator */}
        <div
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: isCapturing ? '#22c55e' : '#71717a',
            boxShadow: isCapturing ? '0 0 6px rgba(34, 197, 94, 0.4)' : 'none',
            transition: 'all 150ms',
            flexShrink: 0,
          }}
        />

        <select
          value={captureMode === 'system' ? '__system__' : selectedDeviceId ?? ''}
          onChange={handleSourceChange}
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--glass-border)',
            borderRadius: '3px',
            padding: '2px 6px',
            fontSize: '10px',
            fontFamily: 'Inter, sans-serif',
            outline: 'none',
            flex: 1,
            minWidth: 0,
          }}
        >
          <option value="__system__">System Audio</option>
          <optgroup label="Audio Devices">
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Input ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </optgroup>
        </select>

        <button
          onClick={handleToggleCapture}
          style={{
            backgroundColor: isCapturing ? '#dc2626' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: '3px',
            padding: '2px 10px',
            fontSize: '9px',
            fontFamily: 'JetBrains Mono, monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isCapturing ? 'Stop' : 'Start'}
        </button>
      </div>
    </div>
  )
}

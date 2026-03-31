import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type WheelEvent } from 'react'
import { useAstraStore } from '../stores/astraStore'
import { useAudioStore } from '../stores/audioStore'
import { usePerformanceStore } from '../stores/performanceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import { useUiStore } from '../stores/uiStore'
import { getHorizontalWheelScrollResult } from '../utils/horizontalWheelScroll'
import type { ScopeKind } from '../../types/scope'
import { VISUALIZER_FRAME_TARGETS, type VisualizerFrameTarget } from '../../types/performance'
import { SCOPE_KINDS } from '../../types/scope'
import type { AstraIntegrationConfig } from '../../types/astra'
import ThemedSelect from './ThemedSelect'

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'LUFS Meter',
  waveform: 'Waveform',
  astra: 'Astra',
}

interface BottomBarProps {
  onClose: () => void
  onHeightChange?: (height: number) => void
}

const FRAME_TARGET_LABELS: Record<VisualizerFrameTarget, string> = {
  10: '10',
  30: '30',
  60: '60',
  120: '120',
  144: '144',
  'display-sync': 'Sync',
}

const DEFAULT_INPUT_DEVICE_ID = '__default_input__'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

export default function BottomBar({ onClose, onHeightChange }: BottomBarProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [astraBaseUrlInput, setAstraBaseUrlInput] = useState('')
  const [astraTokenInput, setAstraTokenInput] = useState('')

  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const dockedRenderFps = usePerformanceStore((s) => s.dockedRenderFps)
  const setFrameTarget = usePerformanceStore((s) => s.setFrameTarget)
  const setThemeId = useSettingsStore((s) => s.setThemeId)
  const {
    themes,
    activeThemeId,
    loadTheme,
    showThemesFolder,
  } = useThemeStore()
  const astraState = useAstraStore((s) => s.integrationState)
  const saveAstraConfig = useAstraStore((s) => s.saveConfig)

  const {
    systemSources,
    devices,
    selectedSystemSourceId,
    selectedDeviceId,
    captureMode,
    isCapturing,
    captureStatus,
    captureError,
    captureNotice,
    inputGainDb,
    clearCaptureNotice,
    refreshSystemSources,
    refreshDevices,
    refreshBackendSupport,
    selectSystemSource,
    selectDevice,
    startCapture,
    setInputGain,
  } = useAudioStore()
  const showBanner = useUiStore((s) => s.showBanner)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  useEffect(() => {
    void refreshBackendSupport()
    void refreshSystemSources()
    void refreshDevices()
  }, [refreshBackendSupport, refreshSystemSources, refreshDevices])

  useEffect(() => {
    setAstraBaseUrlInput(astraState.config.baseUrl)
    setAstraTokenInput(astraState.config.token)
  }, [astraState.config.baseUrl, astraState.config.token])

  useLayoutEffect(() => {
    if (!onHeightChange || !rootRef.current) return

    const rootElement = rootRef.current
    let frameId = 0

    const reportHeight = (): void => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        onHeightChange(Math.ceil(rootElement.getBoundingClientRect().height))
      })
    }

    reportHeight()

    const resizeObserver = new ResizeObserver(() => {
      reportHeight()
    })

    resizeObserver.observe(rootElement)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [onHeightChange])

  const handleSourceChange = async (value: string): Promise<void> => {
    if (value.startsWith('system:')) {
      const sourceId = value.slice('system:'.length)
      await selectSystemSource(sourceId)
      await startCapture()
      return
    }

    if (value.startsWith('device:')) {
      const deviceId = value.slice('device:'.length)
      await selectDevice(deviceId === DEFAULT_INPUT_DEVICE_ID ? null : deviceId)
      await startCapture()
    }
  }

  const visibleSystemSources = systemSources.length
    ? systemSources
    : [{ id: '__default_system_output__', label: 'Default Output', kind: 'system', isDefault: true }]
  const defaultSystemSourceId = visibleSystemSources[0]?.id ?? '__default_system_output__'

  const selectedSourceValue = captureMode === 'system'
    ? `system:${selectedSystemSourceId ?? defaultSystemSourceId}`
    : `device:${selectedDeviceId ?? DEFAULT_INPUT_DEVICE_ID}`

  const indicatorLabel = isCapturing
    ? 'Capturing'
    : captureStatus === 'connecting'
      ? 'Connecting'
      : captureStatus === 'error'
        ? 'Capture Failed'
        : 'Idle'

  const trimPercent = Math.min(100, Math.max(0, ((inputGainDb + 12) / 24) * 100))
  const roundedDockedRenderFps = Math.max(0, Math.round(dockedRenderFps))
  const themeEntries = Object.entries(themes)

  const handleThemeChange = async (value: string): Promise<void> => {
    await loadTheme(value)
    setThemeId(value)
  }

  const handleSaveAstraConfig = async (): Promise<void> => {
    const nextConfig: AstraIntegrationConfig = {
      baseUrl: astraBaseUrlInput,
      token: astraTokenInput,
    }
    try {
      await saveAstraConfig(nextConfig)
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not save the Astra settings.'),
        actions: [],
      })
    }
  }

  const handleRetryCapture = async (): Promise<void> => {
    clearCaptureNotice()
    await startCapture()
  }

  const handleUseDefaultSource = async (): Promise<void> => {
    clearCaptureNotice()
    if (captureMode === 'system') {
      await selectSystemSource(defaultSystemSourceId)
    } else {
      await selectDevice(null)
    }
    await startCapture()
  }

  const handleRetryAstra = async (): Promise<void> => {
    await handleSaveAstraConfig()
  }

  const handleShowThemesFolder = async (): Promise<void> => {
    try {
      await showThemesFolder()
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not open the themes folder.'),
        actions: [],
      })
    }
  }

  const handleRailWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const railElement = event.currentTarget
    const target = event.target
    const isTargetExcluded = target instanceof Element
      && target.closest('input[type="range"], select, .settings-control__select') !== null

    const scrollResult = getHorizontalWheelScrollResult({
      clientWidth: railElement.clientWidth,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      isTargetExcluded,
      scrollLeft: railElement.scrollLeft,
      scrollWidth: railElement.scrollWidth,
    })

    if (!scrollResult) return

    railElement.scrollLeft = scrollResult.nextScrollLeft
    event.preventDefault()
  }

  const astraStatusLabel = astraState.connectionState === 'connected'
    ? 'Connected'
    : astraState.connectionState === 'connecting'
      ? 'Connecting'
      : astraState.connectionState === 'error'
        ? 'Error'
        : 'Off'
  const captureMessage = captureError ?? captureNotice
  const astraErrorMessage = astraState.lastError ?? astraState.lastControlError
  const canUseDefaultSource = captureMode === 'system'
    ? selectedSystemSourceId !== defaultSystemSourceId
    : selectedDeviceId !== null

  return (
    <div className="bottom-bar" ref={rootRef}>
      <div className="bottom-bar__rail" aria-label="Global settings" onWheel={handleRailWheel}>
        <div className="bottom-bar__rail-content">
          <section className="bottom-bar__section bottom-bar__section--modules">
            <div className="bottom-bar__section-title">Modules</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--chips">
                {SCOPE_KINDS.map((kind) => {
                  const active = scopeOrder.includes(kind) && !hiddenScopes.has(kind)
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
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--theme">
            <div className="bottom-bar__section-title">Theme</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--theme">
                <ThemedSelect
                  value={activeThemeId ?? ''}
                  onChange={(event) => {
                    void handleThemeChange(event.target.value)
                  }}
                  className="bottom-bar__select"
                >
                  {themeEntries.map(([id, theme]) => (
                    <option key={id} value={id}>
                      {theme.name}
                    </option>
                  ))}
                </ThemedSelect>
                <button
                  type="button"
                  className="settings-chip"
                  onClick={() => {
                    void handleShowThemesFolder()
                  }}
                >
                  Folder
                </button>
              </div>
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--astra">
            <div className="bottom-bar__section-title">Astra</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--theme">
                <input
                  className="bottom-bar__text-input bottom-bar__text-input--url"
                  type="text"
                  value={astraBaseUrlInput}
                  placeholder="Astra Base URL"
                  onChange={(event) => setAstraBaseUrlInput(event.target.value)}
                />

                <input
                  className="bottom-bar__text-input bottom-bar__text-input--token"
                  type="password"
                  value={astraTokenInput}
                  placeholder="Astra API Token"
                  onChange={(event) => setAstraTokenInput(event.target.value)}
                />

                <button
                  type="button"
                  className="settings-chip"
                  onClick={() => {
                    void handleSaveAstraConfig()
                  }}
                >
                  Save
                </button>

                <div className={`settings-status-pill ${astraState.connectionState === 'disabled' ? '' : `is-${astraState.connectionState}`}`.trim()}>
                  <span className="settings-status-pill__dot" />
                  <span>{astraStatusLabel}</span>
                </div>
              </div>

              {astraErrorMessage ? (
                <>
                  <div className="settings-error-text bottom-bar__error-text">{astraErrorMessage}</div>
                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      className="settings-chip"
                      onClick={() => {
                        void handleRetryAstra()
                      }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="settings-chip"
                      onClick={() => setSettingsOpen(true)}
                    >
                      Open Settings
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--source">
            <div className="bottom-bar__section-title">Audio Source</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline">
                <ThemedSelect
                  value={selectedSourceValue}
                  onChange={(event) => {
                    void handleSourceChange(event.target.value)
                  }}
                  className="bottom-bar__select"
                >
                  <optgroup label="Output Devices">
                    {visibleSystemSources.map((source) => (
                      <option key={source.id} value={`system:${source.id}`}>
                        {source.isDefault && !source.label.toLowerCase().includes('default')
                          ? `${source.label} (Default)`
                          : source.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Input Devices">
                    <option value={`device:${DEFAULT_INPUT_DEVICE_ID}`}>Default Input</option>
                    {devices.map((device) => (
                      <option key={device.deviceId} value={`device:${device.deviceId}`}>
                        {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </optgroup>
                </ThemedSelect>

                <div className={`settings-status-pill is-${captureStatus}`.trim()}>
                  <span className="settings-status-pill__dot" />
                  <span>{indicatorLabel}</span>
                </div>
              </div>

              {captureMessage ? (
                <>
                  <div className={`${captureError ? 'settings-error-text' : 'settings-info-text'} bottom-bar__error-text`.trim()}>
                    {captureMessage}
                  </div>
                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      className="settings-chip"
                      onClick={() => {
                        void handleRetryCapture()
                      }}
                    >
                      Retry
                    </button>
                    {canUseDefaultSource ? (
                      <button
                        type="button"
                        className="settings-chip"
                        onClick={() => {
                          void handleUseDefaultSource()
                        }}
                      >
                        Use Default
                      </button>
                    ) : null}
                    {!captureError && captureNotice ? (
                      <button
                        type="button"
                        className="settings-chip"
                        onClick={clearCaptureNotice}
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--performance">
            <div className="bottom-bar__section-title">Performance</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--performance">
                <div className="bottom-bar__inline bottom-bar__inline--chips">
                  {VISUALIZER_FRAME_TARGETS.map((target) => (
                    <button
                      key={String(target)}
                      type="button"
                      className={`settings-chip ${frameTarget === target ? 'is-active' : ''}`.trim()}
                      onClick={() => setFrameTarget(target)}
                      title={target === 'display-sync' ? 'Display Sync' : `Cap visualizers at ${target} FPS`}
                    >
                      {FRAME_TARGET_LABELS[target]}
                    </button>
                  ))}
                </div>

                <div className="settings-status-pill bottom-bar__fps-pill" title="Docked visualizer render FPS">
                  <span>{roundedDockedRenderFps} FPS</span>
                </div>
              </div>
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--trim">
            <div className="bottom-bar__section-title">Trim</div>
            <div className="bottom-bar__section-body">
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
                  style={{ '--range-percent': `${trimPercent}%` } as CSSProperties}
                  onChange={(event) => setInputGain(Number(event.target.value))}
                  onDoubleClick={() => setInputGain(0)}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="bottom-bar__actions">
        <button
          type="button"
          className="settings-panel__close bottom-bar__close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  )
}

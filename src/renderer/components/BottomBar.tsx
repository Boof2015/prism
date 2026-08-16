import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type WheelEvent } from 'react'
import { useNowPlayingStore } from '../stores/nowPlayingStore'
import { useAudioStore } from '../stores/audioStore'
import { usePerformanceStore } from '../stores/performanceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import { useUiStore } from '../stores/uiStore'
import { useWindowBackgroundStore } from '../stores/windowBackgroundStore'
import { useDesktopIntegrationStore } from '../stores/desktopIntegrationStore'
import { getRendererWindowCapabilities } from '../windowCapabilities'
import { getHorizontalWheelScrollResult } from '../utils/horizontalWheelScroll'
import type { ScopeKind } from '../../types/scope'
import { VISUALIZER_FRAME_TARGETS, type VisualizerFrameTarget } from '../../types/performance'
import { ROLLING_CAPTURE_DURATIONS } from '../../types/audioClip'
import { SCOPE_KINDS } from '../../types/scope'
import type { WindowBackgroundMode, WindowBackgroundState } from '../../types/windowState'
import ThemedSelect from './ThemedSelect'

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'Loudness Meter',
  waveform: 'Waveform',
  nowPlaying: 'Now Playing',
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

const WINDOW_BACKGROUND_MODES: readonly WindowBackgroundMode[] = ['solid', 'blurred', 'clear']

const WINDOW_BACKGROUND_MODE_LABELS: Record<WindowBackgroundMode, string> = {
  solid: 'Solid',
  blurred: 'Blurred',
  clear: 'Clear',
}

const WINDOW_BACKGROUND_MODE_TITLES: Record<WindowBackgroundMode, string> = {
  solid: 'Opaque themed background',
  blurred: 'Desktop shows through, blurred',
  clear: 'Desktop shows through, crisp',
}

const WINDOW_BACKGROUND_SET_THROTTLE_MS = 60

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

type ThemeCreditSource = {
  credit?: string
  website?: string
  description?: string
} | null | undefined

type ThemeOptionLabelSource = {
  name: string
  credit?: string
}

export function resolveThemeOptionLabel(theme: ThemeOptionLabelSource): string {
  const credit = typeof theme.credit === 'string' && theme.credit.trim()
    ? theme.credit.trim()
    : null

  return credit ? `${theme.name} - ${credit}` : theme.name
}

export function resolveThemeCreditDetails(theme: ThemeCreditSource): {
  credit: string | null
  url: string | null
  description: string | null
} {
  const credit = typeof theme?.credit === 'string' && theme.credit.trim()
    ? theme.credit.trim()
    : null

  if (!credit) {
    return { credit: null, url: null, description: null }
  }

  const website = typeof theme?.website === 'string' && theme.website.trim()
    ? theme.website.trim()
    : null
  const description = typeof theme?.description === 'string' && theme.description.trim()
    ? theme.description.trim()
    : null

  if (!website) {
    return { credit, url: null, description }
  }

  try {
    const parsed = new URL(website)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { credit, url: parsed.toString(), description }
    }
  } catch {
    // Invalid URLs fall back to plain credit text.
  }

  return { credit, url: null, description }
}

export default function BottomBar({ onClose, onHeightChange }: BottomBarProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isRefreshingThemes, setIsRefreshingThemes] = useState(false)
  const windowBackground = useWindowBackgroundStore((s) => s.stored)
  const previewWindowBackground = useWindowBackgroundStore((s) => s.previewBackground)
  const setWindowBackground = useWindowBackgroundStore((s) => s.setBackground)
  const supportsBlurredBackground = getRendererWindowCapabilities().supportsBlurredBackground
  const pendingWindowBackgroundRef = useRef<WindowBackgroundState | null>(null)
  const windowBackgroundFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queueWindowBackgroundSave = (next: WindowBackgroundState): void => {
    previewWindowBackground(next)
    pendingWindowBackgroundRef.current = next
    if (windowBackgroundFlushTimerRef.current) return

    windowBackgroundFlushTimerRef.current = setTimeout(() => {
      windowBackgroundFlushTimerRef.current = null
      const pending = pendingWindowBackgroundRef.current
      pendingWindowBackgroundRef.current = null
      if (pending) {
        void setWindowBackground(pending)
      }
    }, WINDOW_BACKGROUND_SET_THROTTLE_MS)
  }

  const handleWindowBackgroundMode = (mode: WindowBackgroundMode): void => {
    if (mode === windowBackground.mode) return
    void setWindowBackground({ ...windowBackground, mode })
  }

  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const dockedRenderFps = usePerformanceStore((s) => s.dockedRenderFps)
  const setFrameTarget = usePerformanceStore((s) => s.setFrameTarget)
  const {
    themes,
    activeTheme,
    activeThemeId,
    loadTheme,
    reloadThemes,
    showThemesFolder,
  } = useThemeStore()
  const nowPlayingState = useNowPlayingStore((s) => s.nowPlayingState)
  const retryNowPlayingProvider = useNowPlayingStore((s) => s.retryProvider)
  const openNowPlayingConfigWindow = useNowPlayingStore((s) => s.openConfigWindow)

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
    rollingCaptureSeconds,
    rollingCaptureStatus,
    clearCaptureNotice,
    selectSystemSource,
    selectDevice,
    startCapture,
    setInputGain,
    setRollingCaptureSeconds,
    revealRollingCaptureFolder,
  } = useAudioStore()
  const showBanner = useUiStore((s) => s.showBanner)
  const desktopIntegration = useDesktopIntegrationStore((s) => s.snapshot)
  const desktopIntegrationBusy = useDesktopIntegrationStore((s) => s.busy)
  const desktopIntegrationError = useDesktopIntegrationStore((s) => s.error)
  const setCloseToTray = useDesktopIntegrationStore((s) => s.setCloseToTray)
  const setOpenAtLogin = useDesktopIntegrationStore((s) => s.setOpenAtLogin)
  const setLoginLaunchMode = useDesktopIntegrationStore((s) => s.setLoginLaunchMode)

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
  const themeCredit = resolveThemeCreditDetails(activeTheme)

  const handleThemeChange = async (value: string): Promise<void> => {
    await loadTheme(value)
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

  const handleRetryNowPlaying = async (): Promise<void> => {
    const providerId = nowPlayingState.activeProviderId
      ?? nowPlayingState.providerPriority.find((candidate) => {
        const provider = nowPlayingState.providers[candidate]
        return provider.available && provider.isConfigured
      })

    if (!providerId) {
      await openNowPlayingConfigWindow()
      return
    }

    try {
      await retryNowPlayingProvider(providerId)
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not reconnect the provider.'),
        actions: [],
      })
    }
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

  const handleRevealRollingCaptureFolder = async (): Promise<void> => {
    try {
      await revealRollingCaptureFolder()
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not open the Prism Captures folder.'),
        actions: [],
      })
    }
  }

  const handleReloadThemes = async (): Promise<void> => {
    if (isRefreshingThemes) {
      return
    }

    setIsRefreshingThemes(true)
    try {
      await reloadThemes()
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not refresh themes.'),
        actions: [],
      })
    } finally {
      setIsRefreshingThemes(false)
    }
  }

  const handleOpenThemeWebsite = async (url: string): Promise<void> => {
    try {
      await window.electronAPI.openExternalUrl(url)
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not open the theme website.'),
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

  const currentNowPlayingProviderId = nowPlayingState.activeProviderId
    ?? nowPlayingState.providerPriority.find((providerId) => {
      const provider = nowPlayingState.providers[providerId]
      return provider.available && provider.isConfigured
    })
    ?? null
  const currentNowPlayingProvider = currentNowPlayingProviderId
    ? nowPlayingState.providers[currentNowPlayingProviderId]
    : null
  const nowPlayingStatusLabel = nowPlayingState.onboardingRequired
    ? 'Not Set Up'
    : currentNowPlayingProvider?.connectionState === 'connected'
      ? 'Connected'
      : currentNowPlayingProvider?.connectionState === 'connecting'
        ? 'Connecting'
        : currentNowPlayingProvider?.connectionState === 'error'
          ? 'Error'
          : 'Idle'
  const nowPlayingSummary = nowPlayingState.onboardingRequired
    ? 'Set up Astra to enable live track data.'
    : `Priority: ${nowPlayingState.providerPriority
      .map((providerId) => nowPlayingState.definitions[providerId].label)
      .join(' → ')}`
  const captureMessage = captureError ?? captureNotice
  const rollingCaptureStatusLabel = rollingCaptureSeconds === null
    ? 'Off'
    : rollingCaptureStatus.ready
      ? 'Ready'
      : rollingCaptureStatus.hasAudio
        ? 'Filling'
        : 'Waiting'
  const nowPlayingErrorMessage = currentNowPlayingProvider?.lastError ?? currentNowPlayingProvider?.lastControlError ?? null
  const nowPlayingDetail = nowPlayingErrorMessage
    ? `${currentNowPlayingProviderId ? `${nowPlayingState.definitions[currentNowPlayingProviderId].label} · ` : ''}${nowPlayingErrorMessage}`
    : currentNowPlayingProviderId
      ? `${nowPlayingState.definitions[currentNowPlayingProviderId].label} · ${nowPlayingSummary}`
      : nowPlayingSummary
  const canUseDefaultSource = captureMode === 'system'
    ? selectedSystemSourceId !== defaultSystemSourceId
    : selectedDeviceId !== null
  const loginItemStatusMessage = desktopIntegration.loginItemStatus === 'requires-approval'
    ? 'Approval required in system login settings'
    : desktopIntegration.loginItemStatus === 'blocked'
      ? 'Disabled in system startup settings'
      : desktopIntegration.loginItemStatus === 'unavailable'
        ? 'Open at login is available in packaged builds'
        : desktopIntegrationError

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
            <div className="bottom-bar__section-header">
              <div className="bottom-bar__section-title">Theme</div>
              {themeCredit.credit ? (
                <span className="bottom-bar__theme-metadata">
                  {themeCredit.url ? (
                    <a
                      className="bottom-bar__theme-credit bottom-bar__theme-credit--link"
                      href={themeCredit.url}
                      onClick={(event) => {
                        event.preventDefault()
                        void handleOpenThemeWebsite(themeCredit.url!)
                      }}
                    >
                      By {themeCredit.credit}
                    </a>
                  ) : (
                    <span className="bottom-bar__theme-credit">By {themeCredit.credit}</span>
                  )}
                  {themeCredit.description ? (
                    <span className="bottom-bar__theme-description">
                      <span className="bottom-bar__theme-separator" aria-hidden="true">·</span>
                      <span>{themeCredit.description}</span>
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
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
                      {resolveThemeOptionLabel(theme)}
                    </option>
                  ))}
                </ThemedSelect>
                <button
                  type="button"
                  className="settings-chip"
                  onClick={() => {
                    void handleReloadThemes()
                  }}
                  disabled={isRefreshingThemes}
                >
                  {isRefreshingThemes ? 'Refreshing...' : 'Refresh'}
                </button>
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

          <section className="bottom-bar__section bottom-bar__section--window">
            <div className="bottom-bar__section-header">
              <div className="bottom-bar__section-title">Window</div>
              {windowBackground.mode !== 'solid' || loginItemStatusMessage ? (
                <span className="bottom-bar__window-metadata">
                  {windowBackground.mode !== 'solid' ? (
                    <span className="bottom-bar__window-note">
                      Window snapping is disabled in this mode
                    </span>
                  ) : null}
                  {windowBackground.mode !== 'solid' && loginItemStatusMessage ? (
                    <span className="bottom-bar__metadata-separator" aria-hidden="true">·</span>
                  ) : null}
                  {loginItemStatusMessage ? (
                    <span
                      className={`${desktopIntegrationError ? 'settings-error-text' : 'settings-info-text'} bottom-bar__desktop-status`.trim()}
                      role="status"
                    >
                      {loginItemStatusMessage}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--window">
                <div className="bottom-bar__inline bottom-bar__inline--chips">
                  {WINDOW_BACKGROUND_MODES.map((mode) => {
                    const unsupported = mode === 'blurred' && !supportsBlurredBackground
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`settings-chip ${windowBackground.mode === mode ? 'is-active' : ''}`.trim()}
                        onClick={() => handleWindowBackgroundMode(mode)}
                        disabled={unsupported}
                        title={unsupported
                          ? 'Blurred background requires Windows 11'
                          : WINDOW_BACKGROUND_MODE_TITLES[mode]}
                      >
                        {WINDOW_BACKGROUND_MODE_LABELS[mode]}
                      </button>
                    )
                  })}
                </div>
                <span className="bottom-bar__trim-value">
                  {windowBackground.transparency}%
                </span>
                <input
                  className="settings-control__range bottom-bar__trim-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={windowBackground.transparency}
                  disabled={windowBackground.mode === 'solid'}
                  style={{ '--range-percent': `${windowBackground.transparency}%` } as CSSProperties}
                  onChange={(event) => {
                    queueWindowBackgroundSave({
                      ...windowBackground,
                      transparency: Number(event.target.value),
                    })
                  }}
                  title="How much of the desktop shows through"
                />
                <span className="bottom-bar__inline-divider" aria-hidden="true" />
                <button
                  type="button"
                  className={`settings-chip ${desktopIntegration.closeToTray ? 'is-active' : ''}`.trim()}
                  disabled={desktopIntegrationBusy}
                  onClick={() => void setCloseToTray(!desktopIntegration.closeToTray)}
                  title="Closing Prism hides every Prism window; use the tray menu to quit"
                >
                  Close to tray
                </button>
                <button
                  type="button"
                  className={`settings-chip ${desktopIntegration.openAtLogin ? 'is-active' : ''}`.trim()}
                  disabled={desktopIntegrationBusy || desktopIntegration.loginItemStatus === 'unavailable'}
                  onClick={() => void setOpenAtLogin(!desktopIntegration.openAtLogin)}
                >
                  Open at login
                </button>
                <ThemedSelect
                  value={desktopIntegration.loginLaunchMode}
                  disabled={desktopIntegrationBusy || !desktopIntegration.openAtLogin}
                  onChange={(event) => {
                    void setLoginLaunchMode(event.target.value === 'tray' ? 'tray' : 'show')
                  }}
                  className="bottom-bar__login-select"
                  title="What Prism should show when opened automatically at login"
                >
                  <option value="show">Login: Show Prism</option>
                  <option value="tray">Login: Start in tray</option>
                </ThemedSelect>
              </div>
            </div>
          </section>

          <div className="bottom-bar__divider" />

          <section className="bottom-bar__section bottom-bar__section--now-playing">
            <div className="bottom-bar__section-header bottom-bar__section-header--now-playing">
              <div className="bottom-bar__section-title">Now Playing</div>
              <div
                className={`${nowPlayingErrorMessage ? 'bottom-bar__now-playing-summary is-error' : 'bottom-bar__now-playing-summary'}`.trim()}
                title={nowPlayingDetail}
              >
                {nowPlayingDetail}
              </div>
            </div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--now-playing">
                <div className={`settings-status-pill ${currentNowPlayingProvider?.connectionState === 'disabled' || !currentNowPlayingProvider ? '' : `is-${currentNowPlayingProvider.connectionState}`}`.trim()}>
                  <span className="settings-status-pill__dot" />
                  <span>{nowPlayingStatusLabel}</span>
                </div>

                {nowPlayingErrorMessage ? (
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => {
                      void handleRetryNowPlaying()
                    }}
                  >
                    Retry
                  </button>
                ) : null}

                <button
                  type="button"
                  className="settings-chip"
                  onClick={() => {
                    void openNowPlayingConfigWindow()
                  }}
                >
                  Configure...
                </button>
              </div>
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

          <section className="bottom-bar__section bottom-bar__section--rolling-capture">
            <div className="bottom-bar__section-title">Rolling Capture</div>
            <div className="bottom-bar__section-body">
              <div className="bottom-bar__inline bottom-bar__inline--rolling-capture">
                <div className="bottom-bar__inline bottom-bar__inline--chips">
                  <button
                    type="button"
                    className={`settings-chip ${rollingCaptureSeconds === null ? 'is-active' : ''}`.trim()}
                    onClick={() => setRollingCaptureSeconds(null)}
                  >
                    Off
                  </button>
                  {ROLLING_CAPTURE_DURATIONS.map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      className={`settings-chip ${rollingCaptureSeconds === duration ? 'is-active' : ''}`.trim()}
                      onClick={() => setRollingCaptureSeconds(duration)}
                    >
                      {duration}s
                    </button>
                  ))}
                </div>

                <div
                  className={`settings-status-pill ${rollingCaptureStatus.ready ? 'is-capturing' : ''}`.trim()}
                  title={rollingCaptureSeconds === null
                    ? 'Rolling capture uses no recorder memory while off'
                    : `Keeps up to ${rollingCaptureSeconds} seconds in memory`}
                >
                  <span className="settings-status-pill__dot" />
                  <span>{rollingCaptureStatusLabel}</span>
                </div>

                <button
                  type="button"
                  className="settings-chip"
                  onClick={() => {
                    void handleRevealRollingCaptureFolder()
                  }}
                >
                  Folder
                </button>
              </div>
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

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { NowPlayingProviderDefinition, NowPlayingProviderId, NowPlayingProviderState } from '../../types/nowPlaying'
import AppBanner from './AppBanner'
import WindowResizeOverlay from './WindowResizeOverlay'
import { useNowPlayingStore } from '../stores/nowPlayingStore'
import { useThemeStore } from '../stores/themeStore'
import { useUiStore } from '../stores/uiStore'
import { getRendererWindowCapabilities } from '../windowCapabilities'

function GripIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5.5" cy="4" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="4" r="1.1" fill="currentColor" />
      <circle cx="5.5" cy="8" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.1" fill="currentColor" />
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="12" r="1.1" fill="currentColor" />
    </svg>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function MinimizeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 6.5 8 10.25 11.75 6.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AstraLogoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <g transform="matrix(1.726813 0 0 1.726813 -660.505902 -397.11951)" fill="currentColor">
        <path d="M526.083 500.65C529.86 496.662 535.112 494.402 540.605 494.402C553.071 494.402 576.056 494.402 588.831 494.402C594.652 494.402 600.185 496.939 603.984 501.35C610.054 508.396 619.61 519.49 627.207 528.31C633.905 536.085 633.631 547.668 626.573 555.117C603.295 579.689 553.937 631.788 536.916 649.755C533.139 653.742 527.889 656 522.397 656L452 656C440.954 656 432 647.046 432 636C432 626.32 432 615.247 432 607.967C432 602.851 433.96 597.93 437.478 594.215C454.783 575.942 508.184 519.551 526.083 500.65Z" />
        <path d="M580 389.237C580 378.578 588.641 369.937 599.3 369.937C625.097 369.937 669.782 369.937 688.899 369.937C694.682 369.937 700.183 372.436 703.987 376.792C736.676 414.222 893.163 593.401 921.571 625.929C924.427 629.198 926 633.392 926 637.733C926 637.733 926 637.734 926 637.734C926 648.379 917.371 657.008 906.726 657.008L817.1 657.008C811.318 657.008 805.817 654.51 802.013 650.155C769.332 612.742 612.909 433.673 584.448 401.092C581.58 397.809 580 393.598 580 389.239C580 389.238 580 389.237 580 389.237Z" />
      </g>
    </svg>
  )
}

function SpotifyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.1 6.2c2.8-.9 5.7-.8 8.1.4" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M4.8 8.5c2.1-.6 4.4-.5 6.3.3" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M5.5 10.7c1.5-.4 3.1-.4 4.4.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

function TidalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2 10.6 4.8 8 7.4 5.4 4.8Z" fill="currentColor" />
      <path d="M5 5.2 7.6 7.8 5 10.4 2.4 7.8Z" fill="currentColor" opacity="0.88" />
      <path d="M11 5.2 13.6 7.8 11 10.4 8.4 7.8Z" fill="currentColor" opacity="0.88" />
      <path d="M8 8.2 10.6 10.8 8 13.4 5.4 10.8Z" fill="currentColor" />
    </svg>
  )
}

function isToolbarInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button') !== null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function isMacOSPlatform(platform: string): boolean {
  return platform === 'darwin'
}

function isLinuxPlatform(platform: string): boolean {
  return platform === 'linux'
}

function isWindowsPlatform(platform: string): boolean {
  return platform === 'win32'
}

function getSpotifyIntegrationLabel(platform: string): string {
  if (isMacOSPlatform(platform)) {
    return 'Local macOS app'
  }

  if (isLinuxPlatform(platform)) {
    return 'Local Linux MPRIS'
  }

  if (isWindowsPlatform(platform)) {
    return 'Local Windows media session'
  }

  return 'Local Spotify integration'
}

function getSpotifyUnavailableMetaText(platform: string): string {
  if (isMacOSPlatform(platform)) {
    return 'Local macOS app unavailable'
  }

  if (isLinuxPlatform(platform)) {
    return 'Local Linux MPRIS unavailable'
  }

  if (isWindowsPlatform(platform)) {
    return 'Local Windows media session unavailable'
  }

  return 'Local Spotify integration unavailable'
}

function getSpotifyAvailabilityDetail(platform: string): string {
  if (isMacOSPlatform(platform)) {
    return 'Install Spotify.app in /Applications to enable this provider.'
  }

  if (isLinuxPlatform(platform)) {
    return 'This provider needs a Linux desktop session with Spotify MPRIS access.'
  }

  if (isWindowsPlatform(platform)) {
    return 'This provider needs Windows system media controls to expose a Spotify session.'
  }

  return 'This provider is currently available on macOS, Linux, and Windows.'
}

function getSpotifyProviderCopy(platform: string): string {
  if (isMacOSPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads the local Spotify macOS app directly.'
  }

  if (isLinuxPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads Spotify through the local Linux MPRIS session.'
  }

  if (isWindowsPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads Spotify through the local Windows media session.'
  }

  return 'No Spotify developer account or API setup is required. On supported systems, Prism reads the local Spotify app directly.'
}

function getProviderStatusLabel(
  definition: NowPlayingProviderDefinition,
  provider: NowPlayingProviderState,
): string {
  if (definition.comingSoon) {
    return 'Coming Soon'
  }

  if (!provider.available) {
    return 'Unavailable'
  }

  if (!provider.isConfigured) {
    return 'Not Set Up'
  }

  switch (provider.connectionState) {
    case 'disabled':
      return 'Idle'
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return provider.snapshot?.playbackState === 'playing' ? 'Live' : 'Connected'
    case 'error':
      return 'Error'
    case 'unavailable':
      return 'Unavailable'
  }
}

function getProviderMetaText(
  definition: NowPlayingProviderDefinition,
  provider: NowPlayingProviderState,
  platform: string,
): string {
  if (definition.comingSoon) {
    return 'Local integration coming later'
  }

  if (!provider.available) {
    return provider.providerId === 'spotify'
      ? getSpotifyUnavailableMetaText(platform)
      : 'Unavailable on this device'
  }

  if (!provider.isConfigured) {
    return 'Local API · Paste base URL and token'
  }

  if (definition.authMode === 'local') {
    const integrationLabel = getSpotifyIntegrationLabel(platform)
    switch (provider.connectionState) {
      case 'disabled':
        return `${integrationLabel} · Waiting for Spotify`
      case 'connecting':
        return `${integrationLabel} · Checking playback`
      case 'connected':
        return provider.snapshot?.playbackState === 'playing'
          ? `${integrationLabel} · Playing now`
          : `${integrationLabel} · Ready`
      case 'error':
        return `${integrationLabel} · Needs attention`
      case 'unavailable':
        return getSpotifyUnavailableMetaText(platform)
    }
  }

  switch (provider.connectionState) {
    case 'disabled':
      return 'Local API · Waiting for use'
    case 'connecting':
      return 'Local API · Connecting'
    case 'connected':
      return provider.snapshot?.playbackState === 'playing'
        ? 'Local API · Playing now'
        : 'Local API · Connected'
    case 'error':
      return 'Local API · Needs attention'
    case 'unavailable':
      return 'Coming soon'
  }
}

function moveProviderToTarget(
  providerPriority: NowPlayingProviderId[],
  sourceId: NowPlayingProviderId,
  targetId: NowPlayingProviderId,
): NowPlayingProviderId[] {
  const sourceIndex = providerPriority.indexOf(sourceId)
  const targetIndex = providerPriority.indexOf(targetId)
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return providerPriority
  }

  const nextPriority = [...providerPriority]
  const [moved] = nextPriority.splice(sourceIndex, 1)
  nextPriority.splice(targetIndex, 0, moved)
  return nextPriority
}

function getProviderBrandColor(providerId: NowPlayingProviderId): string {
  switch (providerId) {
    case 'astra':
      return '#0097ff'
    case 'spotify':
      return '#1ed760'
    case 'tidal':
      return '#f4f6f8'
  }
}

function ProviderIcon({ providerId }: { providerId: NowPlayingProviderId }): JSX.Element {
  switch (providerId) {
    case 'astra':
      return <AstraLogoIcon />
    case 'spotify':
      return <SpotifyIcon />
    case 'tidal':
      return <TidalIcon />
  }
}

export default function NowPlayingConfigWindow(): JSX.Element {
  const initializeThemes = useThemeStore((s) => s.initializeThemes)
  const initializeNowPlaying = useNowPlayingStore((s) => s.initialize)
  const nowPlayingState = useNowPlayingStore((s) => s.nowPlayingState)
  const saveProviderConfig = useNowPlayingStore((s) => s.saveProviderConfig)
  const setProviderPriority = useNowPlayingStore((s) => s.setProviderPriority)
  const retryProvider = useNowPlayingStore((s) => s.retryProvider)
  const showBanner = useUiStore((s) => s.showBanner)
  const [astraBaseUrlInput, setAstraBaseUrlInput] = useState('')
  const [astraTokenInput, setAstraTokenInput] = useState('')
  const [expandedProviderId, setExpandedProviderId] = useState<NowPlayingProviderId | null>('astra')
  const [draggedProviderId, setDraggedProviderId] = useState<NowPlayingProviderId | null>(null)
  const [dropTargetProviderId, setDropTargetProviderId] = useState<NowPlayingProviderId | null>(null)
  const useNativeDragRegions = getRendererWindowCapabilities().useNativeDragRegions
  const platform = window.electronAPI.platform

  useEffect(() => {
    let disposed = false

    void (async () => {
      await initializeThemes()
      await initializeNowPlaying()
    })().catch((error) => {
      if (disposed) return
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not initialize Now Playing.'),
        actions: [],
      })
    })

    return () => {
      disposed = true
      window.electronAPI.stopWindowMove()
    }
  }, [
    initializeNowPlaying,
    initializeThemes,
    showBanner,
  ])

  useEffect(() => {
    setAstraBaseUrlInput(nowPlayingState.configs.astra.baseUrl)
    setAstraTokenInput('')
  }, [nowPlayingState.configs.astra.baseUrl, nowPlayingState.configs.astra.hasToken])

  const handleToolbarDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (useNativeDragRegions || isToolbarInteractiveTarget(event.target) || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [useNativeDragRegions])

  const handleToolbarDragEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (useNativeDragRegions) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [useNativeDragRegions])

  const handleSaveAstraConfig = useCallback(async (): Promise<void> => {
    try {
      await saveProviderConfig('astra', {
        baseUrl: astraBaseUrlInput,
        token: astraTokenInput,
      })
      setAstraTokenInput('')
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not save the Astra settings.'),
        actions: [],
      })
    }
  }, [astraBaseUrlInput, astraTokenInput, saveProviderConfig, showBanner])

  const handleClearAstraToken = useCallback(async (): Promise<void> => {
    try {
      await saveProviderConfig('astra', {
        baseUrl: astraBaseUrlInput,
        clearToken: true,
      })
      setAstraTokenInput('')
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not clear the Astra token.'),
        actions: [],
      })
    }
  }, [astraBaseUrlInput, saveProviderConfig, showBanner])

  const orderedProviders = useMemo(
    () => nowPlayingState.providerPriority.map((providerId) => ({
      providerId,
      definition: nowPlayingState.definitions[providerId],
      provider: nowPlayingState.providers[providerId],
    })),
    [nowPlayingState],
  )

  const handleProviderDragStart = useCallback((providerId: NowPlayingProviderId, event: ReactDragEvent<HTMLDivElement>): void => {
    setDraggedProviderId(providerId)
    setDropTargetProviderId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', providerId)
  }, [])

  const handleProviderDragEnd = useCallback((): void => {
    setDraggedProviderId(null)
    setDropTargetProviderId(null)
  }, [])

  const handleProviderDrop = useCallback(async (targetId: NowPlayingProviderId): Promise<void> => {
    if (!draggedProviderId || draggedProviderId === targetId) {
      setDropTargetProviderId(null)
      return
    }

    const nextPriority = moveProviderToTarget(nowPlayingState.providerPriority, draggedProviderId, targetId)

    try {
      await setProviderPriority(nextPriority)
    } catch (error) {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not reorder providers.'),
        actions: [],
      })
    } finally {
      setDraggedProviderId(null)
      setDropTargetProviderId(null)
    }
  }, [draggedProviderId, nowPlayingState.providerPriority, setProviderPriority, showBanner])

  return (
    <div className="now-playing-config">
      <div className="now-playing-config__shell">
        <header
          className={`toolbar now-playing-config__toolbar ${useNativeDragRegions ? 'is-native-drag' : ''}`.trim()}
          onPointerDown={useNativeDragRegions ? undefined : handleToolbarDragStart}
          onPointerUp={useNativeDragRegions ? undefined : handleToolbarDragEnd}
          onPointerCancel={useNativeDragRegions ? undefined : handleToolbarDragEnd}
          onLostPointerCapture={useNativeDragRegions ? undefined : handleToolbarDragEnd}
        >
          <div className="now-playing-config__toolbar-copy">
            <div className="now-playing-config__toolbar-title">Now Playing</div>
            <div className="now-playing-config__toolbar-subtitle">
              Drag providers to set priority. Expand a row to configure local integrations or tokens.
            </div>
          </div>

          <div className="toolbar__actions">
            <button
              type="button"
              className="toolbar__icon-button"
              onClick={() => window.electronAPI.minimize()}
              aria-label="Minimize window"
              title="Minimize"
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              className="toolbar__icon-button toolbar__icon-button--danger"
              onClick={() => window.electronAPI.close()}
              aria-label="Close window"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <main className="now-playing-config__content">
          <div className="now-playing-config__stack">
            <div className="now-playing-config__intro">
              {nowPlayingState.onboardingRequired
                ? 'Start with Astra or the local Spotify integration. TIDAL stays visible here for future priority.'
                : 'The highest configured provider that starts playing takes over immediately.'}
            </div>

            <div className="now-playing-config__list">
              {orderedProviders.map(({ providerId, definition, provider }) => {
                const isExpanded = expandedProviderId === providerId
                const isDropTarget = draggedProviderId !== null
                  && draggedProviderId !== providerId
                  && dropTargetProviderId === providerId
                const providerStyle = {
                  '--provider-brand': getProviderBrandColor(providerId),
                } as CSSProperties
                const statusLabel = getProviderStatusLabel(definition, provider)
                const statusClass = provider.connectionState === 'disabled' || provider.connectionState === 'unavailable'
                  ? 'settings-status-pill'
                  : `settings-status-pill is-${provider.connectionState}`

                return (
                  <section
                    key={providerId}
                    className={[
                      'now-playing-config__provider',
                      isExpanded ? 'is-expanded' : '',
                      providerId === nowPlayingState.activeProviderId ? 'is-live' : '',
                      isDropTarget ? 'is-drop-target' : '',
                    ].join(' ').trim()}
                    onDragOver={(event) => {
                      if (!draggedProviderId || draggedProviderId === providerId) return
                      event.preventDefault()
                      if (dropTargetProviderId !== providerId) {
                        setDropTargetProviderId(providerId)
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      void handleProviderDrop(providerId)
                    }}
                  >
                    <div className="now-playing-config__provider-header">
                      <div
                        className={`now-playing-config__provider-handle ${draggedProviderId === providerId ? 'is-dragging' : ''}`.trim()}
                        draggable
                        onDragStart={(event) => handleProviderDragStart(providerId, event)}
                        onDragEnd={handleProviderDragEnd}
                        aria-label={`Drag to reorder ${definition.label}`}
                        title={`Drag to reorder ${definition.label}`}
                      >
                        <GripIcon />
                      </div>

                      <button
                        type="button"
                        className="now-playing-config__provider-summary"
                        onClick={() => {
                          setExpandedProviderId((current) => current === providerId ? null : providerId)
                        }}
                      >
                        <span className="now-playing-config__provider-icon-shell" style={providerStyle}>
                          <ProviderIcon providerId={providerId} />
                        </span>

                        <span className="now-playing-config__provider-copy">
                          <span className="now-playing-config__provider-name-row">
                            <span className="now-playing-config__provider-name">{definition.label}</span>
                            {providerId === nowPlayingState.activeProviderId ? (
                              <span className="now-playing-config__provider-live">Live</span>
                            ) : null}
                          </span>
                          <span className="now-playing-config__provider-meta">
                            {getProviderMetaText(definition, provider, platform)}
                          </span>
                        </span>

                        <span className={`${statusClass} now-playing-config__provider-status`.trim()}>
                          <span className="settings-status-pill__dot" />
                          <span>{statusLabel}</span>
                        </span>

                        <span className={`now-playing-config__provider-chevron ${isExpanded ? 'is-expanded' : ''}`.trim()} aria-hidden="true">
                          <ChevronIcon />
                        </span>
                      </button>
                    </div>

                    {isExpanded ? (
                      providerId === 'astra' ? (
                        <div className="now-playing-config__provider-body">
                          <div className="now-playing-config__provider-body-copy">
                            {definition.description}
                          </div>

                          <div className="now-playing-config__form-grid">
                            <label className="now-playing-config__field">
                              <span className="now-playing-config__field-label">Base URL</span>
                              <input
                                className="bottom-bar__text-input now-playing-config__input"
                                type="text"
                                value={astraBaseUrlInput}
                                placeholder="http://127.0.0.1:38401"
                                onChange={(event) => setAstraBaseUrlInput(event.target.value)}
                              />
                            </label>

                            <label className="now-playing-config__field">
                              <span className="now-playing-config__field-label">API Token</span>
                              <input
                                className="bottom-bar__text-input now-playing-config__input"
                                type="password"
                                value={astraTokenInput}
                                placeholder={nowPlayingState.configs.astra.hasToken ? 'Leave blank to keep the stored token' : 'Astra API Token'}
                                onChange={(event) => setAstraTokenInput(event.target.value)}
                              />
                            </label>
                          </div>

                          <div className="settings-info-text">
                            {nowPlayingState.configs.astra.hasToken
                              ? 'A token is already stored securely. Save with a blank field to keep it, or enter a new token to replace it.'
                              : 'No Astra token is stored yet.'}
                          </div>

                          <div className="settings-inline-actions now-playing-config__provider-actions">
                            <button
                              type="button"
                              className="settings-chip"
                              onClick={() => {
                                void handleSaveAstraConfig()
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="settings-chip"
                              disabled={!nowPlayingState.configs.astra.hasToken}
                              onClick={() => {
                                void handleClearAstraToken()
                              }}
                            >
                              Clear Token
                            </button>
                            <button
                              type="button"
                              className="settings-chip"
                              disabled={!provider.isConfigured}
                              onClick={() => {
                                void retryProvider('astra').catch((error) => {
                                  showBanner({
                                    tone: 'error',
                                    message: getErrorMessage(error, 'Could not reconnect to Astra.'),
                                    actions: [],
                                  })
                                })
                              }}
                            >
                              Retry
                            </button>
                          </div>

                          {provider.lastError || provider.lastControlError ? (
                            <div className="settings-error-text now-playing-config__provider-error">
                              {provider.lastError ?? provider.lastControlError}
                            </div>
                          ) : null}
                        </div>
                      ) : definition.comingSoon ? (
                        <div className="now-playing-config__provider-body">
                          <div className="now-playing-config__coming-soon">
                            {definition.description}
                          </div>
                          <div className="settings-info-text">
                            This row stays visible so you can set future priority before the integration lands.
                          </div>
                        </div>
                      ) : (
                        <div className="now-playing-config__provider-body">
                          <div className="now-playing-config__provider-body-copy">
                            {definition.description}
                          </div>
                          <div className="settings-info-text">
                            {getSpotifyProviderCopy(platform)}
                          </div>
                          <div className="settings-inline-actions now-playing-config__provider-actions">
                            <button
                              type="button"
                              className="settings-chip"
                              disabled={!provider.available}
                              onClick={() => {
                                void retryProvider('spotify').catch((error) => {
                                  showBanner({
                                    tone: 'error',
                                    message: getErrorMessage(error, 'Could not reconnect to Spotify.'),
                                    actions: [],
                                  })
                                })
                              }}
                            >
                              Retry
                            </button>
                          </div>
                          {!provider.available ? (
                            <div className="settings-info-text">
                              {getSpotifyAvailabilityDetail(platform)}
                          </div>
                          ) : null}
                          {provider.lastError || provider.lastControlError ? (
                            <div className="settings-error-text now-playing-config__provider-error">
                              {provider.lastError ?? provider.lastControlError}
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : null}
                  </section>
                )
              })}
            </div>
          </div>
        </main>
      </div>

      <AppBanner />
      <WindowResizeOverlay />
    </div>
  )
}

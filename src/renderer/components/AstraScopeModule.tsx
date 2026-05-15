import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import type { NowPlayingProviderId } from '../../types/nowPlaying'
import type { ScopeSettings } from '../../types/settings'
import type { ResolvedNowPlayingTheme } from '../../types/theme'
import { useNowPlayingStore } from '../stores/nowPlayingStore'
import { formatAstraTime, getAstraPlaybackProgress } from '../utils/astra'
import { useUiStore } from '../stores/uiStore'

interface AstraScopeModuleProps {
  theme: ResolvedNowPlayingTheme
  settings: ScopeSettings['nowPlaying']
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

function hasVisibleFields(settings: ScopeSettings['nowPlaying']): boolean {
  return settings.showCoverArt
    || settings.showTitle
    || settings.showArtist
    || settings.showProgress
    || settings.showTime
    || settings.showControls
}

function getConfiguredProviderId(
  state: ReturnType<typeof useNowPlayingStore.getState>['nowPlayingState'],
): NowPlayingProviderId | null {
  return state.providerPriority.find((providerId) => {
    const provider = state.providers[providerId]
    return provider.available && provider.isConfigured
  }) ?? null
}

function getFallbackTitle(
  providerId: NowPlayingProviderId | null,
  connectionState: 'disabled' | 'connecting' | 'connected' | 'error' | 'unavailable' | null,
  platform: string,
): string {
  if (connectionState === null) {
    return 'Nothing playing'
  }

  if (providerId === 'spotify') {
    switch (connectionState) {
      case 'disabled':
        return 'Spotify is idle'
      case 'connecting':
        return 'Checking Spotify'
      case 'error':
        return 'Spotify connection failed'
      case 'connected':
        return 'Nothing playing'
      case 'unavailable':
        if (isMacOSPlatform(platform)) {
          return 'Spotify unavailable'
        }

        if (isLinuxPlatform(platform)) {
          return 'Spotify MPRIS unavailable'
        }

        if (isWindowsPlatform(platform)) {
          return 'Spotify media session unavailable'
        }

        return 'Spotify unavailable'
    }
  }

  if (providerId !== 'astra') {
    return 'Nothing playing'
  }

  switch (connectionState) {
    case 'disabled':
      return 'Astra is off'
    case 'connecting':
      return 'Connecting to Astra'
    case 'error':
      return 'Astra connection failed'
    case 'connected':
      return 'Nothing playing'
    case 'unavailable':
      return 'Provider unavailable'
  }
}

function getFallbackDetail(
  providerId: NowPlayingProviderId | null,
  connectionState: 'disabled' | 'connecting' | 'connected' | 'error' | 'unavailable' | null,
  platform: string,
): string {
  if (connectionState === null) {
    return ''
  }

  if (providerId === 'spotify') {
    switch (connectionState) {
      case 'disabled':
        if (isMacOSPlatform(platform)) {
          return 'Open Spotify on this Mac to show local playback here.'
        }

        if (isLinuxPlatform(platform)) {
          return 'Open Spotify on this Linux desktop to show local playback here.'
        }

        if (isWindowsPlatform(platform)) {
          return 'Open Spotify on this PC to show local playback here.'
        }

        return 'Open Spotify to show local playback here.'
      case 'connecting':
        if (isMacOSPlatform(platform)) {
          return 'Waiting for the local Spotify app.'
        }

        if (isLinuxPlatform(platform)) {
          return 'Waiting for the local Spotify MPRIS session.'
        }

        if (isWindowsPlatform(platform)) {
          return 'Waiting for the local Windows media session.'
        }

        return 'Waiting for the local Spotify integration.'
      case 'error':
        if (isMacOSPlatform(platform)) {
          return 'Check Spotify access in System Settings > Privacy & Security > Automation.'
        }

        if (isLinuxPlatform(platform)) {
          return 'Check that your Linux desktop session exposes Spotify over MPRIS.'
        }

        if (isWindowsPlatform(platform)) {
          return 'Check that Windows media controls can see a Spotify session.'
        }

        return 'Check that Spotify is available through the local system media controls.'
      case 'connected':
        return ''
      case 'unavailable':
        if (isMacOSPlatform(platform)) {
          return 'Install Spotify.app to enable this provider.'
        }

        if (isLinuxPlatform(platform)) {
          return 'Linux desktop media controls are unavailable for Spotify on this system.'
        }

        if (isWindowsPlatform(platform)) {
          return 'Windows system media controls are unavailable for Spotify on this system.'
        }

        return 'This local Spotify integration is currently available on macOS, Linux, and Windows.'
    }
  }

  if (providerId !== 'astra') {
    return ''
  }

  switch (connectionState) {
    case 'disabled':
      return 'Open the Now Playing configuration to connect Astra.'
    case 'connecting':
      return 'Waiting for the Astra API.'
    case 'error':
      return 'Check the Astra base URL and token.'
    case 'connected':
      return ''
    case 'unavailable':
      return 'This provider is not available yet.'
  }
}

export default function AstraScopeModule({
  theme,
  settings,
}: AstraScopeModuleProps): JSX.Element {
  const initialize = useNowPlayingStore((s) => s.initialize)
  const nowPlayingState = useNowPlayingStore((s) => s.nowPlayingState)
  const isSendingControl = useNowPlayingStore((s) => s.isSendingControl)
  const sendControl = useNowPlayingStore((s) => s.sendControl)
  const retryProvider = useNowPlayingStore((s) => s.retryProvider)
  const openConfigWindow = useNowPlayingStore((s) => s.openConfigWindow)
  const showBanner = useUiStore((s) => s.showBanner)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    void initialize()
  }, [initialize])

  const configuredProviderId = useMemo(
    () => getConfiguredProviderId(nowPlayingState),
    [nowPlayingState],
  )
  const displayProviderId = nowPlayingState.activeProviderId ?? configuredProviderId
  const providerState = displayProviderId
    ? nowPlayingState.providers[displayProviderId]
    : null
  const providerDefinition = displayProviderId
    ? nowPlayingState.definitions[displayProviderId]
    : null
  const platform = window.electronAPI.platform

  useEffect(() => {
    if (providerState?.snapshot?.playbackState !== 'playing') {
      return
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 250)

    return () => {
      window.clearInterval(timer)
    }
  }, [providerState?.snapshot?.playbackState])

  const snapshot = providerState?.snapshot ?? null
  const currentTrack = snapshot?.currentTrack ?? null
  const liveProgress = useMemo(
    () => getAstraPlaybackProgress(snapshot, nowMs),
    [nowMs, snapshot],
  )
  const errorMessage = providerState?.lastError ?? providerState?.lastControlError ?? null
  const detailMessage = currentTrack?.artist
    ?? (providerState?.connectionState === 'connected'
      ? null
      : getFallbackDetail(displayProviderId, providerState?.connectionState ?? null, platform))
  const style = {
    '--astra-accent': theme.accent,
    '--astra-bg': theme.background,
    '--astra-surface': theme.surface,
    '--astra-border': theme.border,
    '--astra-button-bg': theme.buttonBg,
    '--astra-button-bg-hover': theme.buttonBgHover,
    '--astra-button-bg-active': theme.buttonBgActive,
    '--astra-button-border': theme.buttonBorder,
    '--astra-button-text': theme.buttonText,
    '--astra-text': theme.text,
    '--astra-subtext': theme.subtext,
    '--astra-progress-track': theme.progressTrack,
    '--astra-progress-fill': theme.progressFill,
    '--astra-status-ok': theme.statusOk,
    '--astra-status-error': theme.statusError,
  } as CSSProperties

  if (!hasVisibleFields(settings)) {
    return (
      <div className="astra-scope astra-scope--empty" style={style}>
        <div className="astra-scope__placeholder">
          All Now Playing elements are hidden.
        </div>
      </div>
    )
  }

  if (nowPlayingState.onboardingRequired) {
    return (
      <div className="astra-scope astra-scope--empty" style={style}>
        <div className="astra-scope__placeholder">
          <div className="astra-scope__empty-title">Not configured</div>
          <div className="astra-scope__empty-detail">
            Set up a provider to show track metadata and playback controls here.
          </div>
          <button
            type="button"
            className="astra-scope__control astra-scope__control--primary"
            onClick={() => {
              void openConfigWindow()
            }}
          >
            Set Up Now Playing
          </button>
        </div>
      </div>
    )
  }

  const toggleCommand = snapshot?.playbackState === 'playing' ? 'pause' : 'play'
  const toggleLabel = snapshot?.playbackState === 'playing' ? 'Pause' : 'Play'
  const toggleIcon = snapshot?.playbackState === 'playing' ? '\u23F8' : '\u25B6'
  const shouldShowMeta = settings.showTitle || (settings.showArtist && Boolean(detailMessage))
  const shouldShowTransport = settings.showProgress || settings.showTime
  const shouldShowBody = shouldShowMeta
    || shouldShowTransport
    || settings.showControls
    || Boolean(errorMessage)
  const isCoverArtOnly = settings.showCoverArt && !shouldShowBody
  const cardClassName = [
    'astra-scope__card',
    !settings.showCoverArt ? 'astra-scope__card--no-cover' : '',
    isCoverArtOnly ? 'astra-scope__card--cover-only' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="astra-scope" style={style}>
      <div className={cardClassName}>
        {settings.showCoverArt && (
          <div className="astra-scope__cover-shell">
            {currentTrack?.artworkDataUrl ? (
              <img
                className="astra-scope__cover"
                src={currentTrack.artworkDataUrl}
                alt={currentTrack.title}
              />
            ) : (
              <div className="astra-scope__cover astra-scope__cover--fallback" aria-hidden="true">
                <span>A</span>
              </div>
            )}
          </div>
        )}

        {shouldShowBody && (
          <div className="astra-scope__body">
            {shouldShowMeta && (
              <div className="astra-scope__meta">
                {settings.showTitle && (
                  <div className="astra-scope__title" title={currentTrack?.title ?? getFallbackTitle(displayProviderId, providerState?.connectionState ?? null, platform)}>
                    {currentTrack?.title ?? getFallbackTitle(displayProviderId, providerState?.connectionState ?? null, platform)}
                  </div>
                )}
                {settings.showArtist && detailMessage && (
                  <div className="astra-scope__artist" title={detailMessage}>
                    {detailMessage}
                  </div>
                )}
              </div>
            )}

            {shouldShowTransport && (
              <div className="astra-scope__transport">
                {settings.showProgress && (
                  <div className="astra-scope__progress" aria-hidden="true">
                    <div
                      className="astra-scope__progress-fill"
                      style={{ width: `${Math.max(0, Math.min(100, liveProgress.progress * 100))}%` }}
                    />
                  </div>
                )}
                {settings.showTime && (
                  <div className="astra-scope__time">
                    <span>{formatAstraTime(liveProgress.currentTime)}</span>
                    <span>/</span>
                    <span>{liveProgress.duration > 0 ? formatAstraTime(liveProgress.duration) : '--:--'}</span>
                  </div>
                )}
              </div>
            )}

            {settings.showControls && (
              <div className="astra-scope__controls">
                <button
                  type="button"
                  className="astra-scope__control astra-scope__control--transport"
                  disabled={!currentTrack || isSendingControl || !providerDefinition?.supportsTransportControls}
                  onClick={() => {
                    void sendControl('previous')
                  }}
                  aria-label="Previous track"
                  title="Previous track"
                >
                  <span className="astra-scope__control-icon" aria-hidden="true">
                    &#9198;
                  </span>
                </button>
                <button
                  type="button"
                  className="astra-scope__control astra-scope__control--transport astra-scope__control--transport-primary"
                  disabled={!currentTrack || isSendingControl || !providerDefinition?.supportsTransportControls}
                  onClick={() => {
                    void sendControl(toggleCommand)
                  }}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                >
                  <span className="astra-scope__control-icon" aria-hidden="true">
                    {toggleIcon}
                  </span>
                </button>
                <button
                  type="button"
                  className="astra-scope__control astra-scope__control--transport"
                  disabled={!currentTrack || isSendingControl || !providerDefinition?.supportsTransportControls}
                  onClick={() => {
                    void sendControl('next')
                  }}
                  aria-label="Next track"
                  title="Next track"
                >
                  <span className="astra-scope__control-icon" aria-hidden="true">
                    &#9197;
                  </span>
                </button>
              </div>
            )}

            {errorMessage && (
              <>
                <div
                  className="astra-scope__status is-error"
                >
                  {errorMessage}
                </div>
                <div className="astra-scope__status-actions">
                  <button
                    type="button"
                    className="astra-scope__control"
                    onClick={() => {
                      if (!displayProviderId) {
                        return
                      }

                      void retryProvider(displayProviderId).catch((error) => {
                        showBanner({
                          tone: 'error',
                          message: getErrorMessage(error, 'Could not reconnect to the provider.'),
                          actions: [],
                        })
                      })
                    }}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="astra-scope__control"
                    onClick={() => {
                      void openConfigWindow()
                    }}
                  >
                    Configure
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

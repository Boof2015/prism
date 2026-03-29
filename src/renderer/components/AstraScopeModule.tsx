import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import type { ScopeSettings } from '../../types/settings'
import type { ResolvedAstraTheme } from '../../types/theme'
import { useAstraStore } from '../stores/astraStore'
import { formatAstraTime, getAstraPlaybackProgress } from '../utils/astra'

interface AstraScopeModuleProps {
  theme: ResolvedAstraTheme
  settings: ScopeSettings['astra']
}

function hasVisibleFields(settings: ScopeSettings['astra']): boolean {
  return settings.showCoverArt
    || settings.showTitle
    || settings.showArtist
    || settings.showProgress
    || settings.showTime
    || settings.showControls
}

function getFallbackTitle(connectionState: ReturnType<typeof useAstraStore.getState>['integrationState']['connectionState']): string {
  switch (connectionState) {
    case 'disabled':
      return 'Astra is off'
    case 'connecting':
      return 'Connecting to Astra'
    case 'error':
      return 'Astra connection failed'
    case 'connected':
      return 'Nothing playing'
  }
}

function getFallbackDetail(connectionState: ReturnType<typeof useAstraStore.getState>['integrationState']['connectionState']): string {
  switch (connectionState) {
    case 'disabled':
      return 'Open the Astra scope to connect.'
    case 'connecting':
      return 'Waiting for the Astra API.'
    case 'error':
      return 'Check the Astra base URL and token.'
    case 'connected':
      return ''
  }
}

export default function AstraScopeModule({
  theme,
  settings,
}: AstraScopeModuleProps): JSX.Element {
  const initialize = useAstraStore((s) => s.initialize)
  const setScopeActive = useAstraStore((s) => s.setScopeActive)
  const integrationState = useAstraStore((s) => s.integrationState)
  const isSendingControl = useAstraStore((s) => s.isSendingControl)
  const sendControl = useAstraStore((s) => s.sendControl)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    void initialize()
    void setScopeActive(true)
    return () => {
      void setScopeActive(false)
    }
  }, [initialize, setScopeActive])

  useEffect(() => {
    if (integrationState.snapshot?.playbackState !== 'playing') {
      return
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 250)

    return () => {
      window.clearInterval(timer)
    }
  }, [integrationState.snapshot?.playbackState])

  const snapshot = integrationState.snapshot
  const currentTrack = snapshot?.currentTrack ?? null
  const liveProgress = useMemo(
    () => getAstraPlaybackProgress(snapshot, nowMs),
    [nowMs, snapshot],
  )
  const errorMessage = integrationState.lastError ?? integrationState.lastControlError
  const detailMessage = currentTrack?.artist
    ?? (integrationState.connectionState === 'connected' ? null : getFallbackDetail(integrationState.connectionState))
  const style = {
    '--astra-accent': theme.accent,
    '--astra-bg': theme.background,
    '--astra-surface': theme.surface,
    '--astra-border': theme.border,
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
          All Astra elements are hidden.
        </div>
      </div>
    )
  }

  const toggleCommand = snapshot?.playbackState === 'playing' ? 'pause' : 'play'
  const toggleLabel = snapshot?.playbackState === 'playing' ? 'Pause' : 'Play'
  const cardClassName = settings.showCoverArt
    ? 'astra-scope__card'
    : 'astra-scope__card astra-scope__card--no-cover'

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

        <div className="astra-scope__body">
          {(settings.showTitle || settings.showArtist) && (
            <div className="astra-scope__meta">
              {settings.showTitle && (
                <div className="astra-scope__title" title={currentTrack?.title ?? getFallbackTitle(integrationState.connectionState)}>
                  {currentTrack?.title ?? getFallbackTitle(integrationState.connectionState)}
                </div>
              )}
              {settings.showArtist && detailMessage && (
                <div className="astra-scope__artist" title={detailMessage}>
                  {detailMessage}
                </div>
              )}
            </div>
          )}

          {(settings.showProgress || settings.showTime) && (
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
                className="astra-scope__control"
                disabled={!currentTrack || isSendingControl}
                onClick={() => {
                  void sendControl('previous')
                }}
                aria-label="Previous track"
                title="Previous track"
              >
                &#9198;
              </button>
              <button
                type="button"
                className="astra-scope__control astra-scope__control--primary"
                disabled={!currentTrack || isSendingControl}
                onClick={() => {
                  void sendControl(toggleCommand)
                }}
                aria-label={toggleLabel}
                title={toggleLabel}
              >
                {toggleLabel}
              </button>
              <button
                type="button"
                className="astra-scope__control"
                disabled={!currentTrack || isSendingControl}
                onClick={() => {
                  void sendControl('next')
                }}
                aria-label="Next track"
                title="Next track"
              >
                &#9197;
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              className="astra-scope__status is-error"
            >
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

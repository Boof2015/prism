import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ScopePopoutSnapshot } from '../../types/popout'
import { SCOPE_LABELS, type ScopeKind } from '../../types/scope'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../../types/settings'
import { applyResolvedThemeToDocument, createDefaultTheme, resolveTheme } from '../../shared/themeState'
import ScopeModule from '../components/ScopeModule'
import ScopeSettingsSection from '../components/ScopeSettingsSection'
import WindowResizeOverlay from '../components/WindowResizeOverlay'
import { usePerformanceStore } from '../stores/performanceStore'
import { useUiStore } from '../stores/uiStore'
import { useWindowBackgroundStore } from '../stores/windowBackgroundStore'
import { getRendererWindowCapabilities } from '../windowCapabilities'
import { ScopePopoutDataSource } from './ScopePopoutDataSource'
import { FrameScheduler } from '../visualizers/frameScheduler'

function PopInIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.5 3.5h-4M12.5 3.5v4M11.8 4.2 8.6 7.4M3.5 8.5v4h4M4.2 11.8 7.6 8.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 118 118" aria-hidden="true">
      <path d="M104.811 35.1118L102.384 30.9002C100.549 27.7151 99.6313 26.1225 98.0697 25.4874C96.5082 24.8524 94.7421 25.3535 91.2105 26.3557L85.2112 28.0456C82.9564 28.5655 80.5905 28.2706 78.5319 27.2127L76.8755 26.2571C75.1099 25.1263 73.7519 23.4591 73.0002 21.4993L71.3585 16.5955C70.2788 13.3504 69.7389 11.7279 68.4537 10.7998C67.169 9.87175 65.4619 9.87175 62.0478 9.87175H56.5667C53.1531 9.87175 51.446 9.87175 50.1608 10.7998C48.8758 11.7279 48.336 13.3504 47.2564 16.5955L45.6145 21.4993C44.8628 23.4591 43.5048 25.1263 41.7394 26.2571L40.083 27.2127C38.0242 28.2706 35.6585 28.5655 33.4037 28.0456L27.4042 26.3557C23.8724 25.3535 22.1065 24.8524 20.5451 25.4874C18.9836 26.1225 18.066 27.7151 16.2306 30.9002L13.8038 35.1118C12.0834 38.0975 11.2232 39.5903 11.3902 41.1795C11.5571 42.7687 12.7087 44.0493 15.0118 46.6106L20.0811 52.2779C21.3201 53.8464 22.1997 56.58 22.1997 59.0379C22.1997 61.4967 21.3204 64.2294 20.0812 65.7983L15.0118 71.4657C12.7087 74.0273 11.5572 75.3076 11.3902 76.8972C11.2232 78.4862 12.0834 79.9789 13.8038 82.9643L16.2306 87.1759C18.0659 90.361 18.9836 91.954 20.5451 92.5887C22.1065 93.2239 23.8724 92.7229 27.4043 91.7204L33.4035 90.0306C35.6587 89.5104 38.0248 89.8059 40.0839 90.8639L41.74 91.8197C43.5051 92.9506 44.8628 94.6173 45.6143 96.5771L47.2564 101.481C48.336 104.726 48.8758 106.349 50.1608 107.277C51.446 108.205 53.1531 108.205 56.5667 108.205H62.0478C65.4619 108.205 67.169 108.205 68.4537 107.277C69.7389 106.349 70.2788 104.726 71.3585 101.481L73.0007 96.5771C73.7519 94.6173 75.1094 92.9506 76.875 91.8197L78.5309 90.8639C80.59 89.8059 82.9559 89.5104 85.2112 90.0306L91.2105 91.7204C94.7421 92.7229 96.5082 93.2239 98.0697 92.5887C99.6313 91.954 100.549 90.361 102.384 87.1759L104.811 82.9643C106.531 79.9789 107.391 78.4862 107.225 76.8972C107.057 75.3076 105.906 74.0273 103.603 71.4657L98.5334 65.7983C97.2944 64.2294 96.4148 61.4967 96.4148 59.0379C96.4148 56.58 97.2949 53.8464 98.5334 52.2779L103.603 46.6106C105.906 44.0493 107.057 42.7687 107.225 41.1795C107.391 39.5903 106.531 38.0975 104.811 35.1118Z" fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
      <path d="M76.3042 59C76.3042 68.5039 68.5998 76.2083 59.0959 76.2083C49.592 76.2083 41.8877 68.5039 41.8877 59C41.8877 49.4961 49.592 41.7917 59.0959 41.7917C68.5998 41.7917 76.3042 49.4961 76.3042 59Z" fill="none" stroke="currentColor" strokeWidth="8.5" />
    </svg>
  )
}

function PinIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.9 2.5 13 4.6 10.8 7v2.2l-1 1L8 8.4 4.8 11.6 4 10.8l3.2-3.2-1.8-1.8 1-1H8.6z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

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

interface ScopePopoutWindowProps {
  scopeKind: ScopeKind
}

const POPOUT_SETTINGS_EXPAND_HEIGHT = 260
const defaultTheme = resolveTheme(createDefaultTheme())

export default function ScopePopoutWindow({ scopeKind }: ScopePopoutWindowProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ScopePopoutSnapshot<ScopeKind> | null>(null)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [cursorInsideWindow, setCursorInsideWindow] = useState(false)
  const prevMiniSettingsOpenRef = useRef(false)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const miniSettingsOpen = useUiStore((s) => s.settingsOpen)
  const setMiniSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const frameScheduler = useMemo(() => new FrameScheduler({ frameTarget }), [])
  const dataSource = useMemo(() => new ScopePopoutDataSource(scopeKind), [scopeKind])
  const useWindowManagerDragRegions = getRendererWindowCapabilities().useNativeDragRegions

  const initializeWindowBackground = useWindowBackgroundStore((s) => s.initialize)
  const windowBackgroundMode = useWindowBackgroundStore((s) => s.effective.mode)

  useEffect(() => {
    void window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  useEffect(() => {
    void initializeWindowBackground()
  }, [initializeWindowBackground])

  useEffect(() => {
    frameScheduler.setFrameTarget(frameTarget)
  }, [frameScheduler, frameTarget])

  useEffect(() => {
    let isDisposed = false

    const syncCursorInsideWindow = (): void => {
      void window.electronAPI.isCursorInsideWindow()
        .then((isInside) => {
          if (!isDisposed) {
            setCursorInsideWindow(isInside)
          }
        })
        .catch(() => {
          // Renderer pointer events still update the chrome when cursor polling is unavailable.
        })
    }

    syncCursorInsideWindow()
    const interval = setInterval(syncCursorInsideWindow, 120)

    return () => {
      isDisposed = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const unsubscribeSnapshot = window.electronAPI.onScopePopoutSnapshot((nextSnapshot) => {
      if (nextSnapshot.kind !== scopeKind) return
      setSnapshot(nextSnapshot)
      applyResolvedThemeToDocument({ interface: nextSnapshot.interfaceTheme }, document.documentElement.style)
    })
    const unsubscribeAudio = window.electronAPI.onScopePopoutAudio((kind, batch) => {
      if (kind !== scopeKind) return
      dataSource.pushAudioBatch(batch)
    })
    const unsubscribeSession = window.electronAPI.onScopePopoutSession((kind, sessionState) => {
      if (kind !== scopeKind) return
      dataSource.setSessionState(sessionState)
    })

    window.electronAPI.notifyScopePopoutReady(scopeKind)

    return () => {
      unsubscribeSnapshot()
      unsubscribeAudio()
      unsubscribeSession()
    }
  }, [dataSource, scopeKind])

  const effectiveSettings = (snapshot?.settings ?? DEFAULT_SCOPE_SETTINGS[scopeKind]) as ScopeSettings[ScopeKind]
  const effectiveScopeTheme = snapshot?.scopeTheme ?? defaultTheme[scopeKind]
  const settingsHeight = miniSettingsOpen ? POPOUT_SETTINGS_EXPAND_HEIGHT : 0

  const handleUpdateScopeSettings = <K extends ScopeKind>(kind: K, partial: Partial<ScopeSettings[K]>): void => {
    if (kind !== scopeKind) return

    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        settings: {
          ...prev.settings,
          ...partial,
        } as ScopeSettings[K],
      }
    })
    window.electronAPI.sendScopePopoutSettingsUpdate(kind, partial)
  }

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (useWindowManagerDragRegions || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [useWindowManagerDragRegions])

  const handleDragEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (useWindowManagerDragRegions) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [useWindowManagerDragRegions])

  const handleAltDragStart = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (useWindowManagerDragRegions || !event.altKey || event.button !== 0) return

    const target = event.target
    if (target instanceof Element && target.closest('.scope-popout__drag-handle')) {
      return
    }

    event.preventDefault()
    window.electronAPI.startWindowMove()
  }, [useWindowManagerDragRegions])

  const handleAltDragEnd = useCallback((): void => {
    if (useWindowManagerDragRegions) {
      return
    }

    window.electronAPI.stopWindowMove()
  }, [useWindowManagerDragRegions])

  useLayoutEffect(() => {
    if (miniSettingsOpen && !prevMiniSettingsOpenRef.current) {
      window.electronAPI.expandSettings(POPOUT_SETTINGS_EXPAND_HEIGHT)
    } else if (!miniSettingsOpen && prevMiniSettingsOpenRef.current) {
      window.electronAPI.collapseSettings(POPOUT_SETTINGS_EXPAND_HEIGHT)
    }

    prevMiniSettingsOpenRef.current = miniSettingsOpen
  }, [miniSettingsOpen])

  useEffect(() => {
    return () => {
      if (prevMiniSettingsOpenRef.current) {
        window.electronAPI.setSettingsHeight(0)
      }
      window.electronAPI.stopWindowMove()
    }
  }, [])

  return (
    <div
      className="scope-popout"
      onMouseEnter={() => setCursorInsideWindow(true)}
      onMouseMove={() => setCursorInsideWindow(true)}
      onMouseLeave={() => setCursorInsideWindow(false)}
      onMouseDown={useWindowManagerDragRegions ? undefined : handleAltDragStart}
      onMouseUp={useWindowManagerDragRegions ? undefined : handleAltDragEnd}
    >
      <div
        className="scope-popout__viewport"
        style={{ height: `calc(100vh - ${settingsHeight}px)` }}
      >
        <div
          className={[
            'scope-popout__chrome',
            miniSettingsOpen ? 'is-expanded' : '',
            cursorInsideWindow ? 'is-cursor-inside' : '',
          ].join(' ').trim()}
        >
          <header className={`scope-popout__header ${useWindowManagerDragRegions ? 'is-native-drag' : ''}`.trim()}>
            <div className="scope-popout__drag">
              <button
                type="button"
                className={`scope-popout__drag-handle ${useWindowManagerDragRegions ? 'is-native-drag' : ''}`.trim()}
                onPointerDown={useWindowManagerDragRegions ? undefined : handleDragStart}
                onPointerUp={useWindowManagerDragRegions ? undefined : handleDragEnd}
                onPointerCancel={useWindowManagerDragRegions ? undefined : handleDragEnd}
                onLostPointerCapture={useWindowManagerDragRegions ? undefined : handleDragEnd}
                aria-label="Drag window"
                title="Drag window"
              >
                <span className="scope-popout__drag-icon" aria-hidden="true">
                  <GripIcon />
                </span>
              </button>
              <div className="scope-popout__title-group">
                <span className="scope-popout__title">{snapshot?.label ?? SCOPE_LABELS[scopeKind]}</span>
                <span className="scope-popout__subtitle">Detached Scope</span>
              </div>
            </div>

            <div className="scope-popout__actions">
              <button
                type="button"
                className={`scope-popout__button ${isAlwaysOnTop ? 'is-active' : ''}`.trim()}
                onClick={() => window.electronAPI.toggleAlwaysOnTop()}
                aria-label={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
                title={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
              >
                <PinIcon />
              </button>
              <button
                type="button"
                className={`scope-popout__button ${miniSettingsOpen ? 'is-active' : ''}`.trim()}
                onClick={() => setMiniSettingsOpen(!miniSettingsOpen)}
                aria-label="Toggle mini settings"
                title="Mini settings"
              >
                <SettingsIcon />
              </button>
              <button
                type="button"
                className="scope-popout__button"
                onClick={() => window.electronAPI.requestScopePopIn(scopeKind)}
                aria-label={`Pop in ${SCOPE_LABELS[scopeKind]}`}
                title={`Pop in ${SCOPE_LABELS[scopeKind]}`}
              >
                <PopInIcon />
              </button>
            </div>
          </header>
        </div>

        <div className="scope-popout__content">
          <div className="scope-popout__canvas-region">
            <ScopeModule
              scopeKind={scopeKind}
              theme={effectiveScopeTheme}
              settings={effectiveSettings}
              frameScheduler={frameScheduler}
              dataSource={dataSource}
            />
          </div>
        </div>
      </div>

      {miniSettingsOpen && (
        <div
          className="scope-popout__settings-region"
          style={{ height: `${settingsHeight}px` }}
        >
          <div className="scope-popout__settings-panel">
            <ScopeSettingsSection
              kind={scopeKind}
              settings={effectiveSettings}
              onUpdate={handleUpdateScopeSettings}
            />
          </div>
        </div>
      )}

      {windowBackgroundMode !== 'solid' && <WindowResizeOverlay />}
    </div>
  )
}

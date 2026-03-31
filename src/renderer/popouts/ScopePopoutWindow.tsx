import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ScopePopoutSnapshot } from '../../types/popout'
import { SCOPE_LABELS, type ScopeKind } from '../../types/scope'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../../types/settings'
import { applyResolvedThemeToDocument, createDefaultTheme, resolveTheme } from '../../shared/themeState'
import ScopeModule from '../components/ScopeModule'
import ScopeSettingsSection from '../components/ScopeSettingsSection'
import WindowResizeOverlay from '../components/WindowResizeOverlay'
import { usePerformanceStore } from '../stores/performanceStore'
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
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <g fill="currentColor">
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(60 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(120 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(180 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(240 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(300 8 8)" />
      </g>
      <circle cx="8" cy="8" r="3.45" fill="none" stroke="currentColor" strokeWidth="1.85" />
      <circle cx="8" cy="8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.05" />
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
  const [miniSettingsOpen, setMiniSettingsOpen] = useState(false)
  const prevMiniSettingsOpenRef = useRef(false)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const frameScheduler = useMemo(() => new FrameScheduler({ frameTarget }), [])
  const dataSource = useMemo(() => new ScopePopoutDataSource(scopeKind), [scopeKind])

  useEffect(() => {
    void window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  useEffect(() => {
    frameScheduler.setFrameTarget(frameTarget)
  }, [frameScheduler, frameTarget])

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
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [])

  const handleDragEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [])

  const handleAltDragStart = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!event.altKey || event.button !== 0) return

    const target = event.target
    if (target instanceof Element && target.closest('.scope-popout__drag-handle')) {
      return
    }

    event.preventDefault()
    window.electronAPI.startWindowMove()
  }, [])

  const handleAltDragEnd = useCallback((): void => {
    window.electronAPI.stopWindowMove()
  }, [])

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
      onMouseDown={handleAltDragStart}
      onMouseUp={handleAltDragEnd}
    >
      <div
        className="scope-popout__viewport"
        style={{ height: `calc(100vh - ${settingsHeight}px)` }}
      >
        <div
          className={[
            'scope-popout__chrome',
            miniSettingsOpen ? 'is-expanded' : '',
          ].join(' ').trim()}
        >
          <header className="scope-popout__header">
            <div className="scope-popout__drag">
              <button
                type="button"
                className="scope-popout__drag-handle"
                onPointerDown={handleDragStart}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                onLostPointerCapture={handleDragEnd}
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
                onClick={() => setMiniSettingsOpen((prev) => !prev)}
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

      <WindowResizeOverlay />
    </div>
  )
}

import { useState, useEffect, useCallback, type CSSProperties, type JSX } from 'react'
import type { ScopeKind } from '../../types/scope'
import { SCOPE_KINDS } from '../../types/scope'
import { useSettingsStore } from '../stores/settingsStore'

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'SPEC',
  oscilloscope: 'OSC',
  vectorscope: 'VEC',
  spectrogram: 'GRAM',
  vumeter: 'VU',
  lufsmeter: 'LUFS',
  waveform: 'WAVE',
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.7v2M8 12.3v2M14.3 8h-2M3.7 8h-2M12.4 3.6l-1.4 1.4M5 11l-1.4 1.4M12.4 12.4 11 11M5 5 3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

interface ToolbarProps {
  onOpenSettings: () => void
  settingsOpen: boolean
}

export default function Toolbar({ onOpenSettings, settingsOpen }: ToolbarProps): JSX.Element {
  const hiddenScopes = useSettingsStore((state) => state.hiddenScopes)
  const toggleScope = useSettingsStore((state) => state.toggleScope)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true)

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  const handlePin = useCallback(() => {
    window.electronAPI.toggleAlwaysOnTop()
  }, [])

  return (
    <div className="toolbar">
      <div
        className="toolbar__brand"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <span className="toolbar__brand-mark" />
        <span className="toolbar__brand-text">Prism</span>
      </div>

      <div className="toolbar__chips">
        {SCOPE_KINDS.map((kind) => {
          const active = !hiddenScopes.has(kind)
          return (
            <button
              key={kind}
              type="button"
              className={`toolbar__chip ${active ? 'is-active' : ''}`.trim()}
              onClick={() => toggleScope(kind)}
            >
              {SCOPE_LABELS[kind]}
            </button>
          )
        })}
      </div>

      <div className="toolbar__actions">
        <button
          type="button"
          className={`toolbar__icon-button ${settingsOpen ? 'is-active' : ''}`.trim()}
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>

        <button
          type="button"
          className={`toolbar__icon-button ${isAlwaysOnTop ? 'is-active' : ''}`.trim()}
          onClick={handlePin}
          title={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
          aria-label={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
        >
          <PinIcon />
        </button>

        <button
          type="button"
          className="toolbar__icon-button toolbar__icon-button--danger"
          onClick={() => window.electronAPI.close()}
          title="Close"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

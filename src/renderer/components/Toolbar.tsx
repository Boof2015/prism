import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ScopeKind } from '../../types/scope'
import { SCOPE_KINDS } from '../../types/scope'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'

const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'SPEC',
  oscilloscope: 'OSC',
  vectorscope: 'VEC',
  spectrogram: 'GRAM',
  vumeter: 'VU',
  lufsmeter: 'LUFS',
  waveform: 'WAVE',
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface ToolbarProps {
  onOpenSettings: () => void
  settingsOpen: boolean
}

export default function Toolbar({ onOpenSettings, settingsOpen }: ToolbarProps): JSX.Element {
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const accent = useThemeStore((s) => s.accent)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true)

  const accentBg = useMemo(() => hexToRgba(accent, 0.15), [accent])
  const accentBorder = useMemo(() => hexToRgba(accent, 0.3), [accent])

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsub = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsub
  }, [])

  const handlePin = useCallback(() => {
    window.electronAPI.toggleAlwaysOnTop()
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: '36px',
        padding: '0 8px',
        gap: '2px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Drag region */}
      <div
        style={{
          WebkitAppRegion: 'drag',
          flex: '0 0 40px',
          height: '100%',
          cursor: 'grab',
        } as React.CSSProperties}
      />

      {/* Scope toggles */}
      <div style={{ display: 'flex', gap: '2px', flex: 1 }}>
        {SCOPE_KINDS.map((kind) => {
          const active = !hiddenScopes.has(kind)
          return (
            <button
              key={kind}
              onClick={() => toggleScope(kind)}
              style={{
                background: active ? accentBg : 'transparent',
                border: `1px solid ${active ? accentBorder : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: '3px',
                color: active ? accent : 'rgba(255, 255, 255, 0.35)',
                fontSize: '9px',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 400,
                letterSpacing: '0.05em',
                padding: '3px 6px',
                cursor: 'pointer',
                transition: 'all 120ms',
                lineHeight: 1,
              }}
            >
              {SCOPE_LABELS[kind]}
            </button>
          )
        })}
      </div>

      {/* Right side: settings, pin, close */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <button
          onClick={onOpenSettings}
          style={{
            background: settingsOpen ? accentBg : 'transparent',
            border: 'none',
            color: settingsOpen ? accent : 'rgba(255, 255, 255, 0.5)',
            fontSize: '14px',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '3px',
            lineHeight: 1,
            transition: 'color 120ms',
          }}
          title="Settings"
        >
          ⚙
        </button>

        <button
          onClick={handlePin}
          style={{
            background: isAlwaysOnTop ? accentBg : 'transparent',
            border: 'none',
            color: isAlwaysOnTop ? accent : 'rgba(255, 255, 255, 0.5)',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '3px',
            lineHeight: 1,
            transition: 'color 120ms',
          }}
          title={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
        >
          📌
        </button>

        <button
          onClick={() => window.electronAPI.close()}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '3px',
            lineHeight: 1,
            transition: 'color 120ms',
          }}
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

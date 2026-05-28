import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { ScopeKind } from '../types/scope'
import type { ScopeSettings } from '../types/settings'
import type { PrismResolvedTheme } from '../types/theme'
import ScopeSettingsSection from '../renderer/components/ScopeSettingsSection'
import GearIcon from './GearIcon'
import { useScopeHostSync } from './useScopeHostSync'
import { emitToHost } from './juceBridge'

// Height (CSS px) of the bottom settings panel. The C++ editor grows its window by
// exactly this when settings open (and shrinks back on close) so the scope area is
// unchanged — like the desktop app. Must match `.spectrum-app__panel` in styles.css.
const PANEL_HEIGHT = 280

interface ScopeAppProps<K extends ScopeKind> {
  kind: K
  /** Render the scope's canvas given the current settings + resolved theme. */
  renderScope: (settings: ScopeSettings[K], theme: PrismResolvedTheme) => ReactNode
}

/**
 * Generic plugin shell for any scope: the scope fills the viewport, and the gear
 * toggles a settings panel that opens along the bottom (like the desktop app). The
 * window grows by the panel height to accommodate it, so the scope area never resizes.
 */
export default function ScopeApp<K extends ScopeKind>({ kind, renderScope }: ScopeAppProps<K>): JSX.Element {
  const { settings, resolvedTheme, handleUpdate } = useScopeHostSync(kind)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    emitToHost('prismSettingsPanel', { height: settingsOpen ? PANEL_HEIGHT : 0 })
  }, [settingsOpen])

  return (
    <div className="spectrum-app">
      <div className="spectrum-app__viewport">
        {renderScope(settings, resolvedTheme)}

        <button
          type="button"
          className={`spectrum-app__gear ${settingsOpen ? 'is-active' : ''}`.trim()}
          onClick={() => setSettingsOpen((open) => !open)}
          aria-label="Settings"
          title="Settings"
        >
          <GearIcon />
        </button>
      </div>

      {settingsOpen && (
        <div className="spectrum-app__panel">
          <ScopeSettingsSection
            kind={kind}
            settings={settings}
            onUpdate={(_k, partial) => handleUpdate(partial as unknown as Partial<ScopeSettings[K]>)}
          />
        </div>
      )}
    </div>
  )
}

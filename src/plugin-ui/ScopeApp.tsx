import { useState, type JSX, type ReactNode } from 'react'
import type { ScopeKind } from '../types/scope'
import type { ScopeSettings } from '../types/settings'
import type { PrismResolvedTheme } from '../types/theme'
import ScopeSettingsSection from '../renderer/components/ScopeSettingsSection'
import GearIcon from './GearIcon'
import { useScopeHostSync } from './useScopeHostSync'

interface ScopeAppProps<K extends ScopeKind> {
  kind: K
  /** Render the scope's canvas given the current settings + resolved theme. */
  renderScope: (settings: ScopeSettings[K], theme: PrismResolvedTheme) => ReactNode
}

/**
 * Generic plugin shell for any scope: hosts the canvas + a gear-toggled settings
 * drawer (the reused ScopeSettingsSection), wired to host sync via useScopeHostSync.
 */
export default function ScopeApp<K extends ScopeKind>({ kind, renderScope }: ScopeAppProps<K>): JSX.Element {
  const { settings, resolvedTheme, handleUpdate } = useScopeHostSync(kind)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="spectrum-app">
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

      {settingsOpen && (
        <div className="spectrum-app__settings">
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

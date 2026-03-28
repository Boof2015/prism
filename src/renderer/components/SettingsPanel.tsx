import { useMemo, type CSSProperties, type JSX } from 'react'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'
import ScopeSettingsSection from './ScopeSettingsSection'
import { useSettingsStore } from '../stores/settingsStore'

export default function SettingsPanel(): JSX.Element {
  const { scopeSettings, updateScopeSettings, hiddenScopes, scopeOrder, widthWeights, scopePopouts } = useSettingsStore()

  const dockedScopes = useMemo(
    () => scopeOrder.filter((kind) => !hiddenScopes.has(kind) && !scopePopouts[kind]?.poppedOut),
    [hiddenScopes, scopeOrder, scopePopouts],
  )
  const scopeTrackStyle = useMemo(() => {
    const gridTemplateColumns = buildAnalyzerGridTemplateColumns(dockedScopes, widthWeights)
    if (!gridTemplateColumns) return undefined
    return { gridTemplateColumns } as CSSProperties
  }, [dockedScopes, widthWeights])

  return (
    <div className="settings-panel">
      <div className="settings-panel__scope-track" style={scopeTrackStyle}>
        {dockedScopes.map((kind) => (
          <ScopeSettingsSection
            key={kind}
            kind={kind}
            settings={scopeSettings[kind]}
            onUpdate={updateScopeSettings}
          />
        ))}
      </div>
    </div>
  )
}

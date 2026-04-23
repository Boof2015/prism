import { useLayoutEffect, useMemo, useRef, type CSSProperties, type JSX } from 'react'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'
import { resolveMainWindowSettingsPanelHeight } from '../mainWindowSettings'
import ScopeSettingsSection from './ScopeSettingsSection'
import { useSettingsStore } from '../stores/settingsStore'

interface SettingsPanelProps {
  onHeightChange?: (height: number) => void
}

export default function SettingsPanel({ onHeightChange }: SettingsPanelProps): JSX.Element {
  const { scopeSettings, updateScopeSettings, hiddenScopes, scopeOrder, widthWeights, scopePopouts } = useSettingsStore()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scopeTrackRef = useRef<HTMLDivElement | null>(null)

  const dockedScopes = useMemo(
    () => scopeOrder.filter((kind) => !hiddenScopes.has(kind) && !scopePopouts[kind]?.poppedOut),
    [hiddenScopes, scopeOrder, scopePopouts],
  )
  const scopeTrackStyle = useMemo(() => {
    const gridTemplateColumns = buildAnalyzerGridTemplateColumns(dockedScopes, widthWeights)
    if (!gridTemplateColumns) return undefined
    return { gridTemplateColumns } as CSSProperties
  }, [dockedScopes, widthWeights])

  useLayoutEffect(() => {
    if (!onHeightChange || !panelRef.current) return

    const panelElement = panelRef.current
    let frameId = 0

    const reportHeight = (): void => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        onHeightChange(resolveMainWindowSettingsPanelHeight(panelElement, scopeTrackRef.current))
      })
    }

    reportHeight()

    const resizeObserver = new ResizeObserver(() => {
      reportHeight()
    })

    resizeObserver.observe(panelElement)
    if (scopeTrackRef.current) {
      resizeObserver.observe(scopeTrackRef.current)
    }

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [dockedScopes, onHeightChange, scopeTrackStyle])

  return (
    <div className="settings-panel" ref={panelRef}>
      <div className="settings-panel__scope-track" style={scopeTrackStyle} ref={scopeTrackRef}>
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

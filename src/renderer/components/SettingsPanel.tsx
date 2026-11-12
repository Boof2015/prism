import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'
import { resolveMainWindowSettingsPanelHeight } from '../mainWindowSettings'
import ScopeSettingsSection from './ScopeSettingsSection'
import { useSettingsStore } from '../stores/settingsStore'
import { useModuleInstanceStore } from '../stores/moduleInstanceStore'
import { AUDIO_SCOPE_KINDS, SCOPE_LABELS, type AudioScopeKind, type ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import ThemedSelect from './ThemedSelect'

interface SettingsPanelProps {
  onHeightChange?: (height: number) => void
}

export default function SettingsPanel({ onHeightChange }: SettingsPanelProps): JSX.Element {
  const { scopeSettings, updateScopeSettings, hiddenScopes, scopeOrder, widthWeights, scopePopouts } = useSettingsStore()
  const { instances, addInstance, removeInstance, updateSettings, setChannelPair } = useModuleInstanceStore()
  const [newKind, setNewKind] = useState<AudioScopeKind>('spectrum')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scopeTrackRef = useRef<HTMLDivElement | null>(null)

  const dockedScopes = useMemo(
    () => scopeOrder.filter((kind) => !hiddenScopes.has(kind) && !scopePopouts[kind]?.poppedOut),
    [hiddenScopes, scopeOrder, scopePopouts],
  )
  const scopeTrackStyle = useMemo(() => {
    const primaryColumns = buildAnalyzerGridTemplateColumns(dockedScopes, widthWeights)
    const gridTemplateColumns = [primaryColumns, ...instances.map(() => 'minmax(240px, 1fr)')].filter(Boolean).join(' ')
    if (!gridTemplateColumns) return undefined
    return { gridTemplateColumns } as CSSProperties
  }, [dockedScopes, instances, widthWeights])

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
      <div className="settings-panel__utility-row">
        <span>Add module</span>
        <ThemedSelect value={newKind} onChange={(event) => setNewKind(event.target.value as AudioScopeKind)}>
          {AUDIO_SCOPE_KINDS.map((kind) => <option key={kind} value={kind}>{SCOPE_LABELS[kind]}</option>)}
        </ThemedSelect>
        <button type="button" className="settings-chip" onClick={() => addInstance(newKind, scopeSettings[newKind])}>Add</button>
      </div>
      <div className="settings-panel__scope-track" style={scopeTrackStyle} ref={scopeTrackRef}>
        {dockedScopes.map((kind) => (
          <ScopeSettingsSection
            key={kind}
            kind={kind}
            settings={scopeSettings[kind]}
            onUpdate={updateScopeSettings}
          />
        ))}
        {instances.map((instance, index) => (
          <ScopeSettingsSection
            key={instance.id}
            kind={instance.kind}
            instanceLabel={`${SCOPE_LABELS[instance.kind]} ${index + 2}`}
            settings={instance.settings}
            channelPairLeft={instance.channelPairLeft}
            onChannelPairChange={(left) => setChannelPair(instance.id, left)}
            onRemove={() => removeInstance(instance.id)}
            onUpdate={((_kind: ScopeKind, partial: Partial<ScopeSettings[ScopeKind]>) => {
              updateSettings(instance.id, partial as Partial<ScopeSettings[AudioScopeKind]>)
            }) as typeof updateScopeSettings}
          />
        ))}
      </div>
    </div>
  )
}

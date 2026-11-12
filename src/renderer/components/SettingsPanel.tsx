import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'
import { resolveMainWindowSettingsPanelHeight } from '../mainWindowSettings'
import ScopeSettingsSection from './ScopeSettingsSection'
import { useSettingsStore } from '../stores/settingsStore'
import { useModuleInstanceStore } from '../stores/moduleInstanceStore'
import { SCOPE_LABELS, type AudioScopeKind, type ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import ThemedSelect from './ThemedSelect'
import { useAudioStore } from '../stores/audioStore'
import { DEFAULT_PITCH_SETTINGS, MODULE_INSTANCE_KINDS, type BassVUMeterSettings, type ModuleInstanceKind, type PitchSettings } from '../../types/moduleInstance'

interface SettingsPanelProps {
  onHeightChange?: (height: number) => void
}

export default function SettingsPanel({ onHeightChange }: SettingsPanelProps): JSX.Element {
  const { scopeSettings, updateScopeSettings, hiddenScopes, scopeOrder, widthWeights, scopePopouts } = useSettingsStore()
  const { instances, addInstance, removeInstance, updateSettings, setChannelPair, setSettingsLinked, setKindLinked } = useModuleInstanceStore()
  const sourceChannelCount = useAudioStore((state) => state.sourceChannelCount)
  const [newKind, setNewKind] = useState<ModuleInstanceKind>('spectrum')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scopeTrackRef = useRef<HTMLDivElement | null>(null)
  const updateInstanceSettings = (id: string, kind: AudioScopeKind, linked: boolean, partial: Partial<ScopeSettings[AudioScopeKind]>): void => {
    updateSettings(id, partial)
    if (linked) updateScopeSettings(kind, partial as Partial<ScopeSettings[typeof kind]>)
  }

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
        <ThemedSelect value={newKind} onChange={(event) => setNewKind(event.target.value as ModuleInstanceKind)}>
          {MODULE_INSTANCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind === 'pitch' ? 'Pitch' : SCOPE_LABELS[kind as AudioScopeKind]}</option>)}
        </ThemedSelect>
        <button type="button" className="settings-chip" onClick={() => addInstance(newKind, newKind === 'pitch' ? DEFAULT_PITCH_SETTINGS : scopeSettings[newKind as AudioScopeKind])}>Add</button>
      </div>
      <div className="settings-panel__scope-track" style={scopeTrackStyle} ref={scopeTrackRef}>
        {dockedScopes.map((kind) => (
          <ScopeSettingsSection
            key={kind}
            kind={kind}
            settings={scopeSettings[kind]}
            onUpdate={updateScopeSettings}
            settingsLinked={kind !== 'nowPlaying' && instances.some((item) => item.kind === kind && item.linkSettings)}
            onSettingsLinkedChange={kind === 'nowPlaying' ? undefined : (linked) => setKindLinked(kind, linked)}
          />
        ))}
        {instances.map((instance, index) => instance.kind === 'pitch' ? (
          <section key={instance.id} className="settings-scope-section">
            <div className="settings-scope-section__header">
              <div className="settings-scope-section__title">Pitch {index + 1}</div>
              <button type="button" className={`settings-chip ${instance.linkSettings ? 'is-active' : ''}`} onClick={() => setSettingsLinked(instance.id, !instance.linkSettings)}>Link settings</button>
              <button type="button" className="settings-chip" onClick={() => removeInstance(instance.id)}>Remove</button>
            </div>
            {(() => { const current = instance.settings as PitchSettings; return <div className="settings-scope-section__controls">
              <label className="settings-control"><span className="settings-control__label">Detection</span><ThemedSelect value={current.mode} onChange={(event) => updateInstanceSettings(instance.id, 'pitch', instance.linkSettings === true, { mode: event.target.value as PitchSettings['mode'] })}><option value="auto">Auto (vocal + bass)</option><option value="semi-auto">Semi-auto (targeted)</option></ThemedSelect></label>
              {current.mode === 'semi-auto' && <><label className="settings-control"><span className="settings-control__label">Main target Hz</span><input type="number" min="40" max="2200" step="1" value={current.primaryTargetHz} onChange={(event) => updateInstanceSettings(instance.id, 'pitch', instance.linkSettings === true, { primaryTargetHz: Number(event.target.value) })} /></label><label className="settings-control"><span className="settings-control__label">Secondary target Hz</span><input type="number" min="40" max="2200" step="1" value={current.secondaryTargetHz} onChange={(event) => updateInstanceSettings(instance.id, 'pitch', instance.linkSettings === true, { secondaryTargetHz: Number(event.target.value) })} /></label></>}
              {sourceChannelCount > 2 && <label className="settings-control"><span className="settings-control__label">Source channels</span><ThemedSelect value={instance.channelPairLeft === undefined ? 'default' : String(instance.channelPairLeft)} onChange={(event) => setChannelPair(instance.id, event.target.value === 'default' ? null : Number(event.target.value))}><option value="default">Global L/R route</option>{Array.from({ length: Math.min(4, Math.floor(sourceChannelCount / 2)) }, (_, pair) => <option key={pair} value={pair * 2}>Channels {pair * 2 + 1}–{pair * 2 + 2}</option>)}</ThemedSelect></label>}
            </div> })()}
          </section>
        ) : instance.kind === 'bassvumeter' ? (() => {
          const current = instance.settings as BassVUMeterSettings
          return <ScopeSettingsSection
            key={instance.id}
            kind="vumeter"
            instanceLabel={`Bass VU Meter ${index + 1}`}
            settings={current}
            channelPairLeft={instance.channelPairLeft}
            onChannelPairChange={(left) => setChannelPair(instance.id, left)}
            onRemove={() => removeInstance(instance.id)}
            settingsLinked={instance.linkSettings === true}
            onSettingsLinkedChange={(linked) => setSettingsLinked(instance.id, linked)}
            extraControls={undefined}
            onUpdate={((_kind: ScopeKind, partial: Partial<ScopeSettings[ScopeKind]>) => updateSettings(instance.id, partial as Partial<BassVUMeterSettings>)) as typeof updateScopeSettings}
          />
        })() : (
          <ScopeSettingsSection
            key={instance.id}
            kind={instance.kind}
            instanceLabel={`${SCOPE_LABELS[instance.kind]} ${index + 2}`}
            settings={instance.settings as ScopeSettings[AudioScopeKind]}
            channelPairLeft={instance.channelPairLeft}
            onChannelPairChange={(left) => setChannelPair(instance.id, left)}
            onRemove={() => removeInstance(instance.id)}
            settingsLinked={instance.linkSettings === true}
            onSettingsLinkedChange={(linked) => setSettingsLinked(instance.id, linked)}
            onUpdate={((_kind: ScopeKind, partial: Partial<ScopeSettings[ScopeKind]>) => {
              updateInstanceSettings(instance.id, instance.kind as AudioScopeKind, instance.linkSettings === true, partial as Partial<ScopeSettings[AudioScopeKind]>)
            }) as typeof updateScopeSettings}
          />
        ))}
      </div>
    </div>
  )
}

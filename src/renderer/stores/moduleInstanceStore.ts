import { create } from 'zustand'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../../types/settings'
import type { AudioScopeKind } from '../../types/scope'
import { DEFAULT_BASS_VU_SETTINGS, DEFAULT_PITCH_SETTINGS, MODULE_INSTANCE_KINDS, type BassVUMeterSettings, type ModuleInstance, type ModuleInstanceKind, type PitchSettings } from '../../types/moduleInstance'

const STORAGE_KEY = 'prism:module-instances:v1'

export type { ModuleInstance } from '../../types/moduleInstance'

function cloneSettings<K extends AudioScopeKind>(kind: K, source?: ScopeSettings[K]): ScopeSettings[K] {
  return structuredClone(source ?? DEFAULT_SCOPE_SETTINGS[kind])
}

function cloneInstanceSettings(kind: ModuleInstanceKind, source?: ModuleInstance['settings']): ModuleInstance['settings'] {
  if (kind === 'pitch') return structuredClone((source as PitchSettings | undefined) ?? DEFAULT_PITCH_SETTINGS)
  if (kind === 'bassvumeter') return structuredClone((source as BassVUMeterSettings | undefined) ?? DEFAULT_BASS_VU_SETTINGS)
  return cloneSettings(kind, source as ScopeSettings[typeof kind] | undefined)
}

function loadInstances(): ModuleInstance[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value): ModuleInstance[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Partial<ModuleInstance>
      if (typeof item.id !== 'string' || !MODULE_INSTANCE_KINDS.includes(item.kind as ModuleInstanceKind)) return []
      const kind = item.kind as ModuleInstanceKind
      const left = item.channelPairLeft
      return [{
        id: item.id,
        kind,
        settings: { ...cloneInstanceSettings(kind), ...(item.settings ?? {}) } as ModuleInstance['settings'],
        linkSettings: item.linkSettings === true,
        ...(typeof left === 'number' && left >= 0 && left < 8 && left % 2 === 0 ? { channelPairLeft: left } : {}),
      }]
    })
  } catch {
    return []
  }
}

function persist(instances: ModuleInstance[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(instances)) } catch { /* Storage may be disabled. */ }
}

interface ModuleInstanceState {
  instances: ModuleInstance[]
  addInstance: (kind: ModuleInstanceKind, settings?: ModuleInstance['settings']) => void
  removeInstance: (id: string) => void
  updateSettings: (id: string, partial: Partial<ModuleInstance['settings']>) => void
  setSettingsLinked: (id: string, linked: boolean) => void
  setKindLinked: (kind: ModuleInstanceKind, linked: boolean) => void
  updateLinkedFromPrimary: (kind: ModuleInstanceKind, partial: Partial<ModuleInstance['settings']>) => void
  setChannelPair: (id: string, left: number | null) => void
  replaceInstances: (instances: ModuleInstance[]) => void
}

export const useModuleInstanceStore = create<ModuleInstanceState>((set) => ({
  instances: loadInstances(),
  addInstance: (kind, settings) => set((state) => {
    const instances = [...state.instances, {
      id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      settings: cloneInstanceSettings(kind, settings),
      linkSettings: false,
    }]
    persist(instances)
    return { instances }
  }),
  removeInstance: (id) => set((state) => {
    const instances = state.instances.filter((item) => item.id !== id)
    persist(instances)
    return { instances }
  }),
  updateSettings: (id, partial) => set((state) => {
    const target = state.instances.find((item) => item.id === id)
    if (!target) return state
    const instances = state.instances.map((item) => (item.id === id || (target.linkSettings && item.linkSettings && item.kind === target.kind))
      ? { ...item, settings: { ...item.settings, ...partial } as ModuleInstance['settings'] }
      : item)
    persist(instances)
    return { instances }
  }),
  setSettingsLinked: (id, linked) => set((state) => {
    const instances = state.instances.map((item) => item.id === id ? { ...item, linkSettings: linked } : item)
    persist(instances)
    return { instances }
  }),
  setKindLinked: (kind, linked) => set((state) => {
    const instances = state.instances.map((item) => item.kind === kind ? { ...item, linkSettings: linked } : item)
    persist(instances)
    return { instances }
  }),
  updateLinkedFromPrimary: (kind, partial) => set((state) => {
    const instances = state.instances.map((item) => item.kind === kind && item.linkSettings
      ? { ...item, settings: { ...item.settings, ...partial } as ModuleInstance['settings'] }
      : item)
    persist(instances)
    return { instances }
  }),
  setChannelPair: (id, left) => set((state) => {
    if (left !== null && (!Number.isInteger(left) || left < 0 || left >= 8 || left % 2 !== 0)) return state
    const instances = state.instances.map((item) => item.id === id
      ? { ...item, ...(left === null ? { channelPairLeft: undefined } : { channelPairLeft: left }) }
      : item)
    persist(instances)
    return { instances }
  }),
  replaceInstances: (raw) => set(() => {
    const instances = structuredClone(raw)
    persist(instances)
    return { instances }
  }),
}))

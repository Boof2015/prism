import { create } from 'zustand'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../../types/settings'
import { AUDIO_SCOPE_KINDS, type AudioScopeKind } from '../../types/scope'

const STORAGE_KEY = 'prism:module-instances:v1'

export interface ModuleInstance {
  id: string
  kind: AudioScopeKind
  settings: ScopeSettings[AudioScopeKind]
  channelPairLeft?: number
}

function cloneSettings<K extends AudioScopeKind>(kind: K, source?: ScopeSettings[K]): ScopeSettings[K] {
  return structuredClone(source ?? DEFAULT_SCOPE_SETTINGS[kind])
}

function loadInstances(): ModuleInstance[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value): ModuleInstance[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Partial<ModuleInstance>
      if (typeof item.id !== 'string' || !AUDIO_SCOPE_KINDS.includes(item.kind as AudioScopeKind)) return []
      const kind = item.kind as AudioScopeKind
      const left = item.channelPairLeft
      return [{
        id: item.id,
        kind,
        settings: { ...cloneSettings(kind), ...(item.settings ?? {}) } as ScopeSettings[AudioScopeKind],
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
  addInstance: <K extends AudioScopeKind>(kind: K, settings?: ScopeSettings[K]) => void
  removeInstance: (id: string) => void
  updateSettings: (id: string, partial: Partial<ScopeSettings[AudioScopeKind]>) => void
  setChannelPair: (id: string, left: number | null) => void
}

export const useModuleInstanceStore = create<ModuleInstanceState>((set) => ({
  instances: loadInstances(),
  addInstance: (kind, settings) => set((state) => {
    const instances = [...state.instances, {
      id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      settings: cloneSettings(kind, settings),
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
    const instances = state.instances.map((item) => item.id === id
      ? { ...item, settings: { ...item.settings, ...partial } as ScopeSettings[AudioScopeKind] }
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
}))

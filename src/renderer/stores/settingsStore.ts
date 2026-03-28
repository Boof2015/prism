import { create } from 'zustand'
import { SCOPE_KINDS, type ScopeKind } from '../../types/scope'
import type { ScopePopoutStateMap, WindowBounds } from '../../types/popout'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../../types/settings'

export type { ScopeSettings } from '../../types/settings'

const DEFAULT_VISIBLE: ScopeKind[] = ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter']

const STORAGE_KEY = 'prism:settings'
const PROFILES_STORAGE_KEY = 'prism:profiles'
const ACTIVE_PROFILE_KEY = 'prism:activeProfile'
const DEFAULT_PROFILE_ID = 'profile_default'

export interface Profile {
  name: string
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
}

function loadProfiles(): Record<string, Profile> {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveProfiles(profiles: Record<string, Profile>): void {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
  } catch { /* ignore */ }
}

function loadActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY)
  } catch { return null }
}

function saveActiveProfileId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_PROFILE_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_PROFILE_KEY)
    }
  } catch { /* ignore */ }
}

interface SettingsState {
  scopeOrder: ScopeKind[]
  hiddenScopes: Set<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap

  // Derived
  visibleScopes: () => ScopeKind[]

  // Profiles
  profiles: Record<string, Profile>
  activeProfileId: string | null

  // Actions
  toggleScope: (kind: ScopeKind) => void
  moveScope: (kind: ScopeKind, direction: 'left' | 'right') => void
  setScopeWidthWeight: (kind: ScopeKind, weight: number) => void
  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => void
  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => void
  popInScope: (kind: ScopeKind) => void
  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => void
  saveProfile: (name: string) => string
  saveProfileAs: (name: string) => string
  updateActiveProfile: () => void
  loadProfile: (id: string) => void
  deleteProfile: (id: string) => void
  renameProfile: (id: string, name: string) => void
}

function loadFromStorage(): Partial<{
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
}> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveToStorage(state: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scopeOrder: state.scopeOrder,
      hiddenScopes: Array.from(state.hiddenScopes),
      widthWeights: state.widthWeights,
      scopeSettings: state.scopeSettings,
      scopePopouts: state.scopePopouts,
    }))
  } catch { /* ignore */ }
}

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && SCOPE_KINDS.includes(value as ScopeKind)
}

function normalizeScopeOrder(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) return [...SCOPE_KINDS]
  const valid = raw.filter(isScopeKind)
  const seen = new Set<ScopeKind>()
  const normalized: ScopeKind[] = []

  for (const kind of valid) {
    if (seen.has(kind)) continue
    seen.add(kind)
    normalized.push(kind)
  }

  for (const kind of SCOPE_KINDS) {
    if (!seen.has(kind)) {
      normalized.push(kind)
    }
  }

  return normalized
}

function normalizeHiddenScopes(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) {
    return SCOPE_KINDS.filter((kind) => !DEFAULT_VISIBLE.includes(kind))
  }
  return raw.filter(isScopeKind)
}

function mergeScopeSettings(raw: unknown): ScopeSettings {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<ScopeSettings>
    : {}

  return {
    spectrum: { ...DEFAULT_SCOPE_SETTINGS.spectrum, ...(parsed.spectrum ?? {}) },
    oscilloscope: { ...DEFAULT_SCOPE_SETTINGS.oscilloscope, ...(parsed.oscilloscope ?? {}) },
    vectorscope: { ...DEFAULT_SCOPE_SETTINGS.vectorscope, ...(parsed.vectorscope ?? {}) },
    spectrogram: { ...DEFAULT_SCOPE_SETTINGS.spectrogram, ...(parsed.spectrogram ?? {}) },
    vumeter: { ...DEFAULT_SCOPE_SETTINGS.vumeter, ...(parsed.vumeter ?? {}) },
    lufsmeter: { ...DEFAULT_SCOPE_SETTINGS.lufsmeter, ...(parsed.lufsmeter ?? {}) },
    waveform: { ...DEFAULT_SCOPE_SETTINGS.waveform, ...(parsed.waveform ?? {}) },
  }
}

function createDefaultScopePopouts(): ScopePopoutStateMap {
  return SCOPE_KINDS.reduce((acc, kind) => {
    acc[kind] = { poppedOut: false }
    return acc
  }, {} as ScopePopoutStateMap)
}

function normalizeWindowBounds(raw: unknown): WindowBounds | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Partial<WindowBounds>
  if (
    typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
    || typeof candidate.width !== 'number'
    || typeof candidate.height !== 'number'
  ) {
    return undefined
  }
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(120, Math.round(candidate.width)),
    height: Math.max(80, Math.round(candidate.height)),
  }
}

function normalizeScopePopouts(raw: unknown): ScopePopoutStateMap {
  const defaults = createDefaultScopePopouts()
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<ScopeKind, Partial<ScopePopoutStateMap[ScopeKind]>>>
    : {}

  for (const kind of SCOPE_KINDS) {
    const value = parsed[kind]
    defaults[kind] = {
      poppedOut: Boolean(value?.poppedOut),
      windowBounds: normalizeWindowBounds(value?.windowBounds),
    }
  }

  return defaults
}

function cloneScopeSettings(settings: ScopeSettings): ScopeSettings {
  return JSON.parse(JSON.stringify(settings)) as ScopeSettings
}

const stored = loadFromStorage()

const defaultWeights: Record<ScopeKind, number> = {
  spectrum: 1, oscilloscope: 1, vectorscope: 1, spectrogram: 1,
  vumeter: 0.5, lufsmeter: 0.5, waveform: 1,
}

// Ensure a default profile always exists
function ensureDefaultProfile(profiles: Record<string, Profile>): Record<string, Profile> {
  if (profiles[DEFAULT_PROFILE_ID]) return profiles
  const defaultProfile: Profile = {
    name: 'Default',
    scopeOrder: [...SCOPE_KINDS],
    hiddenScopes: SCOPE_KINDS.filter((kind) => !DEFAULT_VISIBLE.includes(kind)),
    widthWeights: { ...defaultWeights },
    scopeSettings: cloneScopeSettings(DEFAULT_SCOPE_SETTINGS),
    scopePopouts: createDefaultScopePopouts(),
  }
  const updated = { [DEFAULT_PROFILE_ID]: defaultProfile, ...profiles }
  saveProfiles(updated)
  return updated
}

const initialProfiles = ensureDefaultProfile(loadProfiles())
const initialActiveProfileId = loadActiveProfileId()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  scopeOrder: normalizeScopeOrder(stored.scopeOrder),
  hiddenScopes: new Set<ScopeKind>(
    normalizeHiddenScopes(stored.hiddenScopes)
  ),
  widthWeights: stored.widthWeights ?? { ...defaultWeights },
  scopeSettings: mergeScopeSettings(stored.scopeSettings),
  scopePopouts: normalizeScopePopouts(stored.scopePopouts),
  profiles: initialProfiles,
  activeProfileId: initialActiveProfileId,

  visibleScopes: () => {
    const { scopeOrder, hiddenScopes } = get()
    return scopeOrder.filter((k) => !hiddenScopes.has(k))
  },

  toggleScope: (kind: ScopeKind) => {
    set((state) => {
      const next = new Set(state.hiddenScopes)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        // Don't allow hiding all scopes
        const visibleCount = state.scopeOrder.filter((k) => !next.has(k)).length
        if (visibleCount <= 1) return state
        next.add(kind)
      }
      const newState = { ...state, hiddenScopes: next }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  moveScope: (kind: ScopeKind, direction: 'left' | 'right') => {
    set((state) => {
      const order = [...state.scopeOrder]
      const idx = order.indexOf(kind)
      if (idx === -1) return state
      const swap = direction === 'left' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= order.length) return state
      ;[order[idx], order[swap]] = [order[swap], order[idx]]
      const newState = { ...state, scopeOrder: order }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  setScopeWidthWeight: (kind: ScopeKind, weight: number) => {
    set((state) => {
      const newState = { ...state, widthWeights: { ...state.widthWeights, [kind]: Math.max(0.1, weight) } }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => {
    set((state) => {
      const newState = {
        ...state,
        scopeSettings: {
          ...state.scopeSettings,
          [kind]: { ...state.scopeSettings[kind], ...settings },
        },
      }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => {
    set((state) => {
      const nextPopout = {
        ...state.scopePopouts,
        [kind]: {
          poppedOut: true,
          windowBounds: bounds ?? state.scopePopouts[kind]?.windowBounds,
        },
      }
      const newState = { ...state, scopePopouts: nextPopout }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  popInScope: (kind: ScopeKind) => {
    set((state) => {
      const nextPopout = {
        ...state.scopePopouts,
        [kind]: {
          ...state.scopePopouts[kind],
          poppedOut: false,
        },
      }
      const newState = { ...state, scopePopouts: nextPopout }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => {
    set((state) => {
      const nextPopout = {
        ...state.scopePopouts,
        [kind]: {
          ...state.scopePopouts[kind],
          windowBounds: normalizeWindowBounds(bounds),
        },
      }
      const newState = { ...state, scopePopouts: nextPopout }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  saveProfile: (name: string) => {
    const state = get()
    const id = `profile_${Date.now()}`
    const profile: Profile = {
      name,
      scopeOrder: [...state.scopeOrder],
      hiddenScopes: Array.from(state.hiddenScopes),
      widthWeights: { ...state.widthWeights },
      scopeSettings: cloneScopeSettings(state.scopeSettings),
      scopePopouts: normalizeScopePopouts(state.scopePopouts),
    }
    // Capture window bounds asynchronously
    window.electronAPI.getWindowBounds().then((bounds) => {
      if (bounds) {
        const profiles = get().profiles
        const updated = { ...profiles, [id]: { ...profiles[id], windowBounds: bounds } }
        saveProfiles(updated)
        set({ profiles: updated })
      }
    })
    const profiles = { ...state.profiles, [id]: profile }
    saveProfiles(profiles)
    saveActiveProfileId(id)
    set({ profiles, activeProfileId: id })
    return id
  },

  saveProfileAs: (name: string) => {
    // Same as saveProfile but always creates a new entry
    return get().saveProfile(name)
  },

  updateActiveProfile: () => {
    const state = get()
    const id = state.activeProfileId
    if (!id || !state.profiles[id]) return
    const updated: Profile = {
      ...state.profiles[id],
      scopeOrder: [...state.scopeOrder],
      hiddenScopes: Array.from(state.hiddenScopes),
      widthWeights: { ...state.widthWeights },
      scopeSettings: cloneScopeSettings(state.scopeSettings),
      scopePopouts: normalizeScopePopouts(state.scopePopouts),
    }
    // Capture window bounds asynchronously
    window.electronAPI.getWindowBounds().then((bounds) => {
      if (bounds) {
        const profiles = get().profiles
        const withBounds = { ...profiles, [id]: { ...profiles[id], windowBounds: bounds } }
        saveProfiles(withBounds)
        set({ profiles: withBounds })
      }
    })
    const profiles = { ...state.profiles, [id]: updated }
    saveProfiles(profiles)
    set({ profiles })
  },

  loadProfile: (id: string) => {
    const state = get()
    const profile = state.profiles[id]
    if (!profile) return
    const newState = {
      ...state,
      scopeOrder: normalizeScopeOrder(profile.scopeOrder),
      hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(profile.hiddenScopes)),
      widthWeights: profile.widthWeights ?? { ...defaultWeights },
      scopeSettings: mergeScopeSettings(profile.scopeSettings),
      scopePopouts: normalizeScopePopouts(profile.scopePopouts),
      activeProfileId: id,
    }
    saveToStorage(newState as SettingsState)
    saveActiveProfileId(id)
    set(newState)

    if (profile.windowBounds) {
      window.electronAPI.setWindowBounds(profile.windowBounds)
    }
  },

  deleteProfile: (id: string) => {
    // Prevent deleting the default profile
    if (id === DEFAULT_PROFILE_ID) return
    const state = get()
    const profiles = { ...state.profiles }
    delete profiles[id]
    saveProfiles(profiles)
    const nextActiveId = state.activeProfileId === id ? null : state.activeProfileId
    saveActiveProfileId(nextActiveId)
    set({
      profiles,
      activeProfileId: nextActiveId,
    })
  },

  renameProfile: (id: string, name: string) => {
    if (id === DEFAULT_PROFILE_ID) return
    const state = get()
    const profile = state.profiles[id]
    if (!profile) return
    const profiles = { ...state.profiles, [id]: { ...profile, name } }
    saveProfiles(profiles)
    set({ profiles })
  },
}))

// On startup, restore last active profile's settings (but not window bounds — those are handled by Electron)
if (initialActiveProfileId && initialProfiles[initialActiveProfileId]) {
  const profile = initialProfiles[initialActiveProfileId]
  useSettingsStore.setState({
    scopeOrder: normalizeScopeOrder(profile.scopeOrder),
    hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(profile.hiddenScopes)),
    widthWeights: profile.widthWeights ?? { ...defaultWeights },
    scopeSettings: mergeScopeSettings(profile.scopeSettings),
    scopePopouts: normalizeScopePopouts(profile.scopePopouts),
  })
}

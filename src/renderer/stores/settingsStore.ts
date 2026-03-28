import { create } from 'zustand'
import type { ScopePopoutStateMap, WindowBounds } from '../../types/popout'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  type LegacyProfileMigrationPayload,
  type Profile,
  type ProfileLibrarySnapshot,
} from '../../types/profile'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import {
  cloneScopeSettings,
  createDefaultProfile,
  mergeScopeSettings,
  normalizeHiddenScopes,
  normalizeProfile,
  normalizeScopeOrder,
  normalizeScopePopouts,
  normalizeWidthWeights,
} from '../../shared/profileState'

export type { ScopeSettings } from '../../types/settings'

const STORAGE_KEY = 'prism:settings'
const PROFILES_STORAGE_KEY = 'prism:profiles'
const ACTIVE_PROFILE_KEY = 'prism:activeProfile'

interface PersistedSettingsState {
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
}

interface WorkingSettingsState {
  scopeOrder: ScopeKind[]
  hiddenScopes: Set<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
}

interface SettingsState extends WorkingSettingsState {
  visibleScopes: () => ScopeKind[]
  profiles: Record<string, Profile>
  activeProfileId: string | null
  initializeProfiles: () => Promise<void>
  applyExternalProfileSnapshot: (snapshot: ProfileLibrarySnapshot) => void
  toggleScope: (kind: ScopeKind) => void
  moveDockedScope: (kind: ScopeKind, direction: 'left' | 'right') => void
  setScopeWidthWeight: (kind: ScopeKind, weight: number) => void
  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => void
  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => void
  popInScope: (kind: ScopeKind) => void
  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => void
  saveProfile: (name: string) => Promise<string | null>
  saveProfileAs: (name: string) => Promise<string | null>
  updateActiveProfile: () => Promise<void>
  loadProfile: (id: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  renameProfile: (id: string, name: string) => Promise<void>
  importProfileFromDialog: () => Promise<void>
  showProfilesFolder: () => Promise<void>
}

function canUseElectronAPI(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function loadFromStorage(): Partial<PersistedSettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Partial<PersistedSettingsState>
  } catch { /* ignore */ }
  return {}
}

function saveToStorage(state: WorkingSettingsState): void {
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

function loadLegacyProfileMigrationPayload(): LegacyProfileMigrationPayload | null {
  try {
    const rawProfiles = localStorage.getItem(PROFILES_STORAGE_KEY)
    const rawActiveProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY)
    if (!rawProfiles && !rawActiveProfileId) {
      return null
    }

    const parsedProfiles = rawProfiles
      ? JSON.parse(rawProfiles) as Record<string, Profile>
      : {}

    return {
      profiles: parsedProfiles,
      activeProfileId: rawActiveProfileId,
    }
  } catch {
    return null
  }
}

function clearLegacyProfileStorage(): void {
  try {
    localStorage.removeItem(PROFILES_STORAGE_KEY)
    localStorage.removeItem(ACTIVE_PROFILE_KEY)
  } catch { /* ignore */ }
}

function createWorkingStateFromProfile(profile: Profile): WorkingSettingsState {
  const normalizedProfile = normalizeProfile(profile, profile.name)

  return {
    scopeOrder: normalizeScopeOrder(normalizedProfile.scopeOrder),
    hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(normalizedProfile.hiddenScopes)),
    widthWeights: normalizeWidthWeights(normalizedProfile.widthWeights),
    scopeSettings: mergeScopeSettings(normalizedProfile.scopeSettings),
    scopePopouts: normalizeScopePopouts(normalizedProfile.scopePopouts),
  }
}

function applyProfileSnapshot(
  set: (partial: Partial<SettingsState>) => void,
  snapshot: ProfileLibrarySnapshot,
  options: { loadActiveProfile: boolean },
): void {
  const activeProfile = snapshot.activeProfileId
    ? snapshot.profiles[snapshot.activeProfileId] ?? null
    : null

  if (!options.loadActiveProfile || !activeProfile) {
    set({
      profiles: snapshot.profiles,
      activeProfileId: snapshot.activeProfileId,
    })
    return
  }

  const nextState = createWorkingStateFromProfile(activeProfile)
  saveToStorage(nextState)
  set({
    ...nextState,
    profiles: snapshot.profiles,
    activeProfileId: snapshot.activeProfileId,
  })

  if (activeProfile.windowBounds && canUseElectronAPI()) {
    window.electronAPI.setWindowBounds(activeProfile.windowBounds)
  }
}

async function buildProfileFromState(state: SettingsState, name: string): Promise<Profile> {
  const profile = normalizeProfile({
    name,
    scopeOrder: [...state.scopeOrder],
    hiddenScopes: Array.from(state.hiddenScopes),
    widthWeights: { ...state.widthWeights },
    scopeSettings: cloneScopeSettings(state.scopeSettings),
    scopePopouts: normalizeScopePopouts(state.scopePopouts),
  }, name)

  if (!canUseElectronAPI()) {
    return profile
  }

  const bounds = await window.electronAPI.getWindowBounds()
  if (bounds) {
    profile.windowBounds = bounds
  }

  return profile
}

function isDockedScope(
  kind: ScopeKind,
  hiddenScopes: ReadonlySet<ScopeKind>,
  scopePopouts: ScopePopoutStateMap,
): boolean {
  return !hiddenScopes.has(kind) && !scopePopouts[kind]?.poppedOut
}

export function moveDockedScopeOrder(
  scopeOrder: ScopeKind[],
  hiddenScopes: ReadonlySet<ScopeKind>,
  scopePopouts: ScopePopoutStateMap,
  kind: ScopeKind,
  direction: 'left' | 'right',
): ScopeKind[] {
  const dockedScopes = scopeOrder.filter((scope) => isDockedScope(scope, hiddenScopes, scopePopouts))
  const index = dockedScopes.indexOf(kind)
  if (index === -1) return scopeOrder

  const targetIndex = direction === 'left' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= dockedScopes.length) return scopeOrder

  const reorderedDockedScopes = [...dockedScopes]
  ;[reorderedDockedScopes[index], reorderedDockedScopes[targetIndex]] = [
    reorderedDockedScopes[targetIndex],
    reorderedDockedScopes[index],
  ]

  let reorderedIndex = 0
  let didChange = false
  const mergedOrder = scopeOrder.map((scope) => {
    if (!isDockedScope(scope, hiddenScopes, scopePopouts)) return scope
    const nextScope = reorderedDockedScopes[reorderedIndex] ?? scope
    reorderedIndex += 1
    if (nextScope !== scope) {
      didChange = true
    }
    return nextScope
  })

  return didChange ? mergedOrder : scopeOrder
}

const stored = loadFromStorage()
const initialWorkingState: WorkingSettingsState = {
  scopeOrder: normalizeScopeOrder(stored.scopeOrder),
  hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(stored.hiddenScopes)),
  widthWeights: normalizeWidthWeights(stored.widthWeights),
  scopeSettings: mergeScopeSettings(stored.scopeSettings),
  scopePopouts: normalizeScopePopouts(stored.scopePopouts),
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialWorkingState,
  profiles: {
    [DEFAULT_PROFILE_ID]: createDefaultProfile(DEFAULT_PROFILE_NAME),
  },
  activeProfileId: null,

  visibleScopes: () => {
    const { scopeOrder, hiddenScopes } = get()
    return scopeOrder.filter((kind) => !hiddenScopes.has(kind))
  },

  initializeProfiles: async () => {
    if (!canUseElectronAPI()) return

    const legacyPayload = loadLegacyProfileMigrationPayload()
    let snapshot = await window.electronAPI.getProfileSnapshot()

    if (legacyPayload) {
      const migrationResult = await window.electronAPI.migrateLegacyProfiles(legacyPayload)
      if (migrationResult.didMigrate) {
        clearLegacyProfileStorage()
        snapshot = migrationResult.snapshot
      }
    }

    applyProfileSnapshot(set, snapshot, { loadActiveProfile: true })
  },

  applyExternalProfileSnapshot: (snapshot: ProfileLibrarySnapshot) => {
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: true })
  },

  toggleScope: (kind: ScopeKind) => {
    set((state) => {
      const next = new Set(state.hiddenScopes)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        const visibleCount = state.scopeOrder.filter((scope) => !next.has(scope)).length
        if (visibleCount <= 1) return state
        next.add(kind)
      }

      const nextState = { ...state, hiddenScopes: next }
      saveToStorage(nextState)
      return nextState
    })
  },

  moveDockedScope: (kind: ScopeKind, direction: 'left' | 'right') => {
    set((state) => {
      const nextOrder = moveDockedScopeOrder(
        state.scopeOrder,
        state.hiddenScopes,
        state.scopePopouts,
        kind,
        direction,
      )
      if (nextOrder === state.scopeOrder) return state

      const nextState = { ...state, scopeOrder: nextOrder }
      saveToStorage(nextState)
      return nextState
    })
  },

  setScopeWidthWeight: (kind: ScopeKind, weight: number) => {
    set((state) => {
      const nextState = {
        ...state,
        widthWeights: { ...state.widthWeights, [kind]: Math.max(0.1, weight) },
      }
      saveToStorage(nextState)
      return nextState
    })
  },

  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => {
    set((state) => {
      const nextState = {
        ...state,
        scopeSettings: {
          ...state.scopeSettings,
          [kind]: { ...state.scopeSettings[kind], ...settings },
        },
      }
      saveToStorage(nextState)
      return nextState
    })
  },

  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => {
    set((state) => {
      const nextState = {
        ...state,
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            poppedOut: true,
            windowBounds: bounds ?? state.scopePopouts[kind]?.windowBounds,
          },
        },
      }
      saveToStorage(nextState)
      return nextState
    })
  },

  popInScope: (kind: ScopeKind) => {
    set((state) => {
      const nextState = {
        ...state,
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            ...state.scopePopouts[kind],
            poppedOut: false,
          },
        },
      }
      saveToStorage(nextState)
      return nextState
    })
  },

  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => {
    set((state) => {
      const nextState = {
        ...state,
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            ...state.scopePopouts[kind],
            windowBounds: bounds,
          },
        },
      }
      saveToStorage(nextState)
      return nextState
    })
  },

  saveProfile: async (name: string) => {
    if (!canUseElectronAPI()) return null

    const snapshot = await window.electronAPI.saveNewProfile(name, await buildProfileFromState(get(), name))
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: false })
    return snapshot.activeProfileId
  },

  saveProfileAs: async (name: string) => {
    return get().saveProfile(name)
  },

  updateActiveProfile: async () => {
    if (!canUseElectronAPI()) return

    const state = get()
    const id = state.activeProfileId
    if (!id || !state.profiles[id]) return

    const snapshot = await window.electronAPI.overwriteProfile(
      id,
      await buildProfileFromState(state, state.profiles[id].name),
    )
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: false })
  },

  loadProfile: async (id: string) => {
    if (!canUseElectronAPI()) return

    const snapshot = await window.electronAPI.loadProfile(id)
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: true })
  },

  deleteProfile: async (id: string) => {
    if (id === DEFAULT_PROFILE_ID || !canUseElectronAPI()) return

    const snapshot = await window.electronAPI.deleteProfile(id)
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: false })
  },

  renameProfile: async (id: string, name: string) => {
    if (id === DEFAULT_PROFILE_ID || !canUseElectronAPI()) return

    const snapshot = await window.electronAPI.renameProfile(id, name)
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: false })
  },

  importProfileFromDialog: async () => {
    if (!canUseElectronAPI()) return

    const snapshot = await window.electronAPI.importProfileDialog()
    if (!snapshot) return
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: true })
  },

  showProfilesFolder: async () => {
    if (!canUseElectronAPI()) return
    await window.electronAPI.revealProfilesFolder()
  },
}))

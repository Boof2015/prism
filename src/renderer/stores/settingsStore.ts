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
  createDefaultProfile,
  mergeScopeSettings,
  normalizeHiddenScopes,
  normalizeProfile,
  normalizeScopeOrder,
  normalizeScopePopouts,
  normalizeWidthWeights,
} from '../../shared/profileState'
import { useThemeStore } from './themeStore'
import { buildProfileDraft, profilesMatch } from './profileDraft'

export type { ScopeSettings } from '../../types/settings'

const STORAGE_KEY = 'prism:settings'
const PROFILES_STORAGE_KEY = 'prism:profiles'
const ACTIVE_PROFILE_KEY = 'prism:activeProfile'
const PROFILE_GEOMETRY_SYNC_WINDOW_MS = 800

interface PersistedSettingsState {
  themeId: string | null
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
}

interface WorkingSettingsState {
  themeId: string | null
  scopeOrder: ScopeKind[]
  hiddenScopes: Set<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
}

interface SettingsState extends WorkingSettingsState {
  visibleScopes: () => ScopeKind[]
  profiles: Record<string, Profile>
  activeProfileId: string | null
  savedProfileBaseline: Profile | null
  hasUnsavedProfileChanges: boolean
  geometrySyncUntil: number
  initializeProfiles: () => Promise<void>
  applyExternalProfileSnapshot: (snapshot: ProfileLibrarySnapshot) => void
  setThemeId: (themeId: string | null) => void
  toggleScope: (kind: ScopeKind) => void
  moveDockedScope: (kind: ScopeKind, direction: 'left' | 'right') => void
  setScopeWidthWeight: (kind: ScopeKind, weight: number) => void
  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => void
  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => void
  popInScope: (kind: ScopeKind) => void
  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => void
  updateMainWindowBounds: (bounds: WindowBounds) => void
  discardUnsavedProfileChanges: () => Promise<void>
  guardProfileTransition: (transition: () => Promise<void>) => Promise<boolean>
  saveProfile: (name: string) => Promise<string | null>
  saveProfileAs: (name: string) => Promise<string | null>
  updateActiveProfile: () => Promise<void>
  loadProfile: (id: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  renameProfile: (id: string, name: string) => Promise<void>
  importProfileFromDialog: () => Promise<void>
  importProfileFromPath: (path: string) => Promise<void>
  showProfilesFolder: () => Promise<void>
}

function canUseElectronAPI(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function loadFromStorage(): Partial<PersistedSettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Partial<PersistedSettingsState>
  } catch {
    // Ignore localStorage read failures.
  }
  return {}
}

function saveToStorage(state: WorkingSettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      themeId: state.themeId,
      scopeOrder: state.scopeOrder,
      hiddenScopes: Array.from(state.hiddenScopes),
      widthWeights: state.widthWeights,
      scopeSettings: state.scopeSettings,
      scopePopouts: state.scopePopouts,
      windowBounds: state.windowBounds,
    }))
  } catch {
    // Ignore localStorage write failures.
  }
}

function persistWorkingState(state: WorkingSettingsState): void {
  if (!canUseElectronAPI()) {
    saveToStorage(state)
  }
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
  } catch {
    // Ignore localStorage write failures.
  }
}

function normalizeLoadedProfileForBaseline(profile: Profile, activeProfileId: string | null): Profile {
  const normalizedProfile = normalizeProfile(profile, profile.name)
  if (activeProfileId !== DEFAULT_PROFILE_ID || normalizedProfile.themeId) {
    return normalizedProfile
  }

  const activeThemeId = useThemeStore.getState().activeThemeId
  return normalizeProfile({
    ...normalizedProfile,
    themeId: activeThemeId,
  }, normalizedProfile.name)
}

function createWorkingStateFromProfile(profile: Profile): WorkingSettingsState {
  const normalizedProfile = normalizeProfile(profile, profile.name)

  return {
    themeId: normalizedProfile.themeId,
    scopeOrder: normalizeScopeOrder(normalizedProfile.scopeOrder),
    hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(normalizedProfile.hiddenScopes)),
    widthWeights: normalizeWidthWeights(normalizedProfile.widthWeights),
    scopeSettings: mergeScopeSettings(normalizedProfile.scopeSettings),
    scopePopouts: normalizeScopePopouts(normalizedProfile.scopePopouts),
    windowBounds: normalizedProfile.windowBounds,
  }
}

function getActiveProfileName(state: Pick<SettingsState, 'activeProfileId' | 'profiles'>): string | null {
  if (!state.activeProfileId) {
    return null
  }

  return state.profiles[state.activeProfileId]?.name ?? null
}

function buildActiveProfileDraft(state: SettingsState): Profile | null {
  const activeProfileName = getActiveProfileName(state)
  if (!activeProfileName) {
    return null
  }

  return buildProfileDraft(state, activeProfileName)
}

export function hasProfileDraftChanges(state: SettingsState, baseline = state.savedProfileBaseline): boolean {
  if (!baseline) {
    return false
  }

  const draft = buildActiveProfileDraft(state)
  if (!draft) {
    return false
  }

  return !profilesMatch(draft, baseline)
}

function withProfileDraftState(state: SettingsState, baseline = state.savedProfileBaseline): SettingsState {
  return {
    ...state,
    savedProfileBaseline: baseline,
    hasUnsavedProfileChanges: hasProfileDraftChanges(state, baseline),
  }
}

function commitWorkingState(
  state: SettingsState,
  patch: Partial<WorkingSettingsState>,
  baseline = state.savedProfileBaseline,
): SettingsState {
  const nextState = withProfileDraftState({
    ...state,
    ...patch,
  }, baseline)

  persistWorkingState(nextState)
  return nextState
}

function nextGeometrySyncDeadline(): number {
  return Date.now() + PROFILE_GEOMETRY_SYNC_WINDOW_MS
}

function isWithinGeometrySyncWindow(state: Pick<SettingsState, 'geometrySyncUntil'>): boolean {
  return state.geometrySyncUntil > Date.now()
}

function syncMissingBaselineWindowBounds(state: SettingsState, bounds: WindowBounds): Profile | null {
  const baseline = state.savedProfileBaseline
  if (!baseline || state.hasUnsavedProfileChanges) {
    return baseline
  }

  if (isWithinGeometrySyncWindow(state)) {
    return normalizeProfile({
      ...baseline,
      windowBounds: bounds,
    }, baseline.name)
  }

  if (baseline.windowBounds) {
    return baseline
  }

  return baseline
}

function syncMissingBaselinePopoutBounds(
  state: SettingsState,
  kind: ScopeKind,
  bounds: WindowBounds,
): Profile | null {
  const baseline = state.savedProfileBaseline
  const baselinePopout = baseline?.scopePopouts[kind]
  if (!baseline || state.hasUnsavedProfileChanges || !baselinePopout?.poppedOut) {
    return baseline
  }

  if (isWithinGeometrySyncWindow(state)) {
    return normalizeProfile({
      ...baseline,
      scopePopouts: {
        ...baseline.scopePopouts,
        [kind]: {
          ...baselinePopout,
          windowBounds: bounds,
        },
      },
    }, baseline.name)
  }

  if (baselinePopout.windowBounds) {
    return baseline
  }

  return baseline
}

function applyLoadedProfileEffects(profile: Profile | null): void {
  if (!profile) {
    return
  }

  const { activeThemeId, themes, loadTheme } = useThemeStore.getState()
  if (profile.themeId && profile.themeId !== activeThemeId && themes[profile.themeId]) {
    void loadTheme(profile.themeId)
  }

  if (profile.windowBounds && canUseElectronAPI()) {
    window.electronAPI.setWindowBounds(profile.windowBounds)
  }
}

function syncCurrentMainWindowBounds(
  set: (updater: (state: SettingsState) => SettingsState) => void,
): void {
  if (!canUseElectronAPI()) {
    return
  }

  void window.electronAPI.getWindowBounds().then((bounds) => {
    if (!bounds) {
      return
    }

    set((state) => {
      const baseline = state.savedProfileBaseline
      if (!baseline || state.hasUnsavedProfileChanges) {
        return state
      }

      const nextState = commitWorkingState(state, {
        windowBounds: bounds,
      }, normalizeProfile({
        ...baseline,
        windowBounds: bounds,
      }, baseline.name))

      return {
        ...nextState,
        geometrySyncUntil: 0,
      }
    })
  })
}

function applyProfileSnapshot(
  set: (updater: (state: SettingsState) => SettingsState) => void,
  snapshot: ProfileLibrarySnapshot,
  options: { loadActiveProfile: boolean },
): void {
  const activeProfile = snapshot.activeProfileId
    ? snapshot.profiles[snapshot.activeProfileId] ?? null
    : null
  const baselineProfile = activeProfile
    ? normalizeLoadedProfileForBaseline(activeProfile, snapshot.activeProfileId)
    : null

  set((state) => {
    if (!options.loadActiveProfile || !baselineProfile) {
      return withProfileDraftState({
        ...state,
        profiles: snapshot.profiles,
        activeProfileId: snapshot.activeProfileId,
        geometrySyncUntil: 0,
      }, baselineProfile)
    }

    const nextWorkingState = createWorkingStateFromProfile(baselineProfile)
    const nextState = withProfileDraftState({
      ...state,
      ...nextWorkingState,
      profiles: snapshot.profiles,
      activeProfileId: snapshot.activeProfileId,
      geometrySyncUntil: nextGeometrySyncDeadline(),
    }, baselineProfile)

    persistWorkingState(nextState)
    return nextState
  })

  if (options.loadActiveProfile) {
    applyLoadedProfileEffects(activeProfile)
    syncCurrentMainWindowBounds(set)
  }
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

async function restoreSavedProfileBaseline(
  set: (updater: (state: SettingsState) => SettingsState) => void,
  get: () => SettingsState,
): Promise<void> {
  const baseline = get().savedProfileBaseline
  if (!baseline) {
    return
  }

  const currentThemeId = useThemeStore.getState().activeThemeId
  if (baseline.themeId && baseline.themeId !== currentThemeId && useThemeStore.getState().themes[baseline.themeId]) {
    await useThemeStore.getState().loadTheme(baseline.themeId)
  }

  if (baseline.windowBounds && canUseElectronAPI()) {
    window.electronAPI.setWindowBounds(baseline.windowBounds)
  }

  set((state) => {
    const nextWorkingState = createWorkingStateFromProfile(baseline)
    const nextState = withProfileDraftState({
      ...state,
      ...nextWorkingState,
      geometrySyncUntil: nextGeometrySyncDeadline(),
    }, baseline)

    persistWorkingState(nextState)
    return nextState
  })

  syncCurrentMainWindowBounds(set)
}

const stored = canUseElectronAPI() ? {} : loadFromStorage()
const initialWorkingState: WorkingSettingsState = {
  themeId: typeof stored.themeId === 'string' && stored.themeId.trim()
    ? stored.themeId.trim()
    : null,
  scopeOrder: normalizeScopeOrder(stored.scopeOrder),
  hiddenScopes: new Set<ScopeKind>(normalizeHiddenScopes(stored.hiddenScopes)),
  widthWeights: normalizeWidthWeights(stored.widthWeights),
  scopeSettings: mergeScopeSettings(stored.scopeSettings),
  scopePopouts: normalizeScopePopouts(stored.scopePopouts),
  windowBounds: stored.windowBounds,
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialWorkingState,
  profiles: {
    [DEFAULT_PROFILE_ID]: createDefaultProfile(DEFAULT_PROFILE_NAME),
  },
  activeProfileId: null,
  savedProfileBaseline: null,
  hasUnsavedProfileChanges: false,
  geometrySyncUntil: 0,

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

  setThemeId: (themeId: string | null) => {
    set((state) => commitWorkingState(state, { themeId }))
  },

  toggleScope: (kind: ScopeKind) => {
    set((state) => {
      const next = new Set(state.hiddenScopes)
      if (!state.scopeOrder.includes(kind)) {
        next.delete(kind)
        return commitWorkingState(state, {
          scopeOrder: [...state.scopeOrder, kind],
          hiddenScopes: next,
        })
      }

      if (next.has(kind)) {
        next.delete(kind)
      } else {
        const visibleCount = state.scopeOrder.filter((scope) => !next.has(scope)).length
        if (visibleCount <= 1) {
          return state
        }
        next.add(kind)
      }

      return commitWorkingState(state, { hiddenScopes: next })
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
      if (nextOrder === state.scopeOrder) {
        return state
      }

      return commitWorkingState(state, { scopeOrder: nextOrder })
    })
  },

  setScopeWidthWeight: (kind: ScopeKind, weight: number) => {
    set((state) => {
      return commitWorkingState(state, {
        widthWeights: { ...state.widthWeights, [kind]: Math.max(0.1, weight) },
      })
    })
  },

  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => {
    set((state) => {
      return commitWorkingState(state, {
        scopeSettings: {
          ...state.scopeSettings,
          [kind]: { ...state.scopeSettings[kind], ...settings },
        },
      })
    })
  },

  popOutScope: (kind: ScopeKind, bounds?: WindowBounds) => {
    set((state) => {
      return commitWorkingState(state, {
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            poppedOut: true,
            windowBounds: bounds ?? state.scopePopouts[kind]?.windowBounds,
          },
        },
      })
    })
  },

  popInScope: (kind: ScopeKind) => {
    set((state) => {
      return commitWorkingState(state, {
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            ...state.scopePopouts[kind],
            poppedOut: false,
          },
        },
      })
    })
  },

  updatePopoutBounds: (kind: ScopeKind, bounds: WindowBounds) => {
    set((state) => {
      const isSyncingGeometry = isWithinGeometrySyncWindow(state)
      const nextBaseline = syncMissingBaselinePopoutBounds(state, kind, bounds)
      const nextState = commitWorkingState(state, {
        scopePopouts: {
          ...state.scopePopouts,
          [kind]: {
            ...state.scopePopouts[kind],
            windowBounds: bounds,
          },
        },
      }, nextBaseline)
      return isSyncingGeometry
        ? {
          ...nextState,
          geometrySyncUntil: nextGeometrySyncDeadline(),
        }
        : nextState
    })
  },

  updateMainWindowBounds: (bounds: WindowBounds) => {
    set((state) => {
      const isSyncingGeometry = isWithinGeometrySyncWindow(state)
      const nextBaseline = syncMissingBaselineWindowBounds(state, bounds)
      const nextState = commitWorkingState(state, { windowBounds: bounds }, nextBaseline)
      return isSyncingGeometry
        ? {
          ...nextState,
          geometrySyncUntil: nextGeometrySyncDeadline(),
        }
        : nextState
    })
  },

  discardUnsavedProfileChanges: async () => {
    await restoreSavedProfileBaseline(set, get)
  },

  guardProfileTransition: async (transition) => {
    const state = get()
    if (!canUseElectronAPI() || !state.hasUnsavedProfileChanges || !state.savedProfileBaseline) {
      await transition()
      return true
    }

    const choice = await window.electronAPI.promptUnsavedProfileChanges(getActiveProfileName(state))
    if (choice === 'cancel') {
      return false
    }

    if (choice === 'save') {
      try {
        await get().updateActiveProfile()
      } catch (error) {
        window.alert(getErrorMessage(error, 'Could not save the profile.'))
        return false
      }
    } else {
      await get().discardUnsavedProfileChanges()
    }

    await transition()
    return true
  },

  saveProfile: async (name: string) => {
    if (!canUseElectronAPI()) return null

    const snapshot = await window.electronAPI.saveNewProfile(
      name,
      buildProfileDraft(get(), name),
    )
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
    const name = getActiveProfileName(state)
    if (!id || !name) return

    const snapshot = await window.electronAPI.overwriteProfile(
      id,
      buildProfileDraft(state, name),
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

  importProfileFromPath: async (path: string) => {
    if (!canUseElectronAPI()) return

    const snapshot = await window.electronAPI.importProfileFromPath(path)
    applyProfileSnapshot(set, snapshot, { loadActiveProfile: true })
  },

  showProfilesFolder: async () => {
    if (!canUseElectronAPI()) return
    await window.electronAPI.revealProfilesFolder()
  },
}))

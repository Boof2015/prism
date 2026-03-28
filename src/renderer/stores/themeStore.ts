import { create } from 'zustand'
import type {
  LegacyThemeMigrationPayload,
  PrismResolvedTheme,
  PrismTheme,
  ThemeLibrarySnapshot,
} from '../../types/theme'
import {
  applyResolvedThemeToDocument,
  createDefaultTheme,
  normalizeLegacyThemePayload,
  resolveTheme,
} from '../../shared/themeState'

const LEGACY_STORAGE_KEY = 'prism:theme'

interface ThemeState {
  themes: Record<string, PrismTheme>
  activeThemeId: string | null
  activeTheme: PrismResolvedTheme
  accent: string
  initializeThemes: () => Promise<void>
  applyExternalThemeSnapshot: (snapshot: ThemeLibrarySnapshot) => void
  loadTheme: (id: string) => Promise<void>
  renameTheme: (id: string, name: string) => Promise<void>
  deleteTheme: (id: string) => Promise<void>
  reloadThemes: () => Promise<void>
  importThemeFromDialog: () => Promise<void>
  showThemesFolder: () => Promise<void>
}

function canUseElectronAPI(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function loadLegacyThemeMigrationPayload(): LegacyThemeMigrationPayload | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    return normalizeLegacyThemePayload(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function clearLegacyThemeStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Ignore localStorage failures.
  }
}

function applyThemeToDOM(theme: PrismResolvedTheme): void {
  if (typeof document === 'undefined') return
  applyResolvedThemeToDocument(theme, document.documentElement.style)
}

function resolveActiveTheme(snapshot: ThemeLibrarySnapshot): PrismResolvedTheme {
  const theme = snapshot.activeThemeId
    ? snapshot.themes[snapshot.activeThemeId] ?? null
    : null
  return resolveTheme(theme ?? createDefaultTheme())
}

function applyThemeSnapshot(
  set: (partial: Partial<ThemeState>) => void,
  snapshot: ThemeLibrarySnapshot,
): void {
  const activeTheme = resolveActiveTheme(snapshot)
  applyThemeToDOM(activeTheme)
  set({
    themes: snapshot.themes,
    activeThemeId: snapshot.activeThemeId,
    activeTheme,
    accent: activeTheme.interface.accent,
  })
}

const fallbackTheme = resolveTheme(createDefaultTheme())
applyThemeToDOM(fallbackTheme)

export const useThemeStore = create<ThemeState>((set) => ({
  themes: {
    [fallbackTheme.id]: createDefaultTheme(),
  },
  activeThemeId: fallbackTheme.id,
  activeTheme: fallbackTheme,
  accent: fallbackTheme.interface.accent,

  initializeThemes: async () => {
    if (!canUseElectronAPI()) return

    let snapshot = await window.electronAPI.getThemeSnapshot()
    const legacyPayload = loadLegacyThemeMigrationPayload()
    if (legacyPayload) {
      const migration = await window.electronAPI.migrateLegacyTheme(legacyPayload)
      if (migration.didMigrate) {
        snapshot = migration.snapshot
      }
      clearLegacyThemeStorage()
    }

    applyThemeSnapshot(set, snapshot)
  },

  applyExternalThemeSnapshot: (snapshot) => {
    applyThemeSnapshot(set, snapshot)
  },

  loadTheme: async (id: string) => {
    if (!canUseElectronAPI()) return
    const snapshot = await window.electronAPI.loadTheme(id)
    applyThemeSnapshot(set, snapshot)
  },

  renameTheme: async (id: string, name: string) => {
    if (!canUseElectronAPI()) return
    const snapshot = await window.electronAPI.renameTheme(id, name)
    applyThemeSnapshot(set, snapshot)
  },

  deleteTheme: async (id: string) => {
    if (!canUseElectronAPI()) return
    const snapshot = await window.electronAPI.deleteTheme(id)
    applyThemeSnapshot(set, snapshot)
  },

  reloadThemes: async () => {
    if (!canUseElectronAPI()) return
    const snapshot = await window.electronAPI.reloadThemes()
    applyThemeSnapshot(set, snapshot)
  },

  importThemeFromDialog: async () => {
    if (!canUseElectronAPI()) return
    const snapshot = await window.electronAPI.importThemeDialog()
    if (!snapshot) return
    applyThemeSnapshot(set, snapshot)
  },

  showThemesFolder: async () => {
    if (!canUseElectronAPI()) return
    await window.electronAPI.revealThemesFolder()
  },
}))

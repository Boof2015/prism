import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../types/settings'
import type { ScopeKind } from '../types/scope'
import type { PrismResolvedTheme } from '../types/theme'
import { createBundledThemes, createDefaultTheme, parseThemeFileContent, resolveTheme } from '../shared/themeState'
import { emitToHost, onHostEvent } from './juceBridge'

const DEFAULT_THEME = resolveTheme(createDefaultTheme())

function mergeScopeSettings<K extends ScopeKind>(kind: K, raw: unknown): ScopeSettings[K] {
  const defaults = DEFAULT_SCOPE_SETTINGS[kind] as Record<string, unknown>
  if (typeof raw !== 'object' || raw === null) return { ...defaults } as ScopeSettings[K]
  const parsed = raw as Record<string, unknown>
  const next: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(defaults)) {
    if (key in parsed && typeof parsed[key] === typeof defaults[key]) {
      next[key] = parsed[key]
    }
  }
  return next as ScopeSettings[K]
}

function resolveAppTheme(themeId: string, themeFile: string): PrismResolvedTheme {
  try {
    if (themeFile) return resolveTheme(parseThemeFileContent(themeFile, themeId || undefined))
  } catch {
    // fall through
  }
  if (themeId) {
    const bundled = createBundledThemes().find((theme) => theme.name === themeId)
    if (bundled) return resolveTheme(bundled)
  }
  return DEFAULT_THEME
}

function resolveAppScopeSettings<K extends ScopeKind>(kind: K, profileJson: string): ScopeSettings[K] {
  try {
    const parsed = JSON.parse(profileJson) as { scopeSettings?: Record<string, unknown> }
    const scoped = parsed?.scopeSettings?.[kind]
    if (scoped) return mergeScopeSettings(kind, scoped)
  } catch {
    // fall through
  }
  return { ...(DEFAULT_SCOPE_SETTINGS[kind] as object) } as ScopeSettings[K]
}

export interface ScopeHostSync<K extends ScopeKind> {
  settings: ScopeSettings[K]
  resolvedTheme: PrismResolvedTheme
  handleUpdate: (partial: Partial<ScopeSettings[K]>) => void
}

/**
 * Shared host sync for any scope plugin: applies app-default theme/settings,
 * persists per-instance overrides, and reconciles precedence (per-instance DAW
 * override > app settings > built-in defaults). Theme always follows the app.
 */
export function useScopeHostSync<K extends ScopeKind>(kind: K): ScopeHostSync<K> {
  const [settings, setSettings] = useState<ScopeSettings[K]>(() => mergeScopeSettings(kind, undefined))
  const [resolvedTheme, setResolvedTheme] = useState<PrismResolvedTheme>(DEFAULT_THEME)
  const settingsRef = useRef(settings)
  const hasOverride = useRef(false)

  const applySettings = useCallback((next: ScopeSettings[K], persist: boolean): void => {
    settingsRef.current = next
    setSettings(next)
    emitToHost('prismConfig', { settings: next, persist })
  }, [])

  useEffect(() => {
    const unsubRestore = onHostEvent('prismRestoreSettings', (payload) => {
      const json = (payload as { json?: unknown })?.json
      if (typeof json === 'string' && json.length > 0) {
        try {
          hasOverride.current = true
          applySettings(mergeScopeSettings(kind, JSON.parse(json)), false)
        } catch {
          // ignore malformed saved settings
        }
      }
    })

    const unsubDefaults = onHostEvent('prismAppDefaults', (payload) => {
      const p = (payload ?? {}) as { themeId?: string; themeFile?: string; profileJson?: string }
      setResolvedTheme(resolveAppTheme(p.themeId ?? '', p.themeFile ?? ''))
      if (!hasOverride.current) {
        applySettings(resolveAppScopeSettings(kind, p.profileJson ?? ''), false)
      }
    })

    emitToHost('prismReady', {})
    return () => {
      unsubRestore()
      unsubDefaults()
    }
  }, [kind, applySettings])

  const handleUpdate = useCallback((partial: Partial<ScopeSettings[K]>): void => {
    hasOverride.current = true
    applySettings({ ...settingsRef.current, ...partial }, true)
  }, [applySettings])

  return { settings, resolvedTheme, handleUpdate }
}

import type { ScopePopoutStateMap, WindowBounds } from '../../types/popout'
import type { Profile } from '../../types/profile'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import {
  cloneScopeSettings,
  normalizeProfile,
  normalizeScopePopouts,
} from '../../shared/profileState'

export interface ProfileDraftSource {
  themeId: string | null
  scopeOrder: ScopeKind[]
  hiddenScopes: Iterable<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
}

export function buildProfileDraft(
  source: ProfileDraftSource,
  name: string,
  fallbackThemeId: string | null = null,
): Profile {
  return normalizeProfile({
    name,
    themeId: source.themeId ?? fallbackThemeId,
    scopeOrder: [...source.scopeOrder],
    hiddenScopes: Array.from(source.hiddenScopes),
    widthWeights: { ...source.widthWeights },
    scopeSettings: cloneScopeSettings(source.scopeSettings),
    scopePopouts: normalizeScopePopouts(source.scopePopouts),
    windowBounds: source.windowBounds,
  }, name)
}

export function profilesMatch(left: Profile | null, right: Profile | null): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return JSON.stringify(normalizeProfile(left, left.name)) === JSON.stringify(normalizeProfile(right, right.name))
}

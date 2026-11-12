import type { ScopePopoutStateMap, WindowBounds } from '../../types/popout'
import type { Profile } from '../../types/profile'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import type { AnalysisSettings } from '../../types/analysis'
import type { ModuleInstance } from '../../types/moduleInstance'
import {
  cloneScopeSettings,
  normalizeProfile,
  normalizeScopePopouts,
} from '../../shared/profileState'

export interface ProfileDraftSource {
  scopeOrder: ScopeKind[]
  hiddenScopes: Iterable<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  analysisSettings: AnalysisSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
  moduleInstances?: ModuleInstance[]
  workspaceOrder?: string[]
  workspaceSpans?: Record<string, { columns: number; rows: number }>
}

export function buildProfileDraft(
  source: ProfileDraftSource,
  name: string,
): Profile {
  return normalizeProfile({
    name,
    scopeOrder: [...source.scopeOrder],
    hiddenScopes: Array.from(source.hiddenScopes),
    widthWeights: { ...source.widthWeights },
    scopeSettings: cloneScopeSettings(source.scopeSettings),
    analysisSettings: { ...source.analysisSettings },
    scopePopouts: normalizeScopePopouts(source.scopePopouts),
    windowBounds: source.windowBounds,
    moduleInstances: structuredClone(source.moduleInstances ?? []),
    workspaceOrder: [...(source.workspaceOrder ?? [])],
    workspaceSpans: structuredClone(source.workspaceSpans ?? {}),
  }, name)
}

export function profilesMatch(left: Profile | null, right: Profile | null): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return JSON.stringify(normalizeProfile(left, left.name)) === JSON.stringify(normalizeProfile(right, right.name))
}

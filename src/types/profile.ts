import type { ScopePopoutStateMap, WindowBounds } from './popout'
import type { ScopeKind } from './scope'
import type { ScopeSettings } from './settings'

export const PROFILE_FILE_FORMAT = 'prism-profile'
export const PROFILE_FILE_VERSION = 2
export const PROFILE_LOCAL_STATE_FORMAT = 'prism-profile-local'
export const PROFILE_LOCAL_STATE_VERSION = 1
export const LEGACY_PROFILE_MIGRATION_VERSION = 1
export const DEFAULT_PROFILE_ID = 'profile_default'
export const DEFAULT_PROFILE_NAME = 'Default'

export interface Profile {
  name: string
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: ScopePopoutStateMap
  windowBounds?: WindowBounds
}

export interface PrismProfileFileScopePopoutState {
  poppedOut: boolean
}

export type PrismProfileFileScopePopoutMap = Record<ScopeKind, PrismProfileFileScopePopoutState>

export interface PrismProfileFileV1 {
  format: typeof PROFILE_FILE_FORMAT
  version: 1
  id: string
  name: string
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: PrismProfileFileScopePopoutMap
}

export interface PrismProfileFileV2 {
  format: typeof PROFILE_FILE_FORMAT
  version: typeof PROFILE_FILE_VERSION
  id: string
  name: string
  themeId?: string | null
  scopeOrder: ScopeKind[]
  hiddenScopes: ScopeKind[]
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings
  scopePopouts: PrismProfileFileScopePopoutMap
}

export type PrismProfileFile = PrismProfileFileV1 | PrismProfileFileV2

export interface ProfileLocalMetadata {
  windowBounds?: WindowBounds
  scopePopoutBounds?: Partial<Record<ScopeKind, WindowBounds>>
}

export interface PrismProfileLocalStateV1 {
  format: typeof PROFILE_LOCAL_STATE_FORMAT
  version: typeof PROFILE_LOCAL_STATE_VERSION
  migrationVersion: number
  activeProfileId: string | null
  profiles: Record<string, ProfileLocalMetadata>
}

export interface ProfileSummary {
  id: string
  name: string
  isDefault: boolean
}

export interface ProfileLibrarySnapshot {
  profiles: Record<string, Profile>
  activeProfileId: string | null
}

export interface LegacyProfileMigrationPayload {
  profiles: Record<string, Profile>
  activeProfileId: string | null
}

export interface LegacyProfileMigrationResult {
  didMigrate: boolean
  snapshot: ProfileLibrarySnapshot
}

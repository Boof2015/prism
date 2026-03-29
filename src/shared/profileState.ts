import type { ScopePopoutStateMap, WindowBounds } from '../types/popout'
import {
  DEFAULT_PROFILE_NAME,
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
  PROFILE_LOCAL_STATE_FORMAT,
  PROFILE_LOCAL_STATE_VERSION,
  type Profile,
  type ProfileLocalMetadata,
  type PrismProfileFile,
  type PrismProfileFileScopePopoutMap,
  type PrismProfileFileV2,
  type PrismProfileLocalStateV1,
} from '../types/profile'
import { AUDIO_SCOPE_KINDS, SCOPE_KINDS, type ScopeKind } from '../types/scope'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../types/settings'

export const DEFAULT_VISIBLE: ScopeKind[] = ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter']
export const DEFAULT_SCOPE_ORDER: ScopeKind[] = [...AUDIO_SCOPE_KINDS]

export const DEFAULT_SCOPE_WIDTH_WEIGHTS: Record<ScopeKind, number> = {
  spectrum: 1,
  oscilloscope: 1,
  vectorscope: 1,
  spectrogram: 1,
  vumeter: 0.5,
  lufsmeter: 0.5,
  waveform: 1,
  astra: 1,
}

export function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && SCOPE_KINDS.includes(value as ScopeKind)
}

export function cloneScopeSettings(settings: ScopeSettings): ScopeSettings {
  return JSON.parse(JSON.stringify(settings)) as ScopeSettings
}

export function createDefaultScopePopouts(): ScopePopoutStateMap {
  return SCOPE_KINDS.reduce((acc, kind) => {
    acc[kind] = { poppedOut: false }
    return acc
  }, {} as ScopePopoutStateMap)
}

export function normalizeWindowBounds(
  raw: unknown,
  minWidth = 120,
  minHeight = 80,
): WindowBounds | undefined {
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
    width: Math.max(minWidth, Math.round(candidate.width)),
    height: Math.max(minHeight, Math.round(candidate.height)),
  }
}

export function normalizeScopeOrder(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SCOPE_ORDER]

  const valid = raw.filter(isScopeKind)
  const seen = new Set<ScopeKind>()
  const normalized: ScopeKind[] = []

  for (const kind of valid) {
    if (seen.has(kind)) continue
    seen.add(kind)
    normalized.push(kind)
  }

  for (const kind of DEFAULT_SCOPE_ORDER) {
    if (!seen.has(kind)) {
      normalized.push(kind)
    }
  }

  return normalized
}

export function normalizeHiddenScopes(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) {
    return SCOPE_KINDS.filter((kind) => !DEFAULT_VISIBLE.includes(kind))
  }

  return raw.filter(isScopeKind)
}

export function normalizeWidthWeights(raw: unknown): Record<ScopeKind, number> {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<ScopeKind, unknown>>
    : {}

  return SCOPE_KINDS.reduce((acc, kind) => {
    const value = parsed[kind]
    acc[kind] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0.1, value)
      : DEFAULT_SCOPE_WIDTH_WEIGHTS[kind]
    return acc
  }, {} as Record<ScopeKind, number>)
}

export function mergeScopeSettings(raw: unknown): ScopeSettings {
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
    astra: { ...DEFAULT_SCOPE_SETTINGS.astra, ...(parsed.astra ?? {}) },
  }
}

export function normalizeScopePopouts(raw: unknown): ScopePopoutStateMap {
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

export function normalizeProfileName(value: unknown, fallback = DEFAULT_PROFILE_NAME): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

export function createDefaultProfile(name = DEFAULT_PROFILE_NAME): Profile {
  return {
    name,
    themeId: null,
    scopeOrder: [...DEFAULT_SCOPE_ORDER],
    hiddenScopes: SCOPE_KINDS.filter((kind) => !DEFAULT_VISIBLE.includes(kind)),
    widthWeights: { ...DEFAULT_SCOPE_WIDTH_WEIGHTS },
    scopeSettings: cloneScopeSettings(DEFAULT_SCOPE_SETTINGS),
    scopePopouts: createDefaultScopePopouts(),
  }
}

export function normalizeProfile(raw: unknown, fallbackName = DEFAULT_PROFILE_NAME): Profile {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Profile>
    : {}

  return {
    name: normalizeProfileName(parsed.name, fallbackName),
    themeId: typeof parsed.themeId === 'string' && parsed.themeId.trim()
      ? parsed.themeId.trim()
      : null,
    scopeOrder: normalizeScopeOrder(parsed.scopeOrder),
    hiddenScopes: normalizeHiddenScopes(parsed.hiddenScopes),
    widthWeights: normalizeWidthWeights(parsed.widthWeights),
    scopeSettings: mergeScopeSettings(parsed.scopeSettings),
    scopePopouts: normalizeScopePopouts(parsed.scopePopouts),
    windowBounds: normalizeWindowBounds(parsed.windowBounds),
  }
}

export function normalizeProfileFileScopePopouts(raw: unknown): PrismProfileFileScopePopoutMap {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<ScopeKind, { poppedOut?: unknown }>>
    : {}

  return SCOPE_KINDS.reduce((acc, kind) => {
    acc[kind] = { poppedOut: Boolean(parsed[kind]?.poppedOut) }
    return acc
  }, {} as PrismProfileFileScopePopoutMap)
}

function readProfileFileThemeId(file: Partial<PrismProfileFile> | PrismProfileFile): string | null {
  if (!('themeId' in file)) return null
  const { themeId } = file
  return typeof themeId === 'string' && themeId.trim()
    ? themeId.trim()
    : null
}

export function normalizeProfileFile(
  raw: unknown,
  fallbackId: string,
  fallbackName = DEFAULT_PROFILE_NAME,
) : PrismProfileFileV2 {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismProfileFile>
    : {}

  const id = typeof parsed.id === 'string' && parsed.id.trim()
    ? parsed.id.trim()
    : fallbackId

  const name = normalizeProfileName(parsed.name, fallbackName)

  return {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    id,
    name,
    themeId: readProfileFileThemeId(parsed),
    scopeOrder: normalizeScopeOrder(parsed.scopeOrder),
    hiddenScopes: normalizeHiddenScopes(parsed.hiddenScopes),
    widthWeights: normalizeWidthWeights(parsed.widthWeights),
    scopeSettings: mergeScopeSettings(parsed.scopeSettings),
    scopePopouts: normalizeProfileFileScopePopouts(parsed.scopePopouts),
  }
}

export function profileToFileData(id: string, profile: Profile): PrismProfileFileV2 {
  const normalized = normalizeProfile(profile, profile.name)

  return {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    id,
    name: normalized.name,
    themeId: normalized.themeId,
    scopeOrder: [...normalized.scopeOrder],
    hiddenScopes: [...normalized.hiddenScopes],
    widthWeights: { ...normalized.widthWeights },
    scopeSettings: cloneScopeSettings(normalized.scopeSettings),
    scopePopouts: SCOPE_KINDS.reduce((acc, kind) => {
      acc[kind] = { poppedOut: normalized.scopePopouts[kind]?.poppedOut === true }
      return acc
    }, {} as PrismProfileFileScopePopoutMap),
  }
}

export function normalizeProfileLocalMetadata(raw: unknown): ProfileLocalMetadata {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<ProfileLocalMetadata>
    : {}

  const scopePopoutBounds = typeof parsed.scopePopoutBounds === 'object' && parsed.scopePopoutBounds !== null
    ? SCOPE_KINDS.reduce((acc, kind) => {
        const bounds = normalizeWindowBounds(parsed.scopePopoutBounds?.[kind])
        if (bounds) {
          acc[kind] = bounds
        }
        return acc
      }, {} as Partial<Record<ScopeKind, WindowBounds>>)
    : undefined

  return {
    windowBounds: normalizeWindowBounds(parsed.windowBounds),
    scopePopoutBounds: scopePopoutBounds && Object.keys(scopePopoutBounds).length > 0
      ? scopePopoutBounds
      : undefined,
  }
}

export function createEmptyProfileLocalState(): PrismProfileLocalStateV1 {
  return {
    format: PROFILE_LOCAL_STATE_FORMAT,
    version: PROFILE_LOCAL_STATE_VERSION,
    migrationVersion: 0,
    activeProfileId: null,
    profiles: {},
  }
}

export function normalizeProfileLocalState(raw: unknown): PrismProfileLocalStateV1 {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismProfileLocalStateV1>
    : {}

  const profiles = typeof parsed.profiles === 'object' && parsed.profiles !== null
    ? Object.entries(parsed.profiles).reduce((acc, [id, metadata]) => {
        if (!id.trim()) return acc
        acc[id] = normalizeProfileLocalMetadata(metadata)
        return acc
      }, {} as Record<string, ProfileLocalMetadata>)
    : {}

  return {
    format: PROFILE_LOCAL_STATE_FORMAT,
    version: PROFILE_LOCAL_STATE_VERSION,
    migrationVersion: typeof parsed.migrationVersion === 'number' && Number.isFinite(parsed.migrationVersion)
      ? Math.max(0, Math.trunc(parsed.migrationVersion))
      : 0,
    activeProfileId: typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null,
    profiles,
  }
}

export function extractLocalProfileMetadata(profile: Profile): ProfileLocalMetadata {
  const normalized = normalizeProfile(profile, profile.name)
  const scopePopoutBounds = SCOPE_KINDS.reduce((acc, kind) => {
    const bounds = normalized.scopePopouts[kind]?.windowBounds
    if (bounds) {
      acc[kind] = bounds
    }
    return acc
  }, {} as Partial<Record<ScopeKind, WindowBounds>>)

  return {
    windowBounds: normalized.windowBounds,
    scopePopoutBounds: Object.keys(scopePopoutBounds).length > 0 ? scopePopoutBounds : undefined,
  }
}

export function profileFileToProfile(
  file: PrismProfileFile,
  localMetadata?: ProfileLocalMetadata,
): Profile {
  const metadata = normalizeProfileLocalMetadata(localMetadata)

  return {
    name: normalizeProfileName(file.name, DEFAULT_PROFILE_NAME),
    themeId: readProfileFileThemeId(file),
    scopeOrder: normalizeScopeOrder(file.scopeOrder),
    hiddenScopes: normalizeHiddenScopes(file.hiddenScopes),
    widthWeights: normalizeWidthWeights(file.widthWeights),
    scopeSettings: mergeScopeSettings(file.scopeSettings),
    scopePopouts: SCOPE_KINDS.reduce((acc, kind) => {
      acc[kind] = {
        poppedOut: Boolean(file.scopePopouts[kind]?.poppedOut),
        windowBounds: metadata.scopePopoutBounds?.[kind],
      }
      return acc
    }, {} as ScopePopoutStateMap),
    windowBounds: metadata.windowBounds,
  }
}

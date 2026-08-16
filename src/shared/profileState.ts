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
  type PrismProfileFileV4,
  type PrismProfileLocalStateV1,
} from '../types/profile'
import { AUDIO_SCOPE_KINDS, SCOPE_KINDS, normalizeScopeKind, type ScopeKind } from '../types/scope'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../types/settings'
import { isLUFSMeterReadout } from '../types/lufsmeter'
import { normalizeSpectrumPeakInfoMode } from '../types/spectrum'
import {
  normalizeFrequencyRangeMode,
  normalizeFrequencyScaleMode,
} from '../types/frequencyScale'
import {
  clampSpectrogramScrollSpeed,
  clampSpectrogramTiltDbPerOctave,
  DEFAULT_SPECTROGRAM_CLARITY_MODE,
  isSpectrogramClarityMode,
} from '../types/spectrogram'
import { isVUMeterNeedleChannels, sanitizeVUReferenceDbfs } from '../types/vumeter'
import { clampWaveformScrollSpeed } from '../types/waveform'
import {
  normalizeScopeDisplayRotation,
  normalizeScopeMirrorHorizontal,
  type ScopeDisplayRotation,
} from '../types/scopeTransform'

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
  nowPlaying: 1,
}

export function isScopeKind(value: unknown): value is ScopeKind {
  return normalizeScopeKind(value) !== null
}

export function cloneScopeSettings(settings: ScopeSettings): ScopeSettings {
  return JSON.parse(JSON.stringify(settings)) as ScopeSettings
}

function isLegacyProfileFileVersion(version: unknown): boolean {
  return version === 1 || version === 2
}

function normalizeWaveformScrollSpeed(value: unknown, legacyProfileFileScale: boolean): number {
  if (legacyProfileFileScale && value !== undefined && value !== null) {
    const numeric = Number(value)
    return clampWaveformScrollSpeed(Number.isFinite(numeric) ? numeric / 2 : value)
  }

  return clampWaveformScrollSpeed(value ?? DEFAULT_SCOPE_SETTINGS.waveform.scrollSpeed)
}

function normalizeDisplayTransform(
  raw: { rotation?: unknown; mirrorHorizontal?: unknown },
  legacyRotation?: ScopeDisplayRotation,
): { rotation: ScopeDisplayRotation; mirrorHorizontal: boolean } {
  return {
    rotation: raw.rotation === undefined
      ? (legacyRotation ?? 0)
      : normalizeScopeDisplayRotation(raw.rotation),
    mirrorHorizontal: normalizeScopeMirrorHorizontal(raw.mirrorHorizontal),
  }
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

  const seen = new Set<ScopeKind>()
  const normalized: ScopeKind[] = []

  for (const rawKind of raw) {
    const kind = normalizeScopeKind(rawKind)
    if (!kind) continue
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

  const seen = new Set<ScopeKind>()
  const normalized: ScopeKind[] = []
  for (const rawKind of raw) {
    const kind = normalizeScopeKind(rawKind)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    normalized.push(kind)
  }
  return normalized
}

export function normalizeWidthWeights(raw: unknown): Record<ScopeKind, number> {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<ScopeKind, unknown>>
    : {}
  const legacyParsed = parsed as Partial<Record<ScopeKind | 'astra', unknown>>

  return SCOPE_KINDS.reduce((acc, kind) => {
    const value = legacyParsed[kind] ?? (kind === 'nowPlaying' ? legacyParsed.astra : undefined)
    acc[kind] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0.1, value)
      : DEFAULT_SCOPE_WIDTH_WEIGHTS[kind]
    return acc
  }, {} as Record<ScopeKind, number>)
}

export function mergeScopeSettings(
  raw: unknown,
  options: { legacyProfileFileScale?: boolean } = {},
): ScopeSettings {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<ScopeSettings>
    : {}
  const legacyParsed = parsed as Partial<ScopeSettings> & {
    astra?: Partial<ScopeSettings['nowPlaying']>
  }
  const rawSpectrum: Partial<ScopeSettings['spectrum']> = typeof parsed.spectrum === 'object' && parsed.spectrum !== null
    ? parsed.spectrum
    : {}
  const rawSpectrogram: Partial<ScopeSettings['spectrogram']> = typeof parsed.spectrogram === 'object' && parsed.spectrogram !== null
    ? parsed.spectrogram
    : {}
  const rawSpectrogramWithLegacy = rawSpectrogram as Partial<ScopeSettings['spectrogram']> & { orientation?: unknown }
  const { orientation: legacySpectrogramOrientation, ...rawSpectrogramSettings } = rawSpectrogramWithLegacy
  const legacySpectrogramRotation: ScopeDisplayRotation = legacySpectrogramOrientation === 'vertical' ? 90 : 0
  const rawOscilloscope: Partial<ScopeSettings['oscilloscope']> = typeof parsed.oscilloscope === 'object' && parsed.oscilloscope !== null
    ? parsed.oscilloscope
    : {}
  const rawWaveform: Partial<ScopeSettings['waveform']> = typeof parsed.waveform === 'object' && parsed.waveform !== null
    ? parsed.waveform
    : {}
  const rawLUFSMeter: Partial<ScopeSettings['lufsmeter']> = typeof parsed.lufsmeter === 'object' && parsed.lufsmeter !== null
    ? parsed.lufsmeter
    : {}
  const rawVUMeter: Partial<ScopeSettings['vumeter']> = typeof parsed.vumeter === 'object' && parsed.vumeter !== null
    ? parsed.vumeter
    : {}
  const rawNowPlaying: Partial<ScopeSettings['nowPlaying']> = typeof legacyParsed.nowPlaying === 'object' && legacyParsed.nowPlaying !== null
    ? legacyParsed.nowPlaying
    : (typeof legacyParsed.astra === 'object' && legacyParsed.astra !== null ? legacyParsed.astra : {})

  return {
    spectrum: {
      ...DEFAULT_SCOPE_SETTINGS.spectrum,
      ...rawSpectrum,
      ...normalizeDisplayTransform(rawSpectrum),
      scaleMode: normalizeFrequencyScaleMode(rawSpectrum.scaleMode),
      frequencyRangeMode: normalizeFrequencyRangeMode(rawSpectrum.frequencyRangeMode),
      peakInfoMode: normalizeSpectrumPeakInfoMode(rawSpectrum.peakInfoMode),
    },
    oscilloscope: {
      ...DEFAULT_SCOPE_SETTINGS.oscilloscope,
      ...rawOscilloscope,
      ...normalizeDisplayTransform(rawOscilloscope),
    },
    vectorscope: { ...DEFAULT_SCOPE_SETTINGS.vectorscope, ...(parsed.vectorscope ?? {}) },
    spectrogram: {
      ...DEFAULT_SCOPE_SETTINGS.spectrogram,
      ...rawSpectrogramSettings,
      ...normalizeDisplayTransform(rawSpectrogram, legacySpectrogramRotation),
      clarityMode: isSpectrogramClarityMode(rawSpectrogram.clarityMode)
        ? rawSpectrogram.clarityMode
        : DEFAULT_SPECTROGRAM_CLARITY_MODE,
      scaleMode: normalizeFrequencyScaleMode(rawSpectrogram.scaleMode),
      frequencyRangeMode: normalizeFrequencyRangeMode(rawSpectrogram.frequencyRangeMode),
      showGrid: typeof rawSpectrogram.showGrid === 'boolean' ? rawSpectrogram.showGrid : false,
      scrollSpeed: clampSpectrogramScrollSpeed(
        rawSpectrogram.scrollSpeed ?? DEFAULT_SCOPE_SETTINGS.spectrogram.scrollSpeed
      ),
      tiltDbPerOctave: clampSpectrogramTiltDbPerOctave(
        rawSpectrogram.tiltDbPerOctave ?? DEFAULT_SCOPE_SETTINGS.spectrogram.tiltDbPerOctave
      ),
    },
    vumeter: {
      ...DEFAULT_SCOPE_SETTINGS.vumeter,
      ...rawVUMeter,
      needleChannels: isVUMeterNeedleChannels(rawVUMeter.needleChannels)
        ? rawVUMeter.needleChannels
        : DEFAULT_SCOPE_SETTINGS.vumeter.needleChannels,
      referenceDb: sanitizeVUReferenceDbfs(rawVUMeter.referenceDb),
    },
    lufsmeter: {
      ...DEFAULT_SCOPE_SETTINGS.lufsmeter,
      ...rawLUFSMeter,
      readout: isLUFSMeterReadout(rawLUFSMeter.readout)
        ? rawLUFSMeter.readout
        : DEFAULT_SCOPE_SETTINGS.lufsmeter.readout,
    },
    waveform: {
      ...DEFAULT_SCOPE_SETTINGS.waveform,
      ...normalizeDisplayTransform(rawWaveform),
      mode: rawWaveform.mode === 'stereo' || rawWaveform.mode === 'mono'
        ? rawWaveform.mode
        : DEFAULT_SCOPE_SETTINGS.waveform.mode,
      scrollSpeed: normalizeWaveformScrollSpeed(rawWaveform.scrollSpeed, Boolean(options.legacyProfileFileScale)),
      multiband: typeof rawWaveform.multiband === 'boolean'
        ? rawWaveform.multiband
        : DEFAULT_SCOPE_SETTINGS.waveform.multiband,
    },
    nowPlaying: { ...DEFAULT_SCOPE_SETTINGS.nowPlaying, ...rawNowPlaying },
  }
}

export function normalizeScopePopouts(raw: unknown): ScopePopoutStateMap {
  const defaults = createDefaultScopePopouts()
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<ScopeKind, Partial<ScopePopoutStateMap[ScopeKind]>>>
    : {}
  const legacyParsed = parsed as Partial<Record<ScopeKind | 'astra', Partial<ScopePopoutStateMap[ScopeKind]>>>

  for (const kind of SCOPE_KINDS) {
    const value = legacyParsed[kind] ?? (kind === 'nowPlaying' ? legacyParsed.astra : undefined)
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
  const legacyParsed = parsed as Partial<Record<ScopeKind | 'astra', { poppedOut?: unknown }>>

  return SCOPE_KINDS.reduce((acc, kind) => {
    const value = legacyParsed[kind] ?? (kind === 'nowPlaying' ? legacyParsed.astra : undefined)
    acc[kind] = { poppedOut: Boolean(value?.poppedOut) }
    return acc
  }, {} as PrismProfileFileScopePopoutMap)
}

export function normalizeProfileFile(
  raw: unknown,
  fallbackId: string,
  fallbackName = DEFAULT_PROFILE_NAME,
) : PrismProfileFileV4 {
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
    scopeOrder: normalizeScopeOrder(parsed.scopeOrder),
    hiddenScopes: normalizeHiddenScopes(parsed.hiddenScopes),
    widthWeights: normalizeWidthWeights(parsed.widthWeights),
    scopeSettings: mergeScopeSettings(parsed.scopeSettings, {
      legacyProfileFileScale: isLegacyProfileFileVersion(parsed.version),
    }),
    scopePopouts: normalizeProfileFileScopePopouts(parsed.scopePopouts),
  }
}

export function profileToFileData(id: string, profile: Profile): PrismProfileFileV4 {
  const normalized = normalizeProfile(profile, profile.name)

  return {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    id,
    name: normalized.name,
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
        const legacyBounds = parsed.scopePopoutBounds as Partial<Record<ScopeKind | 'astra', unknown>> | undefined
        const bounds = normalizeWindowBounds(
          legacyBounds?.[kind] ?? (kind === 'nowPlaying' ? legacyBounds?.astra : undefined),
        )
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
    scopeOrder: normalizeScopeOrder(file.scopeOrder),
    hiddenScopes: normalizeHiddenScopes(file.hiddenScopes),
    widthWeights: normalizeWidthWeights(file.widthWeights),
    scopeSettings: mergeScopeSettings(file.scopeSettings, {
      legacyProfileFileScale: isLegacyProfileFileVersion(file.version),
    }),
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

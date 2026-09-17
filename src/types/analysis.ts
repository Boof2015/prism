import type { ScopeKind } from './scope'

export const LINKED_ANALYSIS_SCOPE_KINDS = [
  'spectrum',
  'spectrogram',
  'oscilloscope',
  'waveform',
] as const

export type LinkedAnalysisScopeKind = typeof LINKED_ANALYSIS_SCOPE_KINDS[number]

export interface AnalysisSettings {
  linkedAnalysis: boolean
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  linkedAnalysis: false,
}

export interface ScopeMeasurementDimensions {
  frequencyHz?: number
  spectralLevelDb?: number
  historySecondsAgo?: number
  frameTimeSeconds?: number
  signedAmplitude?: number
  channel?: 'L' | 'R'
}

export interface LinkedAnalysisProbe {
  active: true
  interactionId: string
  sourceKind: LinkedAnalysisScopeKind
  dimensions: ScopeMeasurementDimensions
}

export interface LinkedAnalysisEnd {
  active: false
  interactionId: string
  sourceKind: LinkedAnalysisScopeKind
}

export type LinkedAnalysisMessage = LinkedAnalysisProbe | LinkedAnalysisEnd

export interface LinkedAnalysisGuide {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface LinkedAnalysisProjection {
  guides: LinkedAnalysisGuide[]
  label: string
}

export function isLinkedAnalysisScopeKind(value: unknown): value is LinkedAnalysisScopeKind {
  return typeof value === 'string'
    && LINKED_ANALYSIS_SCOPE_KINDS.includes(value as LinkedAnalysisScopeKind)
}

export function isLinkedAnalysisCompatibleScopeKind(value: ScopeKind): value is LinkedAnalysisScopeKind {
  return isLinkedAnalysisScopeKind(value)
}

export function normalizeAnalysisSettings(raw: unknown): AnalysisSettings {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<AnalysisSettings>
    : {}
  return {
    linkedAnalysis: parsed.linkedAnalysis === true,
  }
}

function normalizeFiniteDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeScopeMeasurementDimensions(raw: unknown): ScopeMeasurementDimensions {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<Record<keyof ScopeMeasurementDimensions, unknown>>
    : {}
  const dimensions: ScopeMeasurementDimensions = {}
  const frequencyHz = normalizeFiniteDimension(parsed.frequencyHz)
  const spectralLevelDb = normalizeFiniteDimension(parsed.spectralLevelDb)
  const historySecondsAgo = normalizeFiniteDimension(parsed.historySecondsAgo)
  const frameTimeSeconds = normalizeFiniteDimension(parsed.frameTimeSeconds)
  const signedAmplitude = normalizeFiniteDimension(parsed.signedAmplitude)

  if (frequencyHz !== undefined && frequencyHz > 0) dimensions.frequencyHz = frequencyHz
  if (spectralLevelDb !== undefined) dimensions.spectralLevelDb = spectralLevelDb
  if (historySecondsAgo !== undefined && historySecondsAgo >= 0) dimensions.historySecondsAgo = historySecondsAgo
  if (frameTimeSeconds !== undefined && frameTimeSeconds >= 0) dimensions.frameTimeSeconds = frameTimeSeconds
  if (signedAmplitude !== undefined) dimensions.signedAmplitude = signedAmplitude
  if (parsed.channel === 'L' || parsed.channel === 'R') dimensions.channel = parsed.channel

  return dimensions
}

export function normalizeLinkedAnalysisMessage(raw: unknown): LinkedAnalysisMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const parsed = raw as Partial<LinkedAnalysisMessage>
  if (
    typeof parsed.interactionId !== 'string'
    || parsed.interactionId.length === 0
    || parsed.interactionId.length > 160
    || !isLinkedAnalysisScopeKind(parsed.sourceKind)
  ) {
    return null
  }

  if (parsed.active === false) {
    return {
      active: false,
      interactionId: parsed.interactionId,
      sourceKind: parsed.sourceKind,
    }
  }
  if (parsed.active !== true) return null

  return {
    active: true,
    interactionId: parsed.interactionId,
    sourceKind: parsed.sourceKind,
    dimensions: normalizeScopeMeasurementDimensions(parsed.dimensions),
  }
}

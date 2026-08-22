import type { CaptureBackendKind } from './capture'
import type { ScopeKind } from './scope'
import type { DawTransportSnapshot } from './dawBridge'
import type { ScopeSettings } from './settings'
import type { AnalysisSettings } from './analysis'
import type {
  ResolvedAstraTheme,
  ResolvedInterfaceTheme,
  ResolvedLUFSMeterTheme,
  ResolvedOscilloscopeTheme,
  ResolvedSpectrogramTheme,
  ResolvedSpectrumTheme,
  ResolvedVectorscopeTheme,
  ResolvedVUMeterTheme,
  ResolvedWaveformTheme,
} from './theme'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScopePopoutState {
  poppedOut: boolean
  windowBounds?: WindowBounds
}

export type ScopePopoutStateMap = Record<ScopeKind, ScopePopoutState>

export interface ScopePopoutSyncState {
  shouldBeOpen: boolean
  bounds?: WindowBounds
}

export type ScopePopoutSyncStateMap = Record<ScopeKind, ScopePopoutSyncState>

export interface ScopePopoutSessionState {
  sessionId: number
  sampleRate: number
  channelCount: number
  capturing: boolean
  suspended: boolean
  backendKind: CaptureBackendKind | null
}

export interface ScopePopoutStereoChunk {
  left: Float32Array
  right: Float32Array
  transport?: DawTransportSnapshot
}

export type ScopePopoutMonoBatch = Float32Array[]
export type ScopePopoutStereoBatch = ScopePopoutStereoChunk[]
export type ScopePopoutAudioBatch = ScopePopoutMonoBatch | ScopePopoutStereoBatch

export type ScopePopoutResolvedScopeTheme =
  | ResolvedSpectrumTheme
  | ResolvedOscilloscopeTheme
  | ResolvedVectorscopeTheme
  | ResolvedSpectrogramTheme
  | ResolvedVUMeterTheme
  | ResolvedLUFSMeterTheme
  | ResolvedWaveformTheme
  | ResolvedAstraTheme

export interface ScopePopoutSnapshot<K extends ScopeKind = ScopeKind> {
  kind: K
  label: string
  interfaceTheme: ResolvedInterfaceTheme
  scopeTheme: ScopePopoutResolvedScopeTheme
  settings: ScopeSettings[K]
  analysisSettings: AnalysisSettings
}

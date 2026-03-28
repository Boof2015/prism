import type { CaptureBackendKind } from './capture'
import type { ScopeKind } from './scope'
import type { ScopeSettings } from './settings'
import type {
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
  backendKind: CaptureBackendKind | null
}

export interface ScopePopoutStereoChunk {
  left: Float32Array
  right: Float32Array
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

export interface ScopePopoutSnapshot<K extends ScopeKind = ScopeKind> {
  kind: K
  label: string
  interfaceTheme: ResolvedInterfaceTheme
  scopeTheme: ScopePopoutResolvedScopeTheme
  settings: ScopeSettings[K]
}

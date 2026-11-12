import type { AudioScopeKind } from './scope'
import type { ScopeSettings } from './settings'

export type ModuleInstanceKind = AudioScopeKind | 'pitch'

export interface PitchSettings {
  mode: 'auto' | 'semi-auto'
  primaryTargetHz: number
  secondaryTargetHz: number
}

export const DEFAULT_PITCH_SETTINGS: PitchSettings = {
  mode: 'auto',
  primaryTargetHz: 440,
  secondaryTargetHz: 220,
}

export interface ModuleInstance {
  id: string
  kind: ModuleInstanceKind
  settings: ScopeSettings[AudioScopeKind] | PitchSettings
  channelPairLeft?: number
  linkSettings?: boolean
}

export const MODULE_INSTANCE_KINDS: readonly ModuleInstanceKind[] = [
  'waterfall', 'spectrum', 'oscilloscope', 'vectorscope', 'spectrogram',
  'vumeter', 'lufsmeter', 'waveform', 'pitch',
]


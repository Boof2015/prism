import type { AudioScopeKind } from './scope'
import type { ScopeSettings } from './settings'
import type { PitchSettings } from './pitch'

export type ModuleInstanceKind = AudioScopeKind

export { DEFAULT_PITCH_SETTINGS, type PitchSettings } from './pitch'

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


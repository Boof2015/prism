import type { AudioScopeKind } from './scope'
import type { ScopeSettings } from './settings'
import type { PitchSettings } from './pitch'

export type ModuleInstanceKind = AudioScopeKind | 'bassvumeter'

export type BassVUMeterSettings = ScopeSettings['vumeter'] & { cutoffHz?: number }

export const DEFAULT_BASS_VU_SETTINGS: BassVUMeterSettings = {
  ...({ mode: 'bar', lowCutHz: 20, highCutHz: 120, attackMs: 5, releaseMs: 180, showCorrelation: true, orientation: 'horizontal', needleChannels: 'stereo', referenceDb: -18 } satisfies ScopeSettings['vumeter']),
  cutoffHz: 120,
}

export { DEFAULT_PITCH_SETTINGS, type PitchSettings } from './pitch'

export interface ModuleInstance {
  id: string
  kind: ModuleInstanceKind
  settings: ScopeSettings[AudioScopeKind] | PitchSettings | BassVUMeterSettings
  channelPairLeft?: number
  linkSettings?: boolean
}

export const MODULE_INSTANCE_KINDS: readonly ModuleInstanceKind[] = [
  'waterfall', 'spectrum', 'oscilloscope', 'vectorscope', 'spectrogram',
  'vumeter', 'lufsmeter', 'waveform', 'pitch',
]


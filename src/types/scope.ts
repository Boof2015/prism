export type ScopeKind =
  | 'spectrum'
  | 'oscilloscope'
  | 'vectorscope'
  | 'spectrogram'
  | 'vumeter'
  | 'lufsmeter'
  | 'waveform'
  | 'nowPlaying'

export type AudioScopeKind = Exclude<ScopeKind, 'nowPlaying'>

export type TransformableScopeKind =
  | 'spectrum'
  | 'oscilloscope'
  | 'spectrogram'
  | 'waveform'

export const SCOPE_KINDS: ScopeKind[] = [
  'spectrum',
  'oscilloscope',
  'vectorscope',
  'spectrogram',
  'vumeter',
  'lufsmeter',
  'waveform',
  'nowPlaying',
]

export const AUDIO_SCOPE_KINDS: AudioScopeKind[] = [
  'spectrum',
  'oscilloscope',
  'vectorscope',
  'spectrogram',
  'vumeter',
  'lufsmeter',
  'waveform',
]

export const TRANSFORMABLE_SCOPE_KINDS: TransformableScopeKind[] = [
  'spectrum',
  'oscilloscope',
  'spectrogram',
  'waveform',
]

export function isTransformableScopeKind(value: ScopeKind): value is TransformableScopeKind {
  return TRANSFORMABLE_SCOPE_KINDS.includes(value as TransformableScopeKind)
}

export function isAudioScopeKind(value: unknown): value is AudioScopeKind {
  return typeof value === 'string' && AUDIO_SCOPE_KINDS.includes(value as AudioScopeKind)
}

export function normalizeScopeKind(value: unknown): ScopeKind | null {
  if (value === 'astra') {
    return 'nowPlaying'
  }

  return typeof value === 'string' && SCOPE_KINDS.includes(value as ScopeKind)
    ? value as ScopeKind
    : null
}

export const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'Loudness Meter',
  waveform: 'Waveform',
  nowPlaying: 'Now Playing',
}

export type ScopeKind = 'spectrum' | 'oscilloscope' | 'vectorscope' | 'spectrogram' | 'vumeter' | 'lufsmeter' | 'waveform'

export const SCOPE_KINDS: ScopeKind[] = [
  'spectrum',
  'oscilloscope',
  'vectorscope',
  'spectrogram',
  'vumeter',
  'lufsmeter',
  'waveform',
]

export const SCOPE_LABELS: Record<ScopeKind, string> = {
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VU Meter',
  lufsmeter: 'LUFS Meter',
  waveform: 'Waveform',
}

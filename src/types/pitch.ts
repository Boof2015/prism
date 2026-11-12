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

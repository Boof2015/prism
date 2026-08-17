export const ROLLING_CAPTURE_DURATIONS = [5, 10, 30, 60] as const

export type RollingCaptureDurationSeconds = typeof ROLLING_CAPTURE_DURATIONS[number]

export interface RollingCaptureStatus {
  durationSeconds: RollingCaptureDurationSeconds | null
  hasAudio: boolean
  ready: boolean
  allocatedBytes: number
}

export interface RollingAudioSnapshot {
  pcmSamples: Int16Array
  sampleRate: number
  channelCount: 1 | 2
  frameCount: number
}

export interface AudioClipDragPayload {
  pcmBytes: Uint8Array
  sampleRate: number
  channelCount: 1 | 2
  frameCount: number
}

export function isRollingCaptureDuration(
  value: unknown,
): value is RollingCaptureDurationSeconds {
  return typeof value === 'number'
    && ROLLING_CAPTURE_DURATIONS.some((duration) => duration === value)
}

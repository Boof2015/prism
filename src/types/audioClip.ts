export const ROLLING_CAPTURE_DURATIONS = [5, 10, 30, 60] as const

export type RollingCaptureDurationSeconds = typeof ROLLING_CAPTURE_DURATIONS[number]

export type AudioClipFormat = 'pcm16' | 'float32'

export const AUDIO_CLIP_FORMAT_LABELS: Record<AudioClipFormat, string> = {
  pcm16: '16-bit PCM',
  float32: '32-bit float',
}

export function isAudioClipFormat(value: unknown): value is AudioClipFormat {
  return value === 'pcm16' || value === 'float32'
}

export interface RollingCaptureStatus {
  durationSeconds: RollingCaptureDurationSeconds | null
  hasAudio: boolean
  ready: boolean
  allocatedBytes: number
}

export interface RollingAudioSnapshot {
  pcmSamples: Float32Array
  sampleRate: number
  channelCount: 1 | 2
  frameCount: number
}

export interface AudioClipDragPayload {
  format: AudioClipFormat
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

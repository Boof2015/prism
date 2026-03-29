export const DEFAULT_ASTRA_BASE_URL = 'http://127.0.0.1:38401'

export type AstraPlaybackState = 'stopped' | 'playing' | 'paused' | 'loading'
export type AstraConnectionState = 'disabled' | 'connecting' | 'connected' | 'error'
export type AstraControlCommand = 'play' | 'pause' | 'next' | 'previous'

export interface AstraTrackSnapshot {
  id: string
  title: string
  artist: string
  album: string
  isFavorite: boolean
  artworkDataUrl: string | null
}

export interface AstraNowPlayingSnapshot {
  playbackState: AstraPlaybackState
  currentTime: number
  duration: number
  queueLength: number
  outputDeviceLabel: string | null
  visualizerLineColor: string
  currentTrack: AstraTrackSnapshot | null
  updatedAt: number
}

export interface AstraIntegrationConfig {
  baseUrl: string
  token: string
}

export interface AstraIntegrationState {
  config: AstraIntegrationConfig
  connectionState: AstraConnectionState
  lastError: string | null
  lastControlError: string | null
  snapshot: AstraNowPlayingSnapshot | null
}

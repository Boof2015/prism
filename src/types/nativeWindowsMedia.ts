import type { NativeCaptureSupport } from './nativeCapture'
import type { NowPlayingControlCommand } from './nowPlaying'

export type NativeWindowsMediaSupport = NativeCaptureSupport

export interface NativeWindowsPlaybackState {
  album: string
  artworkDataUrl: string | null
  artist: string
  durationMs: number
  playbackStatus: string
  positionMs: number
  sourceAppUserModelId: string
  title: string
}

export type NativeWindowsSpotifyPlaybackState = NativeWindowsPlaybackState

export interface NativeWindowsMediaAPI {
  getTidalPlaybackState?: () => NativeWindowsPlaybackState | null
  sendTidalControl?: (command: NowPlayingControlCommand) => boolean
  getSupport: () => NativeWindowsMediaSupport
  getSpotifyPlaybackState: () => NativeWindowsSpotifyPlaybackState | null
  sendSpotifyControl: (command: NowPlayingControlCommand) => boolean
}

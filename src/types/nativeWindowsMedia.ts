import type { NativeCaptureSupport } from './nativeCapture'
import type { NowPlayingControlCommand } from './nowPlaying'

export type NativeWindowsMediaSupport = NativeCaptureSupport

export interface NativeWindowsSpotifyPlaybackState {
  album: string
  artist: string
  durationMs: number
  playbackStatus: string
  positionMs: number
  sourceAppUserModelId: string
  title: string
}

export interface NativeWindowsMediaAPI {
  getSupport: () => NativeWindowsMediaSupport
  getSpotifyPlaybackState: () => NativeWindowsSpotifyPlaybackState | null
  sendSpotifyControl: (command: NowPlayingControlCommand) => boolean
}

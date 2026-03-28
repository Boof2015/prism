import { audioRouter } from '../audio/AudioRouter'
import { nativeVisualizerTransport } from '../audio/NativeVisualizerTransport'
import type { ScopePopoutSessionState } from '../../types/popout'
import type { NativeVisualizerTransport } from '../audio/NativeVisualizerTransport'

export interface VisualizerSessionSource {
  getSampleRate: () => number
  isPlaying: () => boolean
  subscribeToSessionChanges: (listener: (state: ScopePopoutSessionState) => void) => () => void
  getNativeVisualizerTransport?: () => NativeVisualizerTransport | null
}

export const defaultVisualizerSessionSource: VisualizerSessionSource = {
  getSampleRate: () => audioRouter.getSampleRate(),
  isPlaying: () => audioRouter.isCapturing(),
  subscribeToSessionChanges: (listener) => audioRouter.subscribeToSessionChanges((state) => listener(state)),
  getNativeVisualizerTransport: () => nativeVisualizerTransport,
}

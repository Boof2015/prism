import { audioRouter } from '../audio/AudioRouter'
import type { ScopePopoutSessionState } from '../../types/popout'

export interface VisualizerSessionSource {
  getSampleRate: () => number
  isPlaying: () => boolean
  subscribeToSessionChanges: (listener: (state: ScopePopoutSessionState) => void) => () => void
}

export const defaultVisualizerSessionSource: VisualizerSessionSource = {
  getSampleRate: () => audioRouter.getSampleRate(),
  isPlaying: () => audioRouter.isCapturing(),
  subscribeToSessionChanges: (listener) => audioRouter.subscribeToSessionChanges((state) => listener(state)),
}

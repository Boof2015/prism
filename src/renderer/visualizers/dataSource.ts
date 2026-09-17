import { audioRouter } from '../audio/AudioRouter'
import type { ScopePopoutSessionState } from '../../types/popout'
import type { CaptureBackendKind } from '../../types/capture'

export interface VisualizerSessionSource {
  getSampleRate: () => number
  isPlaying: () => boolean
  getBackendKind?: () => CaptureBackendKind | null
  subscribeToSessionChanges: (listener: (state: ScopePopoutSessionState) => void) => () => void
}

export const defaultVisualizerSessionSource: VisualizerSessionSource = {
  getSampleRate: () => audioRouter.getSampleRate(),
  isPlaying: () => audioRouter.isCapturing(),
  getBackendKind: () => audioRouter.getSessionState().backendKind,
  subscribeToSessionChanges: (listener) => audioRouter.subscribeToSessionChanges((state) => listener(state)),
}

import type { AudioScopeKind } from '../../types/scope'
import type { ModuleInstanceKind } from '../../types/moduleInstance'
import { AudioRouter, audioRouter } from './AudioRouter'

export interface ScopeInstanceDataSource {
  getSampleRate: () => number
  isPlaying: () => boolean
  getBackendKind: () => ReturnType<AudioRouter['getSessionState']>['backendKind']
  subscribeToSessionChanges: AudioRouter['subscribeToSessionChanges']
  getPendingWaterfallSamples: AudioRouter['flushPendingWaterfallSamples']
  getPendingOscilloscopeSamples: AudioRouter['flushPendingOscilloscopeSamples']
  getPendingSpectrumSamples: AudioRouter['flushPendingSpectrumSamples']
  getPendingSpectrumStereoSamples: AudioRouter['flushPendingSpectrumStereoSamples']
  getPendingSpectrogramSamples: AudioRouter['flushPendingSpectrogramSamples']
  getPendingSpectrogramStereoSamples: AudioRouter['flushPendingSpectrogramStereoSamples']
  getPendingVectorscopeSamples: AudioRouter['flushPendingVectorscopeSamples']
  getPendingVUMeterSamples: AudioRouter['flushPendingVUMeterSamples']
  getPendingPitchSamples: AudioRouter['flushPendingPitchSamples']
  getPendingLUFSMeterSamples: AudioRouter['flushPendingLUFSMeterSamples']
  getPendingWaveformSamples: AudioRouter['flushPendingWaveformSamples']
  getPendingWaveformStereoSamples: AudioRouter['flushPendingWaveformStereoSamples']
  getPendingWaveformAnnotatedSamples: AudioRouter['flushPendingWaveformAnnotatedSamples']
  setChannelPair: (left: number | null) => void
  dispose: () => void
}

export function createScopeInstanceDataSource(kind: ModuleInstanceKind, channelPairLeft?: number): ScopeInstanceDataSource {
  const router = new AudioRouter()
  const routerKind: AudioScopeKind = kind
  let sourceSessionId = -1
  let localSessionId = 0

  router.setVisualizerConsumerDemand('module-instance', { [routerKind]: true })
  const syncSession = (state: ReturnType<typeof audioRouter.getSessionState>): void => {
    if (!state.capturing) {
      sourceSessionId = -1
      router.endSession()
      return
    }
    if (state.sessionId !== sourceSessionId) {
      sourceSessionId = state.sessionId
      localSessionId = router.beginSession(state.sampleRate, state.channelCount, state.backendKind)
    }
    if (state.suspended) router.suspendSession()
    else router.resumeSession()
  }

  const setChannelPair = (left: number | null): void => {
    router.setScopeChannelPair(routerKind, left === null ? null : { left, right: left + 1 })
  }
  setChannelPair(channelPairLeft ?? null)

  const unsubscribeSession = audioRouter.subscribeToSessionChanges(syncSession)
  const unsubscribeChunks = audioRouter.subscribeToInputChunks((left, right, meta) => {
    if (sourceSessionId < 0) return
    router.ingestChunk(left, right, { ...meta, sessionId: localSessionId })
  })

  return {
    getSampleRate: () => router.getSampleRate(),
    isPlaying: () => router.isCapturing(),
    getBackendKind: () => router.getSessionState().backendKind,
    subscribeToSessionChanges: (listener) => router.subscribeToSessionChanges(listener),
    getPendingWaterfallSamples: () => router.flushPendingWaterfallSamples(),
    getPendingOscilloscopeSamples: () => router.flushPendingOscilloscopeSamples(),
    getPendingSpectrumSamples: () => router.flushPendingSpectrumSamples(),
    getPendingSpectrumStereoSamples: () => router.flushPendingSpectrumStereoSamples(),
    getPendingSpectrogramSamples: () => router.flushPendingSpectrogramSamples(),
    getPendingSpectrogramStereoSamples: () => router.flushPendingSpectrogramStereoSamples(),
    getPendingVectorscopeSamples: () => router.flushPendingVectorscopeSamples(),
    getPendingVUMeterSamples: () => router.flushPendingVUMeterSamples(),
    getPendingPitchSamples: () => router.flushPendingPitchSamples(),
    getPendingLUFSMeterSamples: () => router.flushPendingLUFSMeterSamples(),
    getPendingWaveformSamples: () => router.flushPendingWaveformSamples(),
    getPendingWaveformStereoSamples: () => router.flushPendingWaveformStereoSamples(),
    getPendingWaveformAnnotatedSamples: () => router.flushPendingWaveformAnnotatedSamples(),
    setChannelPair,
    dispose: () => {
      unsubscribeChunks()
      unsubscribeSession()
      router.clearVisualizerConsumerDemand('module-instance')
      router.endSession()
    },
  }
}

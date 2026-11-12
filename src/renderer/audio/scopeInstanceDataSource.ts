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
  setBassCutoff?: (cutoffHz: number) => void
  dispose: () => void
}

export function createScopeInstanceDataSource(kind: ModuleInstanceKind, channelPairLeft?: number, initialBassCutoff = 120): ScopeInstanceDataSource {
  const router = new AudioRouter()
  const routerKind: AudioScopeKind = kind === 'bassvumeter' ? 'vumeter' : kind
  let sourceSessionId = -1
  let localSessionId = 0
  let bassCutoff = Math.min(350, Math.max(20, initialBassCutoff))
  let disposeTimer: ReturnType<typeof setTimeout> | undefined
  const filterState = {
    left: { x1: 0, x2: 0, y1: 0, y2: 0 },
    right: { x1: 0, x2: 0, y1: 0, y2: 0 },
  }

  const resetBassFilter = (): void => {
    Object.assign(filterState.left, { x1: 0, x2: 0, y1: 0, y2: 0 })
    Object.assign(filterState.right, { x1: 0, x2: 0, y1: 0, y2: 0 })
  }

  const lowPass = (input: Float32Array, state: typeof filterState.left): Float32Array => {
    const sampleRate = Math.max(1, router.getSampleRate())
    const omega = 2 * Math.PI * Math.min(bassCutoff, sampleRate * 0.45) / sampleRate
    const cos = Math.cos(omega)
    const sin = Math.sin(omega)
    const alpha = sin / (2 * Math.SQRT1_2)
    const a0 = 1 + alpha
    const b0 = ((1 - cos) / 2) / a0
    const b1 = (1 - cos) / a0
    const b2 = b0
    const a1 = (-2 * cos) / a0
    const a2 = (1 - alpha) / a0
    const output = new Float32Array(input.length)
    for (let index = 0; index < input.length; index += 1) {
      const x = input[index]!
      const y = b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2
      output[index] = y
      state.x2 = state.x1; state.x1 = x; state.y2 = state.y1; state.y1 = y
    }
    return output
  }

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
      resetBassFilter()
    }
    if (state.suspended) router.suspendSession()
    else router.resumeSession()
  }

  const setChannelPair = (left: number | null): void => {
    if (disposeTimer !== undefined) { clearTimeout(disposeTimer); disposeTimer = undefined }
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
    getPendingVUMeterSamples: () => {
      const chunks = router.flushPendingVUMeterSamples()
      if (kind !== 'bassvumeter') return chunks
      return chunks.map((chunk) => ({ left: lowPass(chunk.left, filterState.left), right: lowPass(chunk.right, filterState.right) }))
    },
    getPendingPitchSamples: () => router.flushPendingPitchSamples(),
    getPendingLUFSMeterSamples: () => router.flushPendingLUFSMeterSamples(),
    getPendingWaveformSamples: () => router.flushPendingWaveformSamples(),
    getPendingWaveformStereoSamples: () => router.flushPendingWaveformStereoSamples(),
    getPendingWaveformAnnotatedSamples: () => router.flushPendingWaveformAnnotatedSamples(),
    setChannelPair,
    ...(kind === 'bassvumeter' ? { setBassCutoff: (cutoffHz: number) => { bassCutoff = Math.min(350, Math.max(20, cutoffHz)) } } : {}),
    dispose: () => {
      disposeTimer = setTimeout(() => {
        unsubscribeChunks()
        unsubscribeSession()
        router.clearVisualizerConsumerDemand('module-instance')
        router.endSession()
        disposeTimer = undefined
      }, 0)
    },
  }
}

import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutStereoBatch,
} from '../../types/popout'
import type { ScopeKind } from '../../types/scope'
import { NativeVisualizerTransport } from '../audio/NativeVisualizerTransport'
import type { LUFSMeterDataSource } from '../visualizers/LUFSMeter'
import type { OscilloscopeDataSource } from '../visualizers/Oscilloscope'
import type { SpectrogramDataSource } from '../visualizers/Spectrogram'
import type { SpectrumAnalyzerDataSource } from '../visualizers/SpectrumAnalyzer'
import type { VectorscopeDataSource } from '../visualizers/Vectorscope'
import type { VUMeterDataSource } from '../visualizers/VUMeter'
import type { WaveformDataSource } from '../visualizers/Waveform'

type AnyScopeDataSource =
  & SpectrumAnalyzerDataSource
  & OscilloscopeDataSource
  & VectorscopeDataSource
  & SpectrogramDataSource
  & VUMeterDataSource
  & LUFSMeterDataSource
  & WaveformDataSource

const INITIAL_SESSION_STATE: ScopePopoutSessionState = {
  sessionId: 0,
  sampleRate: 48000,
  channelCount: 2,
  capturing: false,
  backendKind: null,
}

function isStereoBatch(batch: ScopePopoutAudioBatch): batch is ScopePopoutStereoBatch {
  return batch.length > 0 && typeof batch[0] === 'object' && batch[0] !== null && 'left' in batch[0] && 'right' in batch[0]
}

function isStereoScope(kind: ScopeKind): boolean {
  return kind === 'vectorscope' || kind === 'vumeter' || kind === 'lufsmeter'
}

export class ScopePopoutDataSource implements AnyScopeDataSource {
  private monoQueue: Float32Array[] = []
  private stereoQueue: ScopePopoutStereoBatch = []
  private sessionState: ScopePopoutSessionState = INITIAL_SESSION_STATE
  private readonly listeners = new Set<(state: ScopePopoutSessionState) => void>()
  private readonly nativeVisualizerTransport = new NativeVisualizerTransport()

  constructor(private readonly scopeKind: ScopeKind) {
    this.nativeVisualizerTransport.setDemand({
      spectrum: scopeKind === 'spectrum',
      oscilloscope: scopeKind === 'oscilloscope',
      vectorscope: scopeKind === 'vectorscope',
    })
    this.nativeVisualizerTransport.reset(this.sessionState)
  }

  pushAudioBatch(batch: ScopePopoutAudioBatch): void {
    if (isStereoScope(this.scopeKind)) {
      if (!isStereoBatch(batch)) return
      this.stereoQueue.push(...batch)
      for (const chunk of batch) {
        this.nativeVisualizerTransport.handleChunk(chunk.left, chunk.right, {
          sessionId: this.sessionState.sessionId,
          channelCount: this.sessionState.channelCount,
        })
      }
      return
    }

    if (this.scopeKind === 'spectrum' || this.scopeKind === 'waveform') {
      if (isStereoBatch(batch)) {
        this.monoQueue = []
        this.stereoQueue.push(...batch)
        if (this.scopeKind === 'spectrum') {
          for (const chunk of batch) {
            this.nativeVisualizerTransport.handleChunk(chunk.left, chunk.right, {
              sessionId: this.sessionState.sessionId,
              channelCount: this.sessionState.channelCount,
            })
          }
        }
        return
      }

      this.stereoQueue = []
      this.monoQueue.push(...batch)
      if (this.scopeKind === 'spectrum') {
        for (const chunk of batch) {
          this.nativeVisualizerTransport.handleChunk(chunk, chunk, {
            sessionId: this.sessionState.sessionId,
            channelCount: 1,
          })
        }
      }
      return
    }

    if (isStereoBatch(batch)) return
    this.monoQueue.push(...batch)
    for (const chunk of batch) {
      this.nativeVisualizerTransport.handleChunk(chunk, chunk, {
        sessionId: this.sessionState.sessionId,
        channelCount: 1,
      })
    }
  }

  setSessionState(nextState: ScopePopoutSessionState): void {
    this.sessionState = nextState
    this.nativeVisualizerTransport.reset(nextState)
    if (!nextState.capturing) {
      this.monoQueue = []
      this.stereoQueue = []
    }

    for (const listener of this.listeners) {
      listener(this.sessionState)
    }
  }

  getSampleRate(): number {
    return this.sessionState.sampleRate
  }

  isPlaying(): boolean {
    return this.sessionState.capturing
  }

  subscribeToSessionChanges(listener: (state: ScopePopoutSessionState) => void): () => void {
    this.listeners.add(listener)
    listener(this.sessionState)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getNativeVisualizerTransport(): NativeVisualizerTransport {
    return this.nativeVisualizerTransport
  }

  getPendingSpectrumSamples(): Float32Array[] {
    const batch = this.monoQueue
    this.monoQueue = []
    return this.scopeKind === 'spectrum' ? batch : []
  }

  getPendingSpectrumStereoSamples(): ScopePopoutStereoBatch {
    const batch = this.stereoQueue
    this.stereoQueue = []
    return this.scopeKind === 'spectrum' ? batch : []
  }

  getPendingOscilloscopeSamples(): Float32Array[] {
    const batch = this.monoQueue
    this.monoQueue = []
    return this.scopeKind === 'oscilloscope' ? batch : []
  }

  getPendingSpectrogramSamples(): Float32Array[] {
    const batch = this.monoQueue
    this.monoQueue = []
    return this.scopeKind === 'spectrogram' ? batch : []
  }

  getPendingWaveformSamples(): Float32Array[] {
    const batch = this.monoQueue
    this.monoQueue = []
    return this.scopeKind === 'waveform' ? batch : []
  }

  getPendingWaveformStereoSamples(): ScopePopoutStereoBatch {
    const batch = this.stereoQueue
    this.stereoQueue = []
    return this.scopeKind === 'waveform' ? batch : []
  }

  getPendingVectorscopeSamples(): ScopePopoutStereoBatch {
    const batch = this.stereoQueue
    this.stereoQueue = []
    return this.scopeKind === 'vectorscope' ? batch : []
  }

  getPendingVUMeterSamples(): ScopePopoutStereoBatch {
    const batch = this.stereoQueue
    this.stereoQueue = []
    return this.scopeKind === 'vumeter' ? batch : []
  }

  getPendingLUFSMeterSamples(): ScopePopoutStereoBatch {
    const batch = this.stereoQueue
    this.stereoQueue = []
    return this.scopeKind === 'lufsmeter' ? batch : []
  }
}

import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutStereoBatch,
} from '../../types/popout'
import type { ScopeKind } from '../../types/scope'
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

  constructor(private readonly scopeKind: ScopeKind) {}

  pushAudioBatch(batch: ScopePopoutAudioBatch): void {
    if (isStereoScope(this.scopeKind)) {
      if (!isStereoBatch(batch)) return
      this.stereoQueue.push(...batch)
      return
    }

    if (isStereoBatch(batch)) return
    this.monoQueue.push(...batch)
  }

  setSessionState(nextState: ScopePopoutSessionState): void {
    this.sessionState = nextState
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

  getPendingSpectrumSamples(): Float32Array[] {
    const batch = this.monoQueue
    this.monoQueue = []
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

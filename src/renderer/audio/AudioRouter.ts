/**
 * AudioRouter — distributes captured audio samples to per-scope pending buffers.
 * Pattern extracted from Astra's AudioEngine (lines 196-202, 470-561, 2997-3043).
 */

const MAX_PENDING_CHUNKS = 20
const MAX_PENDING_SPECTRUM_CHUNKS = 96
const MAX_PENDING_VECTORSCOPE_CHUNKS = 20

export interface AudioSessionState {
  sessionId: number
  sampleRate: number
  channelCount: number
  capturing: boolean
}

interface AudioChunkMeta {
  sessionId?: number
  channelCount?: number
}

class AudioRouter {
  private pendingOscilloscopeSamples: Float32Array[] = []
  private pendingSpectrumSamples: Float32Array[] = []
  private pendingSpectrogramSamples: Float32Array[] = []
  private pendingVectorscopeSamples: { left: Float32Array; right: Float32Array }[] = []
  private pendingVUMeterSamples: { left: Float32Array; right: Float32Array }[] = []
  private pendingLUFSMeterSamples: { left: Float32Array; right: Float32Array }[] = []
  private pendingWaveformSamples: Float32Array[] = []

  private _sampleRate = 48000
  private _capturing = false
  private _channelCount = 2
  private _sessionId = 0
  private sessionListeners = new Set<(state: AudioSessionState) => void>()

  private emitSessionState(): void {
    const state = this.getSessionState()
    for (const listener of this.sessionListeners) {
      listener(state)
    }
  }

  setSampleRate(rate: number): void {
    this._sampleRate = rate
  }

  getSampleRate(): number {
    return this._sampleRate
  }

  setCapturing(capturing: boolean): void {
    this._capturing = capturing
  }

  isCapturing(): boolean {
    return this._capturing
  }

  getChannelCount(): number {
    return this._channelCount
  }

  getSessionState(): AudioSessionState {
    return {
      sessionId: this._sessionId,
      sampleRate: this._sampleRate,
      channelCount: this._channelCount,
      capturing: this._capturing,
    }
  }

  beginSession(sampleRate: number, channelCount: number): number {
    this._sessionId += 1
    this._sampleRate = sampleRate
    this._channelCount = Math.max(1, Math.floor(channelCount) || 1)
    this._capturing = true
    this.reset()
    this.emitSessionState()
    return this._sessionId
  }

  endSession(): void {
    this._sessionId += 1
    this._capturing = false
    this.reset()
    this.emitSessionState()
  }

  subscribeToSessionChanges(listener: (state: AudioSessionState) => void): () => void {
    this.sessionListeners.add(listener)
    listener(this.getSessionState())
    return () => {
      this.sessionListeners.delete(listener)
    }
  }

  ingestChunk(left: Float32Array, right: Float32Array, meta: AudioChunkMeta = {}): void {
    if (!this._capturing) return
    if (meta.sessionId !== undefined && meta.sessionId !== this._sessionId) return

    const effectiveChannelCount = Math.max(1, Math.floor(meta.channelCount ?? this._channelCount) || 1)
    this._channelCount = effectiveChannelCount
    const resolvedRight = effectiveChannelCount > 1 && right.length > 0 ? right : left

    // Compute mono
    const len = Math.min(left.length, resolvedRight.length)
    if (len === 0) return

    const mono = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      mono[i] = (left[i] + resolvedRight[i]) / 2
    }

    // Oscilloscope — uses left channel
    if (this.pendingOscilloscopeSamples.length >= MAX_PENDING_CHUNKS) {
      this.pendingOscilloscopeSamples = this.pendingOscilloscopeSamples.slice(
        -Math.floor(MAX_PENDING_CHUNKS / 2)
      )
    }
    this.pendingOscilloscopeSamples.push(left.slice(0, len))

    // Spectrum — uses mono
    if (this.pendingSpectrumSamples.length >= MAX_PENDING_SPECTRUM_CHUNKS) {
      this.pendingSpectrumSamples = this.pendingSpectrumSamples.slice(
        -Math.floor(MAX_PENDING_SPECTRUM_CHUNKS / 2)
      )
    }
    this.pendingSpectrumSamples.push(mono)

    // Spectrogram — uses mono
    if (this.pendingSpectrogramSamples.length >= MAX_PENDING_SPECTRUM_CHUNKS) {
      this.pendingSpectrogramSamples = this.pendingSpectrogramSamples.slice(
        -Math.floor(MAX_PENDING_SPECTRUM_CHUNKS / 2)
      )
    }
    this.pendingSpectrogramSamples.push(mono)

    // Vectorscope — uses stereo
    if (this.pendingVectorscopeSamples.length >= MAX_PENDING_VECTORSCOPE_CHUNKS) {
      this.pendingVectorscopeSamples = this.pendingVectorscopeSamples.slice(
        -Math.floor(MAX_PENDING_VECTORSCOPE_CHUNKS / 2)
      )
    }
    this.pendingVectorscopeSamples.push({
      left: left.slice(0, len),
      right: resolvedRight.slice(0, len),
    })

    // VU Meter — uses stereo
    if (this.pendingVUMeterSamples.length >= MAX_PENDING_VECTORSCOPE_CHUNKS) {
      this.pendingVUMeterSamples = this.pendingVUMeterSamples.slice(
        -Math.floor(MAX_PENDING_VECTORSCOPE_CHUNKS / 2)
      )
    }
    this.pendingVUMeterSamples.push({
      left: left.slice(0, len),
      right: resolvedRight.slice(0, len),
    })

    // LUFS Meter — uses stereo
    if (this.pendingLUFSMeterSamples.length >= MAX_PENDING_SPECTRUM_CHUNKS) {
      this.pendingLUFSMeterSamples = this.pendingLUFSMeterSamples.slice(
        -Math.floor(MAX_PENDING_SPECTRUM_CHUNKS / 2)
      )
    }
    this.pendingLUFSMeterSamples.push({
      left: left.slice(0, len),
      right: resolvedRight.slice(0, len),
    })

    // Waveform — uses left channel
    if (this.pendingWaveformSamples.length >= MAX_PENDING_SPECTRUM_CHUNKS) {
      this.pendingWaveformSamples = this.pendingWaveformSamples.slice(
        -Math.floor(MAX_PENDING_SPECTRUM_CHUNKS / 2)
      )
    }
    this.pendingWaveformSamples.push(new Float32Array(left))
  }

  flushPendingOscilloscopeSamples(): Float32Array[] {
    const samples = this.pendingOscilloscopeSamples
    this.pendingOscilloscopeSamples = []
    return samples
  }

  flushPendingSpectrumSamples(): Float32Array[] {
    const samples = this.pendingSpectrumSamples
    this.pendingSpectrumSamples = []
    return samples
  }

  flushPendingSpectrogramSamples(): Float32Array[] {
    const samples = this.pendingSpectrogramSamples
    this.pendingSpectrogramSamples = []
    return samples
  }

  flushPendingVectorscopeSamples(): { left: Float32Array; right: Float32Array }[] {
    const samples = this.pendingVectorscopeSamples
    this.pendingVectorscopeSamples = []
    return samples
  }

  flushPendingVUMeterSamples(): { left: Float32Array; right: Float32Array }[] {
    const samples = this.pendingVUMeterSamples
    this.pendingVUMeterSamples = []
    return samples
  }

  flushPendingLUFSMeterSamples(): { left: Float32Array; right: Float32Array }[] {
    const samples = this.pendingLUFSMeterSamples
    this.pendingLUFSMeterSamples = []
    return samples
  }

  flushPendingWaveformSamples(): Float32Array[] {
    const samples = this.pendingWaveformSamples
    this.pendingWaveformSamples = []
    return samples
  }

  reset(): void {
    this.pendingOscilloscopeSamples = []
    this.pendingSpectrumSamples = []
    this.pendingSpectrogramSamples = []
    this.pendingVectorscopeSamples = []
    this.pendingVUMeterSamples = []
    this.pendingLUFSMeterSamples = []
    this.pendingWaveformSamples = []
  }
}

export const audioRouter = new AudioRouter()

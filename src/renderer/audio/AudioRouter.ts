/**
 * AudioRouter — distributes captured audio samples to per-scope pending buffers.
 * Pattern extracted from Astra's AudioEngine (lines 196-202, 470-561, 2997-3043).
 */

const MAX_PENDING_CHUNKS = 20
const MAX_PENDING_SPECTRUM_CHUNKS = 96
const MAX_PENDING_VECTORSCOPE_CHUNKS = 20

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

  ingestChunk(left: Float32Array, right: Float32Array): void {
    // Compute mono
    const len = Math.min(left.length, right.length)
    const mono = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      mono[i] = (left[i] + right[i]) / 2
    }

    // Oscilloscope — uses left channel
    if (this.pendingOscilloscopeSamples.length >= MAX_PENDING_CHUNKS) {
      this.pendingOscilloscopeSamples = this.pendingOscilloscopeSamples.slice(
        -Math.floor(MAX_PENDING_CHUNKS / 2)
      )
    }
    this.pendingOscilloscopeSamples.push(new Float32Array(left))

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
      left: new Float32Array(left),
      right: new Float32Array(right),
    })

    // VU Meter — uses stereo
    if (this.pendingVUMeterSamples.length >= MAX_PENDING_VECTORSCOPE_CHUNKS) {
      this.pendingVUMeterSamples = this.pendingVUMeterSamples.slice(
        -Math.floor(MAX_PENDING_VECTORSCOPE_CHUNKS / 2)
      )
    }
    this.pendingVUMeterSamples.push({
      left: new Float32Array(left),
      right: new Float32Array(right),
    })

    // LUFS Meter — uses stereo
    if (this.pendingLUFSMeterSamples.length >= MAX_PENDING_SPECTRUM_CHUNKS) {
      this.pendingLUFSMeterSamples = this.pendingLUFSMeterSamples.slice(
        -Math.floor(MAX_PENDING_SPECTRUM_CHUNKS / 2)
      )
    }
    this.pendingLUFSMeterSamples.push({
      left: new Float32Array(left),
      right: new Float32Array(right),
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

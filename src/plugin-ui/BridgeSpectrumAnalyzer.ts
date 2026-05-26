import type { SpectrumNativeAnalyzer } from '../renderer/audio/native'

const FFT_SILENCE_DB = -100

/**
 * A drop-in `SpectrumNativeAnalyzer` for the plugin webview.
 *
 * In the Electron app, `SpectrumAnalyzer` pushes raw samples into the N-API DSP
 * addon and reads magnitudes back. There is no N-API addon inside a webview, so
 * here the DSP runs in the C++ plugin instead: it computes magnitudes off the
 * realtime thread and pushes them over the JUCE bridge. This shim simply caches
 * the latest pushed magnitudes and serves them through the same interface
 * `SpectrumAnalyzer` already consumes — so the visualizer needs no changes.
 *
 * `pushSamples` / `pushStereoSamples` are intentional no-ops: audio never flows
 * through the webview.
 */
export class BridgeSpectrumAnalyzer implements SpectrumNativeAnalyzer {
  private fftSize = 2048
  private sampleRate = 48000
  private magnitudes: Float32Array

  constructor(fftSize = 2048) {
    this.fftSize = fftSize
    this.magnitudes = new Float32Array(fftSize / 2).fill(FFT_SILENCE_DB)
  }

  /** Called by the bridge whenever the host emits a new frame. */
  setMagnitudes(magnitudes: Float32Array): void {
    if (magnitudes.length !== this.magnitudes.length) {
      this.magnitudes = new Float32Array(magnitudes.length)
    }
    this.magnitudes.set(magnitudes)
  }

  isAvailable(): boolean {
    return true
  }

  setFFTSize(size: number): void {
    if (size > 0 && size !== this.fftSize) {
      this.fftSize = size
      this.magnitudes = new Float32Array(size / 2).fill(FFT_SILENCE_DB)
    }
  }

  getFFTSize(): number {
    return this.fftSize
  }

  setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate
  }

  // Smoothing is applied in the C++ DSP; nothing to do on this side.
  setSmoothing(_smoothing: number): void {}

  pushSamples(_audioData: Float32Array): void {}

  pushStereoSamples(_leftChannel: Float32Array, _rightChannel: Float32Array): void {}

  fillMagnitudes(output: Float32Array): number {
    const count = Math.min(output.length, this.magnitudes.length)
    if (count > 0) {
      output.set(this.magnitudes.subarray(0, count), 0)
    }
    return count
  }

  // The C++ side currently sends a single (already smoothed) magnitude array.
  // Serve it for the raw/side requests too; the heatmap + side-line paths can be
  // wired to dedicated host arrays in a later phase.
  fillRawMagnitudes(output: Float32Array): number {
    return this.fillMagnitudes(output)
  }

  fillSideMagnitudes(output: Float32Array): number {
    const count = Math.min(output.length, this.magnitudes.length)
    output.fill(FFT_SILENCE_DB, 0, count)
    return count
  }

  getMagnitudes(): Float32Array {
    return this.magnitudes
  }

  getRawMagnitudes(): Float32Array {
    return this.magnitudes
  }

  getSideMagnitudes(): Float32Array | null {
    return null
  }

  process(_audioData: Float32Array): Float32Array {
    return this.magnitudes
  }

  binToFrequency(bin: number): number {
    return (bin * this.sampleRate) / this.fftSize
  }

  reset(): void {
    this.magnitudes.fill(FFT_SILENCE_DB)
  }
}

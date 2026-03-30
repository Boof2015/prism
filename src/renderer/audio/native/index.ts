// Native visualizer DSP module loader
// This loads the native C++ addon for high-performance audio visualization

import type { VisualizerDSP, OscilloscopeResult, VectorscopeResult, VectorscopePointsResult } from './visualizer-dsp'

let nativeModule: VisualizerDSP | null = null
let loadError: Error | null = null

// Try to load the native module
// Try to load the native module from the exposed API
if (typeof window !== 'undefined' && window.visualizerAPI) {
  nativeModule = window.visualizerAPI
  console.log('Native visualizer DSP module loaded via preload')
} else {
  console.warn('Native visualizer DSP module not available (not found in window.visualizerAPI)')
  console.warn('Falling back to JavaScript implementation')
  loadError = new Error('Native module not found in window.visualizerAPI')
}

// Check if native module is available
export function isNativeAvailable(): boolean {
  return nativeModule !== null
}

export function getNativeLoadError(): Error | null {
  return loadError
}

// Circular buffer size (must match native code)
export const OSCILLOSCOPE_BUFFER_SIZE = 32768

// Export the native module functions with type safety
export const oscilloscope = {
  setSampleRate: (sampleRate: number): void => {
    nativeModule?.oscilloscope.setSampleRate(sampleRate)
  },

  setPitchLock: (enabled: boolean): void => {
    nativeModule?.oscilloscope.setPitchLock(enabled)
  },

  setDisplaySamples: (samples: number): void => {
    nativeModule?.oscilloscope.setDisplaySamples(samples)
  },

  // Push samples to circular buffer (for continuous capture)
  pushSamples: (samples: Float32Array): void => {
    nativeModule?.oscilloscope.pushSamples(samples)
  },

  // Process using circular buffer (continuous mode)
  processContinuous: (): OscilloscopeResult | null => {
    if (!nativeModule) return null
    return nativeModule.oscilloscope.processContinuous()
  },

  // Legacy: process snapshot (pushes to buffer and processes)
  process: (audioData: Float32Array): OscilloscopeResult | null => {
    if (!nativeModule) return null
    return nativeModule.oscilloscope.process(audioData)
  },

  // Get current write position
  getWritePos: (): number => {
    return nativeModule?.oscilloscope.getWritePos() ?? 0
  },

  fillSamples: (startPos: number, output: Float32Array): number => {
    if (!nativeModule) return 0
    // `visualizerAPI` crosses Electron's context bridge, so mutating a renderer-owned
    // typed array in preload/native does not write back into the caller's buffer.
    const samples = nativeModule.oscilloscope.getSamples(startPos, output.length)
    const count = Math.min(output.length, samples.length)
    if (count > 0) {
      output.set(samples.subarray(0, count), 0)
    }
    return count
  },

  // Get samples from circular buffer for rendering
  getSamples: (startPos: number, count: number): Float32Array | null => {
    if (!nativeModule) return null
    return nativeModule.oscilloscope.getSamples(startPos, count)
  },

  reset: (): void => {
    nativeModule?.oscilloscope.reset()
  }
}

export const spectrum = {
  setFFTSize: (size: number): void => {
    nativeModule?.spectrum.setFFTSize(size)
  },

  getFFTSize: (): number => {
    return nativeModule?.spectrum.getFFTSize() ?? 2048
  },

  setSampleRate: (sampleRate: number): void => {
    nativeModule?.spectrum.setSampleRate(sampleRate)
  },

  setSmoothing: (smoothing: number): void => {
    nativeModule?.spectrum.setSmoothing(smoothing)
  },

  pushSamples: (audioData: Float32Array): void => {
    nativeModule?.spectrum.pushSamples(audioData)
  },

  fillMagnitudes: (output: Float32Array): number => {
    if (!nativeModule) return 0
    const magnitudes = nativeModule.spectrum.getMagnitudes()
    const count = Math.min(output.length, magnitudes.length)
    if (count > 0) {
      output.set(magnitudes.subarray(0, count), 0)
    }
    return count
  },

  getMagnitudes: (): Float32Array | null => {
    if (!nativeModule) return null
    return nativeModule.spectrum.getMagnitudes()
  },

  process: (audioData: Float32Array): Float32Array | null => {
    if (!nativeModule) return null
    return nativeModule.spectrum.process(audioData)
  },

  binToFrequency: (bin: number): number => {
    return nativeModule?.spectrum.binToFrequency(bin) ?? 0
  },

  reset: (): void => {
    nativeModule?.spectrum.reset()
  }
}

export const vectorscope = {
  setSampleRate: (sampleRate: number): void => {
    nativeModule?.vectorscope.setSampleRate(sampleRate)
  },

  pushSamples: (leftChannel: Float32Array, rightChannel: Float32Array): void => {
    nativeModule?.vectorscope.pushSamples(leftChannel, rightChannel)
  },

  fillPoints: (xOut: Float32Array, yOut: Float32Array): number => {
    if (!nativeModule) return 0
    const result = nativeModule.vectorscope.getPoints(Math.min(xOut.length, yOut.length))
    const count = Math.min(xOut.length, yOut.length, result.count, result.x.length, result.y.length)
    if (count > 0) {
      xOut.set(result.x.subarray(0, count), 0)
      yOut.set(result.y.subarray(0, count), 0)
    }
    return count
  },

  getPoints: (maxPoints: number): VectorscopePointsResult | null => {
    if (!nativeModule) return null
    return nativeModule.vectorscope.getPoints(maxPoints)
  },

  setBufferSize: (size: number): void => {
    nativeModule?.vectorscope.setBufferSize(size)
  },

  getBufferSize: (): number => {
    return nativeModule?.vectorscope.getBufferSize() ?? 1024
  },

  process: (leftChannel: Float32Array, rightChannel: Float32Array): VectorscopeResult | null => {
    if (!nativeModule) return null
    return nativeModule.vectorscope.process(leftChannel, rightChannel)
  },

  reset: (): void => {
    nativeModule?.vectorscope.reset()
  }
}

export type { OscilloscopeResult, VectorscopeResult, VectorscopePointsResult }

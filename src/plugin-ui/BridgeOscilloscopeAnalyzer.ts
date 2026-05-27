import type { OscilloscopeNativeAnalyzer, OscilloscopeResult } from '../renderer/audio/native'

/**
 * Drop-in `OscilloscopeNativeAnalyzer` for the plugin webview.
 *
 * The oscilloscope DSP (circular buffer + trigger detection) runs in the C++
 * plugin, which pushes the finished, already-triggered display window each frame.
 * This shim serves that window through the interface `Oscilloscope` consumes, so
 * the visualizer renders it unchanged. `pushSamples` is a no-op (audio never
 * flows through the webview); `processContinuous` reports the window at index 0.
 */
export class BridgeOscilloscopeAnalyzer implements OscilloscopeNativeAnalyzer {
  private samples = new Float32Array(0)
  private pitch = 0

  /** Called by the bridge whenever the host emits a new oscilloscope frame. */
  setSamples(samples: Float32Array, pitch: number): void {
    if (samples.length !== this.samples.length) {
      this.samples = new Float32Array(samples.length)
    }
    this.samples.set(samples)
    this.pitch = pitch
  }

  isAvailable(): boolean {
    return true
  }

  setSampleRate(_sampleRate: number): void {}
  setPitchLock(_enabled: boolean): void {}
  setDisplaySamples(_samples: number): void {}
  pushSamples(_samples: Float32Array): void {}

  processContinuous(): OscilloscopeResult {
    const count = this.samples.length
    // C++ already applied the trigger, so the window starts at index 0.
    return { triggerIndex: 0, samplesToShow: count, detectedPitch: this.pitch, writePos: count }
  }

  fillSamples(_startPos: number, output: Float32Array): number {
    const count = Math.min(output.length, this.samples.length)
    if (count > 0) {
      output.set(this.samples.subarray(0, count), 0)
    }
    return count
  }

  reset(): void {
    this.samples = new Float32Array(0)
    this.pitch = 0
  }
}

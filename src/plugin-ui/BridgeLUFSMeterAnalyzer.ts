import type { LUFSMeterNativeAnalyzer, LUFSMeterNativeSnapshot } from '../renderer/audio/native'

/**
 * Drop-in `LUFSMeterNativeAnalyzer` for the plugin webview.
 *
 * The loudness DSP (K-weighting, gated integration, fast VU/peak/correlation) runs
 * in the C++ plugin, which pushes a finished scalar snapshot each frame. This shim
 * caches that snapshot and serves it through the interface `LUFSMeter` consumes.
 * `pushSamples` is a no-op (audio never flows through the webview); `reset` clears
 * only the cache (the C++ integrator keeps its own state).
 */
export class BridgeLUFSMeterAnalyzer implements LUFSMeterNativeAnalyzer {
  private snapshot: LUFSMeterNativeSnapshot | null = null

  /** Called by the bridge whenever the host emits a new LUFS frame. */
  setSnapshot(snapshot: LUFSMeterNativeSnapshot): void {
    this.snapshot = snapshot
  }

  isAvailable(): boolean {
    return true
  }

  setSampleRate(_sampleRate: number): void {}
  pushSamples(_left: Float32Array, _right: Float32Array): void {}

  getSnapshot(): LUFSMeterNativeSnapshot | null {
    return this.snapshot
  }

  reset(): void {
    this.snapshot = null
  }
}

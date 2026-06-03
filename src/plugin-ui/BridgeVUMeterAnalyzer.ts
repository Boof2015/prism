import type { VUMeterNativeAnalyzer, VUMeterNativeSnapshot } from '../renderer/audio/native'

/**
 * Drop-in `VUMeterNativeAnalyzer` for the plugin webview.
 *
 * The VU DSP (RMS integration, ballistics, peak hold, correlation) runs in the
 * C++ plugin, which pushes a finished scalar snapshot each frame. This shim caches
 * that snapshot and serves it through the interface `VUMeter` consumes, so the
 * visualizer renders it unchanged. `pushSamples` is a no-op (audio never flows
 * through the webview).
 */
export class BridgeVUMeterAnalyzer implements VUMeterNativeAnalyzer {
  private snapshot: VUMeterNativeSnapshot | null = null

  /** Called by the bridge whenever the host emits a new VU frame. */
  setSnapshot(snapshot: VUMeterNativeSnapshot): void {
    this.snapshot = snapshot
  }

  isAvailable(): boolean {
    return true
  }

  setSampleRate(_sampleRate: number): void {}
  pushSamples(_left: Float32Array, _right: Float32Array): void {}

  getSnapshot(): VUMeterNativeSnapshot | null {
    return this.snapshot
  }

  reset(): void {
    this.snapshot = null
  }
}

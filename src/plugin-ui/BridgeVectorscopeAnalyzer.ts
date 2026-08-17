import type { VectorscopeNativeAnalyzer, VectorscopeMultibandPointsResult } from '../renderer/audio/native'

/**
 * Drop-in `VectorscopeNativeAnalyzer` for the plugin webview.
 *
 * The vectorscope DSP (full-band channels + 3-band split, circular buffers) runs in
 * the C++ plugin, which pushes the most recent display points each frame — either
 * a standard X/Y cloud or a multiband (6 floats/point: lowL,lowR,midL,midR,highL,
 * highR) cloud, depending on the active mode. This shim caches whichever arrived
 * and serves it through the two readout methods `Vectorscope` consumes. The push
 * methods are no-ops (audio never flows through the webview).
 */
export class BridgeVectorscopeAnalyzer implements VectorscopeNativeAnalyzer {
  private x: Float32Array = new Float32Array(0)
  private y: Float32Array = new Float32Array(0)
  private count = 0
  private mbData: Float32Array = new Float32Array(0)
  private mbCount = 0

  /** Standard X/Y point cloud from the host. */
  setStandard(x: Float32Array, y: Float32Array, count: number): void {
    this.x = x
    this.y = y
    this.count = count
  }

  /** Multiband point cloud from the host (flat, 6 floats per point). */
  setMultiband(data: Float32Array, count: number): void {
    this.mbData = data
    this.mbCount = count
  }

  isAvailable(): boolean {
    return true
  }

  isMultibandAvailable(): boolean {
    return true
  }

  setSampleRate(_sampleRate: number): void {}
  pushSamples(_left: Float32Array, _right: Float32Array): void {}
  pushMultibandSamples(_left: Float32Array, _right: Float32Array): void {}

  fillPoints(xOut: Float32Array, yOut: Float32Array): number {
    const count = Math.min(xOut.length, yOut.length, this.count, this.x.length, this.y.length)
    if (count > 0) {
      xOut.set(this.x.subarray(0, count), 0)
      yOut.set(this.y.subarray(0, count), 0)
    }
    return count
  }

  getMultibandPoints(maxPoints: number): VectorscopeMultibandPointsResult {
    const count = Math.min(maxPoints, this.mbCount, Math.floor(this.mbData.length / 6))
    return { data: this.mbData, count }
  }

  reset(): void {
    this.x = new Float32Array(0)
    this.y = new Float32Array(0)
    this.count = 0
    this.mbData = new Float32Array(0)
    this.mbCount = 0
  }
}

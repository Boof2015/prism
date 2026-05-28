import type { WaveformNativeAnalyzer } from '../renderer/audio/native'

interface QueuedColumns {
  summaries: Float32Array
  stereo: boolean
}

// The C++ engine emits columns every vblank (audio-driven), independently of how
// fast the webview renders them. Cap the backlog so an overloaded consumer drops the
// OLDEST columns rather than accumulating unbounded latency (which death-spirals into
// stutter at high scroll speeds). One entry == one emitted frame.
const MAX_QUEUED_FRAMES = 8

/**
 * Drop-in `WaveformNativeAnalyzer` for the plugin webview.
 *
 * The waveform DSP (per-column min/max + 3-band RMS) runs in the C++ plugin, which
 * pushes finished column summaries each frame — stride 10 in stereo mode, stride 5
 * in mono. This shim queues them and serves whichever the visualizer asks for:
 * `processStereo`/`processMono` return the queued summaries matching that mode and
 * clear the queue (so a mode switch never returns mismatched-stride data, and the
 * queue can't grow unbounded). `configure` is a no-op — the engine derives
 * samplesPerColumn itself from the host sample rate + scroll speed.
 */
export class BridgeWaveformAnalyzer implements WaveformNativeAnalyzer {
  private queue: QueuedColumns[] = []

  /** Called by the bridge when the host emits a waveform frame. */
  pushFrame(summaries: Float32Array, stereo: boolean): void {
    if (summaries.length === 0) return
    this.queue.push({ summaries, stereo })
    // Drop oldest backlog beyond the cap so we stay near real-time under overload.
    while (this.queue.length > MAX_QUEUED_FRAMES) {
      this.queue.shift()
    }
  }

  isAvailable(): boolean {
    return true
  }

  configure(_sampleRate: number, _samplesPerColumn: number): void {}

  processMono(_samples: Float32Array): Float32Array | null {
    return this.drain(false)
  }

  processStereo(_left: Float32Array, _right: Float32Array): Float32Array | null {
    return this.drain(true)
  }

  reset(): void {
    this.queue = []
  }

  private drain(stereo: boolean): Float32Array {
    const matching = this.queue.filter((entry) => entry.stereo === stereo)
    this.queue = []
    if (matching.length === 0) return new Float32Array(0)
    if (matching.length === 1) return matching[0].summaries

    let total = 0
    for (const entry of matching) total += entry.summaries.length
    const out = new Float32Array(total)
    let offset = 0
    for (const entry of matching) {
      out.set(entry.summaries, offset)
      offset += entry.summaries.length
    }
    return out
  }
}

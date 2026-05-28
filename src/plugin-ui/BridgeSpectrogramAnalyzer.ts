import type { SpectrogramNativeAnalyzer, SpectrogramNativeOptions, SpectrogramNativeResult } from '../renderer/audio/native'
import { emitToHost } from './juceBridge'

const EMPTY = new Float32Array(0)

// The C++ engine emits columns every vblank (audio-driven), independently of how
// fast the webview can render them. Cap the backlog so that when the consumer falls
// behind we drop the OLDEST columns instead of accumulating unbounded latency (which
// otherwise death-spirals into stutter at high scroll speeds). One entry == one
// emitted frame, so this bounds latency to ~N display frames regardless of rate.
const MAX_QUEUED_FRAMES = 8

interface QueuedColumns {
  display: Float32Array
  heat: Float32Array
  columnCount: number
}

/**
 * Drop-in `SpectrogramNativeAnalyzer` for the plugin webview.
 *
 * The spectrogram DSP runs in the C++ plugin, but its output depends on the
 * canvas-derived `rowCount` that only the UI knows. So this shim works in two
 * directions: `configure()` forwards the full native config to C++ (event
 * "prismSpectrogramConfig"), and the host streams finished display+heat columns
 * back which the bridge enqueues via `pushFrame()`. `process()` ignores its audio
 * argument (no samples flow through the webview) and returns all columns queued
 * since the last call, concatenated into one result.
 *
 * Columns are only kept while their rowCount matches the rowCount the UI last
 * asked for — on a resize the UI reconfigures, we drop the stale queue, and the
 * C++ side catches up within a frame or two (a brief gap, never a mismatch).
 */
export class BridgeSpectrogramAnalyzer implements SpectrogramNativeAnalyzer {
  private expectedRowCount = 0
  private queue: QueuedColumns[] = []
  private queuedColumns = 0

  configure(options: SpectrogramNativeOptions): void {
    if (options.rowCount !== this.expectedRowCount) {
      this.expectedRowCount = options.rowCount
      this.clearQueue()
    }
    emitToHost('prismSpectrogramConfig', options)
  }

  /** Called by the bridge when the host emits a spectrogram frame. */
  pushFrame(display: Float32Array, heat: Float32Array, columnCount: number, rowCount: number): void {
    if (rowCount !== this.expectedRowCount || columnCount <= 0) return
    if (display.length < columnCount * rowCount || heat.length < columnCount * rowCount) return
    this.queue.push({ display, heat, columnCount })
    this.queuedColumns += columnCount
    // Drop oldest backlog beyond the cap so we stay near real-time under overload.
    while (this.queue.length > MAX_QUEUED_FRAMES) {
      const dropped = this.queue.shift()
      if (dropped) this.queuedColumns -= dropped.columnCount
    }
  }

  /** The rowCount the UI last asked for (0 until first configure). */
  getExpectedRowCount(): number {
    return this.expectedRowCount
  }

  isAvailable(): boolean {
    return true
  }

  process(_audioData: Float32Array): SpectrogramNativeResult {
    const rowCount = this.expectedRowCount
    if (this.queuedColumns === 0 || rowCount <= 0) {
      return { display: EMPTY, heat: EMPTY, columnCount: 0, rowCount }
    }

    const total = this.queuedColumns * rowCount
    const display = new Float32Array(total)
    const heat = new Float32Array(total)
    let offset = 0
    for (const entry of this.queue) {
      display.set(entry.display, offset)
      heat.set(entry.heat, offset)
      offset += entry.display.length
    }

    const columnCount = this.queuedColumns
    this.clearQueue()
    return { display, heat, columnCount, rowCount }
  }

  reset(): void {
    this.clearQueue()
  }

  private clearQueue(): void {
    this.queue = []
    this.queuedColumns = 0
  }
}

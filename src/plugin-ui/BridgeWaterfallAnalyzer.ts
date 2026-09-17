import type { WaterfallFrame, WaterfallNativeAnalyzer, WaterfallNativeConfig } from '../types/waterfall'
import { DEFAULT_WATERFALL_SETTINGS } from '../types/waterfall'
import { emitToHost, type WaterfallPluginFrame } from './juceBridge'

export interface WaterfallFrameRequest {
  revision: number
  ridges: number
  columns: number
  config: WaterfallNativeConfig
}

/** Native history stays in the plugin; the webview retains only its latest plot. */
export class BridgeWaterfallAnalyzer implements WaterfallNativeAnalyzer {
  private revision = 0
  private ridges = 32
  private columns = 256
  private config: WaterfallNativeConfig = {
    ...DEFAULT_WATERFALL_SETTINGS, sampleRate: 48000, minFrequency: 10, maxFrequency: 24000,
  }
  private frame: WaterfallFrame | null = null

  constructor(private readonly send = (payload: unknown): void => emitToHost('prismWaterfallConfig', payload)) {}

  configure(config: WaterfallNativeConfig): void {
    this.config = { ...config }
    this.send({ revision: ++this.revision, config: this.config })
  }

  processStereo(_left: Float32Array, _right: Float32Array): void {}
  isAvailable(): boolean { return true }

  pushFrame(frame: WaterfallPluginFrame): void {
    // Ignore in-flight responses to earlier settings, viewport sizes or resets.
    if (frame.revision === this.revision) this.frame = frame
  }

  getFrame(ridges: number, columns: number): WaterfallFrame {
    const nextRidges = Math.max(2, Math.min(64, Math.round(ridges)))
    const nextColumns = Math.max(2, Math.min(512, Math.round(columns)))
    if (nextRidges !== this.ridges || nextColumns !== this.columns) {
      this.ridges = nextRidges
      this.columns = nextColumns
      this.send({ revision: ++this.revision, ridges: this.ridges, columns: this.columns })
    }
    // Retain the previous plot during a resize, including while audio is held.
    return this.frame ?? {
      columns: this.columns, audioSeconds: 0,
      levels: new Float32Array(0), ages: new Float32Array(0), frequencies: new Float32Array(0),
    }
  }

  reset(): void {
    this.frame = null
    this.send({ revision: ++this.revision, reset: true })
  }

  getRequest(): WaterfallFrameRequest {
    return { revision: this.revision, ridges: this.ridges, columns: this.columns, config: { ...this.config } }
  }
}

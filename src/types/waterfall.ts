import { normalizeFrequencyRangeMode, normalizeFrequencyScaleMode, type FrequencyRangeMode, type FrequencyScaleMode } from './frequencyScale'
import { clampSpectrumTiltDbPerOctave } from './spectrum'

export type WaterfallDensity = 'sparse' | 'balanced' | 'dense'
export interface WaterfallSettings {
  historySeconds: number
  density: WaterfallDensity
  colorMode: 'theme' | 'heat'
  showGrid: boolean
  fftSize: number
  scaleMode: FrequencyScaleMode
  frequencyRangeMode: FrequencyRangeMode
  smoothing: number
  tiltDbPerOctave: number
}
export const WATERFALL_RIDGES: Record<WaterfallDensity, number> = { sparse: 16, balanced: 32, dense: 64 }
export const DEFAULT_WATERFALL_SETTINGS: WaterfallSettings = {
  historySeconds: 5, density: 'balanced', colorMode: 'theme', showGrid: true,
  fftSize: 2048, scaleMode: 'log', frequencyRangeMode: 'extended', smoothing: 0.9, tiltDbPerOctave: 2,
}
export function normalizeWaterfallSettings(raw: unknown): WaterfallSettings {
  const value = raw && typeof raw === 'object' ? raw as Partial<WaterfallSettings> : {}
  const numeric = (input: unknown, fallback: number): number => typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return {
    historySeconds: Math.max(1, Math.min(30, Math.round(numeric(value.historySeconds, 5)))),
    density: value.density === 'sparse' || value.density === 'dense' ? value.density : 'balanced',
    colorMode: value.colorMode === 'heat' ? 'heat' : 'theme',
    showGrid: typeof value.showGrid === 'boolean' ? value.showGrid : true,
    fftSize: [1024, 2048, 4096, 8192, 16384].includes(value.fftSize as number) ? value.fftSize! : 2048,
    scaleMode: normalizeFrequencyScaleMode(value.scaleMode),
    frequencyRangeMode: normalizeFrequencyRangeMode(value.frequencyRangeMode),
    smoothing: Math.max(0, Math.min(0.99, numeric(value.smoothing, 0.9))),
    tiltDbPerOctave: clampSpectrumTiltDbPerOctave(value.tiltDbPerOctave ?? 2),
  }
}

export interface WaterfallNativeConfig extends Pick<WaterfallSettings, 'fftSize' | 'historySeconds' | 'smoothing' | 'tiltDbPerOctave' | 'scaleMode'> {
  sampleRate: number
  minFrequency: number
  maxFrequency: number
}
export interface WaterfallFrame {
  levels: Float32Array
  ages: Float32Array
  frequencies: Float32Array
  columns: number
  audioSeconds: number
}
export interface WaterfallNativeAnalyzer {
  configure(options: WaterfallNativeConfig): void
  processStereo(left: Float32Array, right: Float32Array): void
  getFrame(ridges: number, columns: number): WaterfallFrame | null
  reset(): void
  isAvailable?: () => boolean
}
export interface WaterfallAudioChunk {
  left: Float32Array
  right: Float32Array
  sequence?: number
}

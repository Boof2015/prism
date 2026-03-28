import type { VectorscopeMode } from '../renderer/visualizers/Vectorscope'
import type { SpectrogramClarityMode, SpectrogramScaleMode } from './spectrogram'
import type { VUMeterMode, VUMeterOrientation } from './vumeter'
import type { LUFSMeterMode } from './lufsmeter'

export interface ScopeSettings {
  spectrum: {
    fftSize: number
    tiltDbPerOctave: number
    heatmap: boolean
    heatmapTiltDbPerOctave: number
    showGrid: boolean
    smoothing: number
    fillGradient: boolean
  }
  oscilloscope: {
    pitchLock: boolean
    underfillEnabled: boolean
    showGrid: boolean
    lineWidth: number
  }
  vectorscope: {
    mode: VectorscopeMode
    multiband: boolean
    showGrid: boolean
    persistence: number
    lineWidth: number
  }
  spectrogram: {
    fftSize: number
    scrollSpeed: number
    clarityMode: SpectrogramClarityMode
    scaleMode: SpectrogramScaleMode
    colorScheme: 'heat' | 'mono'
  }
  vumeter: {
    mode: VUMeterMode
    orientation: VUMeterOrientation
  }
  lufsmeter: {
    mode: LUFSMeterMode
  }
  waveform: {
    scrollSpeed: number
    gainDb: number
    multiband: boolean
  }
}

export const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  spectrum: { fftSize: 2048, tiltDbPerOctave: 2.0, heatmap: false, heatmapTiltDbPerOctave: 2.0, showGrid: true, smoothing: 0.9, fillGradient: true },
  oscilloscope: { pitchLock: true, underfillEnabled: false, showGrid: true, lineWidth: 2 },
  vectorscope: { mode: 'lissajous', multiband: false, showGrid: true, persistence: 0.10, lineWidth: 1.5 },
  spectrogram: { fftSize: 2048, scrollSpeed: 2, clarityMode: 'sharper', scaleMode: 'log', colorScheme: 'heat' },
  vumeter: { mode: 'bar', orientation: 'horizontal' },
  lufsmeter: { mode: 'bar' },
  waveform: { scrollSpeed: 1, gainDb: 0, multiband: false },
}

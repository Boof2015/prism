import type { VectorscopeMode } from '../renderer/visualizers/Vectorscope'
import type { SpectrogramClarityMode, SpectrogramScaleMode } from './spectrogram'
import type { VUMeterMode, VUMeterNeedleChannels, VUMeterOrientation } from './vumeter'
import { DEFAULT_LUFS_METER_READOUT, type LUFSMeterMode, type LUFSMeterReadout } from './lufsmeter'
import { DEFAULT_WAVEFORM_MODE, type WaveformMode } from './waveform'
import { DEFAULT_SPECTRUM_PEAK_INFO_MODE, type SpectrumPeakInfoMode } from './spectrum'

export interface ScopeSettings {
  spectrum: {
    fftSize: number
    tiltDbPerOctave: number
    heatmap: boolean
    heatmapTiltDbPerOctave: number
    heatmapSmoothing: number
    showGrid: boolean
    smoothing: number
    fillGradient: boolean
    showSideLine: boolean
    peakInfoMode: SpectrumPeakInfoMode
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
    needleChannels: VUMeterNeedleChannels
  }
  lufsmeter: {
    mode: LUFSMeterMode
    readout: LUFSMeterReadout
  }
  waveform: {
    mode: WaveformMode
    scrollSpeed: number
    multiband: boolean
  }
  nowPlaying: {
    showCoverArt: boolean
    showTitle: boolean
    showArtist: boolean
    showProgress: boolean
    showTime: boolean
    showControls: boolean
  }
}

export const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  spectrum: { fftSize: 2048, tiltDbPerOctave: 2.0, heatmap: false, heatmapTiltDbPerOctave: 2.0, heatmapSmoothing: 0.5, showGrid: true, smoothing: 0.9, fillGradient: true, showSideLine: false, peakInfoMode: DEFAULT_SPECTRUM_PEAK_INFO_MODE },
  oscilloscope: { pitchLock: true, underfillEnabled: false, showGrid: true, lineWidth: 2 },
  vectorscope: { mode: 'lissajous', multiband: false, showGrid: true, persistence: 0.10, lineWidth: 1.5 },
  spectrogram: { fftSize: 2048, scrollSpeed: 2, clarityMode: 'sharper', scaleMode: 'log', colorScheme: 'heat' },
  vumeter: { mode: 'bar', orientation: 'horizontal', needleChannels: 'stereo' },
  lufsmeter: { mode: 'bar', readout: DEFAULT_LUFS_METER_READOUT },
  waveform: { mode: DEFAULT_WAVEFORM_MODE, scrollSpeed: 1, multiband: false },
  nowPlaying: {
    showCoverArt: true,
    showTitle: true,
    showArtist: true,
    showProgress: true,
    showTime: true,
    showControls: true,
  },
}

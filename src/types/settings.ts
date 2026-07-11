import type { VectorscopeMode } from '../renderer/visualizers/Vectorscope'
import {
  DEFAULT_SPECTROGRAM_CONTRAST,
  DEFAULT_SPECTROGRAM_TILT_DB_PER_OCTAVE,
  type SpectrogramClarityMode,
  type SpectrogramScaleMode,
} from './spectrogram'
import { DEFAULT_VU_REFERENCE_DBFS, type VUMeterMode, type VUMeterNeedleChannels, type VUMeterOrientation } from './vumeter'
import { DEFAULT_LUFS_METER_READOUT, type LUFSMeterMode, type LUFSMeterReadout } from './lufsmeter'
import { DEFAULT_WAVEFORM_MODE, DEFAULT_WAVEFORM_SCROLL_SPEED, type WaveformMode } from './waveform'
import { DEFAULT_SPECTRUM_PEAK_INFO_MODE, type SpectrumPeakInfoMode } from './spectrum'
import {
  DEFAULT_SCOPE_DISPLAY_ROTATION,
  DEFAULT_SCOPE_MIRROR_HORIZONTAL,
  type ScopeDisplayTransformSettings,
} from './scopeTransform'

export interface ScopeSettings {
  spectrum: ScopeDisplayTransformSettings & {
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
  oscilloscope: ScopeDisplayTransformSettings & {
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
  spectrogram: ScopeDisplayTransformSettings & {
    fftSize: number
    tiltDbPerOctave: number
    scrollSpeed: number
    contrast: number
    clarityMode: SpectrogramClarityMode
    scaleMode: SpectrogramScaleMode
    colorScheme: 'heat' | 'mono'
  }
  vumeter: {
    mode: VUMeterMode
    orientation: VUMeterOrientation
    needleChannels: VUMeterNeedleChannels
    referenceDb: number
  }
  lufsmeter: {
    mode: LUFSMeterMode
    readout: LUFSMeterReadout
  }
  waveform: ScopeDisplayTransformSettings & {
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
  spectrum: { rotation: DEFAULT_SCOPE_DISPLAY_ROTATION, mirrorHorizontal: DEFAULT_SCOPE_MIRROR_HORIZONTAL, fftSize: 2048, tiltDbPerOctave: 2.0, heatmap: false, heatmapTiltDbPerOctave: 2.0, heatmapSmoothing: 0.5, showGrid: true, smoothing: 0.9, fillGradient: true, showSideLine: false, peakInfoMode: DEFAULT_SPECTRUM_PEAK_INFO_MODE },
  oscilloscope: { rotation: DEFAULT_SCOPE_DISPLAY_ROTATION, mirrorHorizontal: DEFAULT_SCOPE_MIRROR_HORIZONTAL, pitchLock: true, underfillEnabled: false, showGrid: true, lineWidth: 2 },
  vectorscope: { mode: 'lissajous', multiband: false, showGrid: true, persistence: 0.10, lineWidth: 1.5 },
  spectrogram: { rotation: DEFAULT_SCOPE_DISPLAY_ROTATION, mirrorHorizontal: DEFAULT_SCOPE_MIRROR_HORIZONTAL, fftSize: 4096, tiltDbPerOctave: DEFAULT_SPECTROGRAM_TILT_DB_PER_OCTAVE, scrollSpeed: 2, contrast: DEFAULT_SPECTROGRAM_CONTRAST, clarityMode: 'sharper', scaleMode: 'log', colorScheme: 'heat' },
  vumeter: { mode: 'bar', orientation: 'horizontal', needleChannels: 'stereo', referenceDb: DEFAULT_VU_REFERENCE_DBFS },
  lufsmeter: { mode: 'bar', readout: DEFAULT_LUFS_METER_READOUT },
  waveform: { rotation: DEFAULT_SCOPE_DISPLAY_ROTATION, mirrorHorizontal: DEFAULT_SCOPE_MIRROR_HORIZONTAL, mode: DEFAULT_WAVEFORM_MODE, scrollSpeed: DEFAULT_WAVEFORM_SCROLL_SPEED, multiband: false },
  nowPlaying: {
    showCoverArt: true,
    showTitle: true,
    showArtist: true,
    showProgress: true,
    showTime: true,
    showControls: true,
  },
}

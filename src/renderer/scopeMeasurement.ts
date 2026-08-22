import type { ScopeDisplayRotation } from '../types/scopeTransform'
import {
  formatSpectrumPitchInfo,
  resolveSpectrumPitchInfo,
} from '../types/spectrum'
import type { SpectrogramScaleMode } from '../types/spectrogram'
import {
  clampFrequencyRangeToNyquist,
  frequencyAtNormalizedPosition,
  normalizedPositionAtFrequency,
  type FrequencyScaleMode,
} from '../types/frequencyScale'
import type { WaveformMode } from '../types/waveform'
import type {
  LinkedAnalysisProbe,
  LinkedAnalysisProjection,
  ScopeMeasurementDimensions,
} from '../types/analysis'
import {
  inverseTransformNormalizedScopePoint,
  type NormalizedScopePoint,
} from './scopeCanvasTransform'

export type MeasurableScopeKind = 'spectrum' | 'spectrogram' | 'oscilloscope' | 'waveform'

export interface ScopeMeasurement {
  values: string[]
  dimensions: ScopeMeasurementDimensions
}

export interface ScopeMeasurementSource {
  getMeasurementAt(point: NormalizedScopePoint): ScopeMeasurement
  setMeasurementActive?(active: boolean): void
}

export interface ActiveScopeMeasurement {
  pointerId: number
  viewportPoint: NormalizedScopePoint
  sourcePoint: NormalizedScopePoint
  measurement: ScopeMeasurement
}

export const SPECTRUM_MEASUREMENT_SMOOTHING = 0.97
export const WAVEFORM_BASE_PIXELS_PER_SECOND = 128
export const WAVEFORM_DISPLAY_MARGIN = 0.95

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export { frequencyAtNormalizedPosition } from '../types/frequencyScale'

export function formatMeasurementFrequency(frequencyHz: number): string {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return '--'
  return frequencyHz >= 1000
    ? `${(frequencyHz / 1000).toFixed(2)}kHz`
    : `${frequencyHz.toFixed(2)}Hz`
}

export function formatMeasurementPitch(frequencyHz: number): string {
  return formatSpectrumPitchInfo(resolveSpectrumPitchInfo(frequencyHz))
}

export function formatMeasurementDb(value: number, suffix = 'dB'): string {
  if (value === Number.NEGATIVE_INFINITY) return `-∞${suffix}`
  if (!Number.isFinite(value)) return `--${suffix}`
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
}

export function amplitudeToDbfs(amplitude: number): number {
  const magnitude = Math.abs(amplitude)
  return magnitude > 0 ? 20 * Math.log10(magnitude) : Number.NEGATIVE_INFINITY
}

export function formatMeasurementAmplitude(amplitude: number): string {
  if (!Number.isFinite(amplitude)) return '--'
  return `${amplitude >= 0 ? '+' : ''}${amplitude.toFixed(3)}`
}

export function formatMeasurementTime(seconds: number, historical = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  const suffix = historical ? ' ago' : ''
  if (seconds < 1) {
    return `${(seconds * 1000).toFixed(2)}ms${suffix}`
  }
  return `${seconds.toFixed(2)}s${suffix}`
}

export function resolveSpectrumMeasurement(
  point: NormalizedScopePoint,
  options: {
    sampleRate: number
    minFrequency: number
    maxFrequency: number
    minDecibels: number
    maxDecibels: number
    scaleType: FrequencyScaleMode
  },
): ScopeMeasurement {
  const range = clampFrequencyRangeToNyquist(options.sampleRate, options.minFrequency, options.maxFrequency)
  const frequencyHz = frequencyAtNormalizedPosition(
    point.x,
    range.minFrequency,
    range.maxFrequency,
    options.scaleType,
  )
  const db = options.maxDecibels - clamp01(point.y) * (options.maxDecibels - options.minDecibels)
  return {
    values: [
      formatMeasurementDb(db),
      formatMeasurementFrequency(frequencyHz),
      formatMeasurementPitch(frequencyHz),
    ],
    dimensions: {
      frequencyHz,
      spectralLevelDb: db,
    },
  }
}

export function resolveSpectrogramMeasurement(
  point: NormalizedScopePoint,
  options: {
    sampleRate: number
    minFrequency: number
    maxFrequency: number
    scaleMode: SpectrogramScaleMode
    fftSize: number
    scrollSpeed: number
    canvasPixelWidth: number
  },
): ScopeMeasurement {
  const range = clampFrequencyRangeToNyquist(options.sampleRate, options.minFrequency, options.maxFrequency)
  const frequencyHz = frequencyAtNormalizedPosition(
    1 - point.y,
    range.minFrequency,
    range.maxFrequency,
    options.scaleMode,
  )
  const hopDivisor = Math.max(2, Math.min(64, Math.round(8 * options.scrollSpeed)))
  const hopSize = Math.max(1, Math.floor(options.fftSize / hopDivisor))
  const pixelsAgo = (1 - clamp01(point.x)) * Math.max(0, options.canvasPixelWidth - 1)
  const secondsAgo = (pixelsAgo * hopSize) / Math.max(1, options.sampleRate)
  return {
    values: [
      formatMeasurementTime(secondsAgo, true),
      formatMeasurementFrequency(frequencyHz),
      formatMeasurementPitch(frequencyHz),
    ],
    dimensions: {
      frequencyHz,
      historySecondsAgo: secondsAgo,
    },
  }
}

export function resolveOscilloscopeMeasurement(
  point: NormalizedScopePoint,
  sampleRate: number,
  displaySamples: number,
): ScopeMeasurement {
  const timeSeconds = clamp01(point.x) * Math.max(0, displaySamples - 1) / Math.max(1, sampleRate)
  const amplitude = 1 - 2 * clamp01(point.y)
  return {
    values: [
      formatMeasurementTime(timeSeconds),
      formatMeasurementAmplitude(amplitude),
      formatMeasurementDb(amplitudeToDbfs(amplitude), 'dBFS'),
    ],
    dimensions: {
      frameTimeSeconds: timeSeconds,
      signedAmplitude: amplitude,
    },
  }
}

export function resolveWaveformMeasurement(
  point: NormalizedScopePoint,
  options: {
    mode: WaveformMode
    scrollSpeed: number
    canvasPixelWidth: number
  },
): ScopeMeasurement {
  const x = clamp01(point.x)
  const y = clamp01(point.y)
  const pixelsAgo = (1 - x) * Math.max(0, options.canvasPixelWidth - 1)
  const secondsAgo = pixelsAgo / (WAVEFORM_BASE_PIXELS_PER_SECOND * Math.max(0.01, options.scrollSpeed))
  const stereo = options.mode === 'stereo'
  const channel = stereo ? (y < 0.5 ? 'L' : 'R') : null
  const laneY = stereo ? (y < 0.5 ? y * 2 : (y - 0.5) * 2) : y
  const amplitude = (0.5 - laneY) / (0.5 * WAVEFORM_DISPLAY_MARGIN)
  const values = [
    formatMeasurementTime(secondsAgo, true),
    formatMeasurementAmplitude(amplitude),
    formatMeasurementDb(amplitudeToDbfs(amplitude), 'dBFS'),
  ]
  if (channel) values.unshift(channel)
  return {
    values,
    dimensions: {
      historySecondsAgo: secondsAgo,
      signedAmplitude: amplitude,
      ...(channel ? { channel } : {}),
    },
  }
}

function isWithinInclusiveRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

function verticalGuide(x: number): LinkedAnalysisProjection['guides'][number] {
  return { from: { x, y: 0 }, to: { x, y: 1 } }
}

function horizontalGuide(y: number): LinkedAnalysisProjection['guides'][number] {
  return { from: { x: 0, y }, to: { x: 1, y } }
}

export function resolveSpectrumLinkedAnalysisProjection(
  probe: LinkedAnalysisProbe,
  options: {
    sampleRate: number
    minFrequency: number
    maxFrequency: number
    scaleType: FrequencyScaleMode
  },
): LinkedAnalysisProjection | null {
  if (probe.sourceKind !== 'spectrogram') return null
  const frequencyHz = probe.dimensions.frequencyHz
  if (frequencyHz === undefined) return null
  const range = clampFrequencyRangeToNyquist(options.sampleRate, options.minFrequency, options.maxFrequency)
  if (!isWithinInclusiveRange(frequencyHz, range.minFrequency, range.maxFrequency)) return null

  return {
    guides: [verticalGuide(normalizedPositionAtFrequency(
      frequencyHz,
      range.minFrequency,
      range.maxFrequency,
      options.scaleType,
    ))],
    label: formatMeasurementFrequency(frequencyHz),
  }
}

export function resolveSpectrogramLinkedAnalysisProjection(
  probe: LinkedAnalysisProbe,
  options: {
    sampleRate: number
    minFrequency: number
    maxFrequency: number
    scaleMode: SpectrogramScaleMode
    fftSize: number
    scrollSpeed: number
    canvasPixelWidth: number
  },
): LinkedAnalysisProjection | null {
  if (probe.sourceKind === 'spectrum') {
    const frequencyHz = probe.dimensions.frequencyHz
    if (frequencyHz === undefined) return null
    const range = clampFrequencyRangeToNyquist(options.sampleRate, options.minFrequency, options.maxFrequency)
    if (!isWithinInclusiveRange(frequencyHz, range.minFrequency, range.maxFrequency)) return null
    const normalizedFrequency = normalizedPositionAtFrequency(
      frequencyHz,
      range.minFrequency,
      range.maxFrequency,
      options.scaleMode,
    )
    return {
      guides: [horizontalGuide(1 - normalizedFrequency)],
      label: formatMeasurementFrequency(frequencyHz),
    }
  }

  if (probe.sourceKind !== 'waveform') return null
  const secondsAgo = probe.dimensions.historySecondsAgo
  if (secondsAgo === undefined) return null
  const hopDivisor = Math.max(2, Math.min(64, Math.round(8 * options.scrollSpeed)))
  const hopSize = Math.max(1, Math.floor(options.fftSize / hopDivisor))
  const maxHistorySeconds = (Math.max(0, options.canvasPixelWidth - 1) * hopSize)
    / Math.max(1, options.sampleRate)
  if (!isWithinInclusiveRange(secondsAgo, 0, maxHistorySeconds) || maxHistorySeconds <= 0) return null
  return {
    guides: [verticalGuide(1 - secondsAgo / maxHistorySeconds)],
    label: formatMeasurementTime(secondsAgo, true),
  }
}

export function resolveOscilloscopeLinkedAnalysisProjection(
  probe: LinkedAnalysisProbe,
): LinkedAnalysisProjection | null {
  if (probe.sourceKind !== 'waveform') return null
  const amplitude = probe.dimensions.signedAmplitude
  if (amplitude === undefined || !isWithinInclusiveRange(amplitude, -1, 1)) return null
  return {
    guides: [horizontalGuide((1 - amplitude) / 2)],
    label: formatMeasurementAmplitude(amplitude),
  }
}

export function resolveWaveformLinkedAnalysisProjection(
  probe: LinkedAnalysisProbe,
  options: {
    mode: WaveformMode
    scrollSpeed: number
    canvasPixelWidth: number
  },
): LinkedAnalysisProjection | null {
  if (probe.sourceKind === 'spectrogram') {
    const secondsAgo = probe.dimensions.historySecondsAgo
    if (secondsAgo === undefined) return null
    const maxHistorySeconds = Math.max(0, options.canvasPixelWidth - 1)
      / (WAVEFORM_BASE_PIXELS_PER_SECOND * Math.max(0.01, options.scrollSpeed))
    if (!isWithinInclusiveRange(secondsAgo, 0, maxHistorySeconds) || maxHistorySeconds <= 0) return null
    return {
      guides: [verticalGuide(1 - secondsAgo / maxHistorySeconds)],
      label: formatMeasurementTime(secondsAgo, true),
    }
  }

  if (probe.sourceKind !== 'oscilloscope') return null
  const amplitude = probe.dimensions.signedAmplitude
  const maxAmplitude = 1 / WAVEFORM_DISPLAY_MARGIN
  if (amplitude === undefined || !isWithinInclusiveRange(amplitude, -maxAmplitude, maxAmplitude)) return null
  const laneY = 0.5 - amplitude * 0.5 * WAVEFORM_DISPLAY_MARGIN
  const guides = options.mode === 'stereo'
    ? [horizontalGuide(laneY / 2), horizontalGuide(0.5 + laneY / 2)]
    : [horizontalGuide(laneY)]
  return {
    guides,
    label: formatMeasurementAmplitude(amplitude),
  }
}

export function resolveMeasurementSourcePoint(
  viewportPoint: NormalizedScopePoint,
  rotation: ScopeDisplayRotation,
  mirrorHorizontal: boolean,
): NormalizedScopePoint {
  const sourcePoint = inverseTransformNormalizedScopePoint(viewportPoint, rotation, mirrorHorizontal)
  return {
    x: clamp01(sourcePoint.x),
    y: clamp01(sourcePoint.y),
  }
}

export function resolveMeasurementReadoutPosition(
  pointer: { x: number; y: number },
  viewport: { width: number; height: number },
  overlay: { width: number; height: number },
  margin = 8,
  gap = 12,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - overlay.width - margin)
  const maxTop = Math.max(margin, viewport.height - overlay.height - margin)
  const preferredLeft = pointer.x + gap + overlay.width <= viewport.width - margin
    ? pointer.x + gap
    : pointer.x - gap - overlay.width
  const preferredTop = pointer.y + gap + overlay.height <= viewport.height - margin
    ? pointer.y + gap
    : pointer.y - gap - overlay.height
  return {
    left: Math.max(margin, Math.min(maxLeft, preferredLeft)),
    top: Math.max(margin, Math.min(maxTop, preferredTop)),
  }
}

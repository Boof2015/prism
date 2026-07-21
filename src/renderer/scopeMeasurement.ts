import type { ScopeDisplayRotation } from '../types/scopeTransform'
import {
  formatSpectrumPitchInfo,
  resolveSpectrumPitchInfo,
} from '../types/spectrum'
import type { SpectrogramScaleMode } from '../types/spectrogram'
import type { WaveformMode } from '../types/waveform'
import {
  inverseTransformNormalizedScopePoint,
  type NormalizedScopePoint,
} from './scopeCanvasTransform'

export type MeasurableScopeKind = 'spectrum' | 'spectrogram' | 'oscilloscope' | 'waveform'

export interface ScopeMeasurement {
  values: string[]
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

function clampFrequencyRange(
  sampleRate: number,
  minFrequency: number,
  maxFrequency: number,
): { minFrequency: number; maxFrequency: number } {
  const nyquist = Math.max(1, sampleRate) / 2
  const min = Math.max(1, Math.min(minFrequency, nyquist))
  return {
    minFrequency: min,
    maxFrequency: Math.max(min + 1, Math.min(maxFrequency, nyquist)),
  }
}

function hzToMelSlaney(frequencyHz: number): number {
  const fSp = 200 / 3
  const minLogHz = 1000
  const minLogMel = minLogHz / fSp
  const logStep = Math.log(6.4) / 27
  return frequencyHz < minLogHz
    ? frequencyHz / fSp
    : minLogMel + (Math.log(frequencyHz / minLogHz) / logStep)
}

function melToHzSlaney(mel: number): number {
  const fSp = 200 / 3
  const minLogHz = 1000
  const minLogMel = minLogHz / fSp
  const logStep = Math.log(6.4) / 27
  return mel < minLogMel
    ? mel * fSp
    : minLogHz * Math.exp(logStep * (mel - minLogMel))
}

export function frequencyAtNormalizedPosition(
  position: number,
  minFrequency: number,
  maxFrequency: number,
  scaleMode: 'linear' | 'log' | 'mel',
): number {
  const t = clamp01(position)
  if (scaleMode === 'linear') {
    return minFrequency + t * (maxFrequency - minFrequency)
  }
  if (scaleMode === 'mel') {
    const melMin = hzToMelSlaney(minFrequency)
    const melMax = hzToMelSlaney(maxFrequency)
    return melToHzSlaney(melMin + t * (melMax - melMin))
  }
  const logMin = Math.log10(minFrequency)
  const logMax = Math.log10(maxFrequency)
  return 10 ** (logMin + t * (logMax - logMin))
}

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
    scaleType: 'linear' | 'log'
  },
): ScopeMeasurement {
  const range = clampFrequencyRange(options.sampleRate, options.minFrequency, options.maxFrequency)
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
  const range = clampFrequencyRange(options.sampleRate, options.minFrequency, options.maxFrequency)
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
  return { values }
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

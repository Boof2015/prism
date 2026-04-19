import { audioRouter } from '../audio/AudioRouter'
import { spectrum as nativeSpectrum, isNativeAvailable } from '../audio/native'
import { defaultVisualizerSessionSource, type VisualizerSessionSource } from './dataSource'
import { FrameScheduler } from './frameScheduler'
import { VisualizerFrameLoop } from './visualizerFrameLoop'
import { parseColorToRgba } from '../utils/color'
import {
  DEFAULT_SPECTRUM_TILT_DB_PER_OCTAVE,
  DEFAULT_SPECTRUM_HEATMAP_TILT_DB_PER_OCTAVE,
  clampSpectrumTiltDbPerOctave,
  clampSpectrumHeatmapTiltDbPerOctave,
  formatSpectrumPitchInfo,
  resolveSpectrumPitchInfo,
  type SpectrumPeakInfo,
} from '../../types/spectrum'

type SpectrumStereoChunk = {
  left: Float32Array
  right: Float32Array
}

export interface SpectrumAnalyzerDataSource extends VisualizerSessionSource {
  getPendingSpectrumSamples: () => Float32Array[]
  getPendingSpectrumStereoSamples: () => SpectrumStereoChunk[]
}

export interface SpectrumAnalyzerOptions {
  lineColor?: string
  secondaryLineColor?: string
  lineWidth?: number
  fillGradient?: boolean
  heatmapFill?: boolean
  heatmapSmoothing?: number
  gradientColors?: string[]
  heatColors?: [string, string, string]
  heatBaseColor?: string
  backgroundColor?: string
  showGrid?: boolean
  gridColor?: string
  scaleType?: 'linear' | 'log'
  smoothing?: number
  minDecibels?: number
  maxDecibels?: number
  minFrequency?: number
  maxFrequency?: number
  tiltDbPerOctave?: number
  heatmapTiltDbPerOctave?: number
  tiltReferenceHz?: number
  fftSize?: number
  showSideLine?: boolean
  capturePeakInfo?: boolean
  onPeakInfo?: (peakInfo: SpectrumPeakInfo | null) => void
  dataSource?: SpectrumAnalyzerDataSource
  frameScheduler?: FrameScheduler
}

type ResolvedSpectrumAnalyzerOptions = Required<Omit<SpectrumAnalyzerOptions, 'dataSource' | 'frameScheduler'>>
type SpectrumPointFillResult = {
  pointCount: number
  peakInfo: SpectrumPeakInfo | null
}

type SpectrumRangePeak = {
  rawDb: number
  frequencyHz: number
}

type HeatColor = [number, number, number, number]
type HeatStop = { at: number; color: HeatColor }

const LEGACY_DEFAULT_HEAT_COLORS: [string, string, string] = [
  'rgb(15, 7, 33)',
  'rgb(163, 26, 121)',
  'rgb(255, 241, 209)',
]

const HEATMAP_GAMMA = 1.4
const FFT_SILENCE_DB = -100
const SPECTRUM_DB_FLOOR = -120
const SPECTRUM_DB_CEILING = 12
const SIDE_LINE_WIDTH_RATIO = 0.75
const PEAK_SELECTION_MAX_DISTANCE_OCTAVES = 0.5
const PEAK_SELECTION_SWITCH_THRESHOLD_DB = 4
const PEAK_SELECTION_LOW_FREQUENCY_BIAS_DB_PER_OCTAVE = 0.75
const PEAK_SELECTION_UPWARD_SWITCH_THRESHOLD_DB = 2
const NOOP_SPECTRUM_PEAK_INFO_CALLBACK = (_peakInfo: SpectrumPeakInfo | null): void => {}

function clampSmoothing(value: number): number {
  return Math.min(0.99, Math.max(0, value))
}

const hannWindowCache = new Map<number, Float32Array>()

function getHannWindow(size: number): Float32Array {
  let window = hannWindowCache.get(size)
  if (window) return window

  window = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)))
  }

  hannWindowCache.set(size, window)
  return window
}

function fft(re: Float32Array, im: Float32Array): void {
  const size = re.length
  if (size <= 1) return

  let j = 0
  for (let i = 1; i < size; i += 1) {
    let bit = size >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit

    if (i < j) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }

  for (let len = 2; len <= size; len <<= 1) {
    const halfLen = len >> 1
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)

    for (let i = 0; i < size; i += len) {
      let curRe = 1
      let curIm = 0

      for (let k = 0; k < halfLen; k += 1) {
        const evenIndex = i + k
        const oddIndex = i + k + halfLen

        const tRe = curRe * re[oddIndex] - curIm * im[oddIndex]
        const tIm = curRe * im[oddIndex] + curIm * re[oddIndex]

        re[oddIndex] = re[evenIndex] - tRe
        im[oddIndex] = im[evenIndex] - tIm
        re[evenIndex] += tRe
        im[evenIndex] += tIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function isLegacyDefaultHeatColors(colors: [string, string, string]): boolean {
  return colors.every((color, index) => {
    const left = parseColorToRgba(color)
    const right = parseColorToRgba(LEGACY_DEFAULT_HEAT_COLORS[index])
    return !!left
      && !!right
      && left.r === right.r
      && left.g === right.g
      && left.b === right.b
      && Math.round(left.a * 255) === Math.round(right.a * 255)
  })
}

function resolveHeatColor(color: string, fallback: string): HeatColor {
  const parsed = parseColorToRgba(color) ?? parseColorToRgba(fallback)
  if (!parsed) {
    return [0, 0, 0, 255]
  }
  return [parsed.r, parsed.g, parsed.b, Math.round(parsed.a * 255)]
}

function scaleHeatColor(color: HeatColor, factor: number): HeatColor {
  return [
    Math.round(color[0] * factor),
    Math.round(color[1] * factor),
    Math.round(color[2] * factor),
    Math.round(color[3] * factor),
  ]
}

function lerpChannel(start: number, end: number, amount: number): number {
  return Math.round(start + ((end - start) * amount))
}

function buildHeatStops(colors: [string, string, string]): HeatStop[] {
  if (isLegacyDefaultHeatColors(colors)) {
    // Preserve Prism's original default spectrum heatmap instead of flattening it
    // into the generic themed stop builder.
    return [
      { at: 0, color: [0, 0, 0, 0] },
      { at: 0.14, color: [15, 7, 33, 255] },
      { at: 0.32, color: [61, 11, 94, 255] },
      { at: 0.54, color: [163, 26, 121, 255] },
      { at: 0.74, color: [255, 82, 87, 255] },
      { at: 0.9, color: [255, 166, 63, 255] },
      { at: 1, color: [255, 241, 209, 255] },
    ]
  }

  const low = resolveHeatColor(colors[0], LEGACY_DEFAULT_HEAT_COLORS[0])
  const mid = resolveHeatColor(colors[1], LEGACY_DEFAULT_HEAT_COLORS[1])
  const high = resolveHeatColor(colors[2], LEGACY_DEFAULT_HEAT_COLORS[2])

  return [
    { at: 0, color: [0, 0, 0, 0] },
    { at: 0.2, color: scaleHeatColor(low, 0.5) },
    { at: 0.48, color: low },
    { at: 0.76, color: mid },
    { at: 1, color: high },
  ]
}

function buildHeatLUT(colors: [string, string, string]): Uint8ClampedArray {
  const heatStops = buildHeatStops(colors)
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255
    let start = heatStops[0]
    let end = heatStops[heatStops.length - 1]
    for (let stopIndex = 0; stopIndex < heatStops.length - 1; stopIndex += 1) {
      if (t <= heatStops[stopIndex + 1].at) {
        start = heatStops[stopIndex]
        end = heatStops[stopIndex + 1]
        break
      }
    }

    const amount = Math.max(0, Math.min(1, (t - start.at) / Math.max(1e-6, end.at - start.at)))
    lut[i * 4] = lerpChannel(start.color[0], end.color[0], amount)
    lut[i * 4 + 1] = lerpChannel(start.color[1], end.color[1], amount)
    lut[i * 4 + 2] = lerpChannel(start.color[2], end.color[2], amount)
    lut[i * 4 + 3] = lerpChannel(start.color[3], end.color[3], amount)
  }
  return lut
}

const defaultOptions: ResolvedSpectrumAnalyzerOptions = {
  lineColor: '#00ffff',
  secondaryLineColor: 'rgba(0, 255, 255, 0.5)',
  lineWidth: 2,
  fillGradient: true,
  heatmapFill: false,
  heatmapSmoothing: 0.5,
  gradientColors: ['rgba(0, 255, 255, 0)', 'rgba(0, 255, 255, 0.3)', 'rgba(138, 43, 226, 0.5)'],
  heatColors: [...LEGACY_DEFAULT_HEAT_COLORS],
  heatBaseColor: 'transparent',
  backgroundColor: 'transparent',
  showGrid: true,
  gridColor: 'rgba(255, 255, 255, 0.1)',
  scaleType: 'log',
  smoothing: 0.9,
  minDecibels: -90,
  maxDecibels: -10,
  minFrequency: 20,
  maxFrequency: 20000,
  tiltDbPerOctave: DEFAULT_SPECTRUM_TILT_DB_PER_OCTAVE,
  heatmapTiltDbPerOctave: DEFAULT_SPECTRUM_HEATMAP_TILT_DB_PER_OCTAVE,
  tiltReferenceHz: 1000,
  fftSize: 2048,
  showSideLine: false,
  capturePeakInfo: false,
  onPeakInfo: NOOP_SPECTRUM_PEAK_INFO_CALLBACK,
}

const defaultSpectrumDataSource: SpectrumAnalyzerDataSource = {
  getPendingSpectrumSamples: () => audioRouter.flushPendingSpectrumSamples(),
  getPendingSpectrumStereoSamples: () => audioRouter.flushPendingSpectrumStereoSamples(),
  ...defaultVisualizerSessionSource,
}

export class SpectrumAnalyzer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private options: ResolvedSpectrumAnalyzerOptions
  private dataSource: SpectrumAnalyzerDataSource
  private frameLoop: VisualizerFrameLoop
  private nativeInitialized = false
  private sampleRate = 48000
  private lastSampleRate = 0
  private heatLut: Uint8ClampedArray
  private staticLayerCanvas: HTMLCanvasElement
  private staticLayerCtx: CanvasRenderingContext2D
  private staticLayerKey = ''
  private unsubscribeSessionChange: (() => void) | null = null

  private jsMidHistory = new Float32Array(defaultOptions.fftSize)
  private jsSideHistory = new Float32Array(defaultOptions.fftSize)
  private jsMidRawMagnitudes = new Float32Array(defaultOptions.fftSize / 2)
  private jsRawScratch = new Float32Array(defaultOptions.fftSize / 2)
  private jsMidMagnitudes = new Float32Array(defaultOptions.fftSize / 2)
  private jsSideMagnitudes = new Float32Array(defaultOptions.fftSize / 2)
  private jsFftRe = new Float32Array(defaultOptions.fftSize)
  private jsFftIm = new Float32Array(defaultOptions.fftSize)
  private jsBufferedSamples = 0
  private jsHasSpectrumData = false
  private nativeMagnitudeBuffer = new Float32Array(0)
  private nativeRawMagnitudeBuffer = new Float32Array(0)
  private heatmapMagnitudeBuffer = new Float32Array(0)
  private nativeBufferedSamples = 0
  private nativeHasSpectrumData = false
  private pushScratch = new Float32Array(0)
  private primaryPointX = new Float32Array(0)
  private primaryPointY = new Float32Array(0)
  private heatmapPointY = new Float32Array(0)
  private primaryPointHeatmap = new Float32Array(0)
  private secondaryPointX = new Float32Array(0)
  private secondaryPointY = new Float32Array(0)
  private primaryPointDb = new Float32Array(0)
  private primaryPointFrequency = new Float32Array(0)
  private lastSelectedPeakInfo: SpectrumPeakInfo | null = null

  constructor(canvas: HTMLCanvasElement, options: SpectrumAnalyzerOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D context')
    this.ctx = ctx

    const { dataSource, frameScheduler, ...optionOverrides } = options
    this.options = {
      ...defaultOptions,
      ...optionOverrides,
      tiltDbPerOctave: clampSpectrumTiltDbPerOctave(
        optionOverrides.tiltDbPerOctave ?? defaultOptions.tiltDbPerOctave
      ),
      heatmapTiltDbPerOctave: clampSpectrumHeatmapTiltDbPerOctave(
        optionOverrides.heatmapTiltDbPerOctave ?? defaultOptions.heatmapTiltDbPerOctave
      ),
    }
    this.dataSource = dataSource ?? defaultSpectrumDataSource
    this.heatLut = buildHeatLUT(this.options.heatColors)
    this.frameLoop = new VisualizerFrameLoop({
      frameScheduler,
      shouldRun: () => this.dataSource.isPlaying(),
      onFrame: this.drawFrame,
    })
    this.staticLayerCanvas = document.createElement('canvas')
    const staticLayerCtx = this.staticLayerCanvas.getContext('2d')
    if (!staticLayerCtx) throw new Error('Could not get offscreen 2D context')
    this.staticLayerCtx = staticLayerCtx

    this.resetJsState()
    this.initNative()
    this.subscribeToSessionChanges()
  }

  private subscribeToSessionChanges(): void {
    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
    }

    this.unsubscribeSessionChange = this.dataSource.subscribeToSessionChanges(() => {
      this.resetState()
    })
  }

  private initNative(): void {
    this.sampleRate = Math.max(1, this.dataSource.getSampleRate())
    this.lastSampleRate = 0

    if (isNativeAvailable() && !this.nativeInitialized) {
      nativeSpectrum.setFFTSize(this.options.fftSize)
      nativeSpectrum.setSampleRate(this.sampleRate)
      nativeSpectrum.setSmoothing(this.getNativeSmoothing())
      this.nativeInitialized = true
      console.log(`SpectrumAnalyzer: Using native DSP (${this.sampleRate}Hz)`)
    } else if (!isNativeAvailable() && !this.options.showSideLine) {
      console.error('SpectrumAnalyzer: Native DSP not available!')
    }
  }

  private ensureJsStateSize(): void {
    const { fftSize } = this.options
    if (this.jsMidHistory.length === fftSize) {
      return
    }

    this.jsMidHistory = new Float32Array(fftSize)
    this.jsSideHistory = new Float32Array(fftSize)
    this.jsMidRawMagnitudes = new Float32Array(fftSize / 2)
    this.jsRawScratch = new Float32Array(fftSize / 2)
    this.jsMidMagnitudes = new Float32Array(fftSize / 2)
    this.jsSideMagnitudes = new Float32Array(fftSize / 2)
    this.jsFftRe = new Float32Array(fftSize)
    this.jsFftIm = new Float32Array(fftSize)
  }

  private ensureMagnitudeBufferSize(): void {
    const length = Math.max(1, Math.floor(this.options.fftSize / 2))
    if (this.nativeMagnitudeBuffer.length !== length) {
      this.nativeMagnitudeBuffer = new Float32Array(length)
    }
    if (this.nativeRawMagnitudeBuffer.length !== length) {
      this.nativeRawMagnitudeBuffer = new Float32Array(length)
    }
    if (this.heatmapMagnitudeBuffer.length !== length) {
      this.heatmapMagnitudeBuffer = new Float32Array(length)
    }
  }

  private resetJsState(): void {
    this.ensureJsStateSize()
    this.ensureMagnitudeBufferSize()
    this.jsMidHistory.fill(0)
    this.jsSideHistory.fill(0)
    this.jsMidRawMagnitudes.fill(FFT_SILENCE_DB)
    this.jsMidMagnitudes.fill(FFT_SILENCE_DB)
    this.jsSideMagnitudes.fill(FFT_SILENCE_DB)
    this.nativeMagnitudeBuffer.fill(FFT_SILENCE_DB)
    this.nativeRawMagnitudeBuffer.fill(FFT_SILENCE_DB)
    this.heatmapMagnitudeBuffer.fill(FFT_SILENCE_DB)
    this.jsFftRe.fill(0)
    this.jsFftIm.fill(0)
    this.jsBufferedSamples = 0
    this.jsHasSpectrumData = false
    this.nativeBufferedSamples = 0
    this.nativeHasSpectrumData = false
    this.lastSelectedPeakInfo = null
  }

  private updateSampleRateIfNeeded(): void {
    const currentRate = Math.max(1, this.dataSource.getSampleRate())
    if (currentRate !== this.lastSampleRate && currentRate > 0) {
      this.sampleRate = currentRate
      this.lastSampleRate = currentRate
      if (isNativeAvailable()) {
        nativeSpectrum.setSampleRate(currentRate)
      }
      console.log(`SpectrumAnalyzer: Sample rate updated to ${currentRate}Hz`)
    }
  }

  private getNativeSmoothing(): number {
    const base = clampSmoothing(this.options.smoothing)
    const fftRatio = Math.max(0.5, this.options.fftSize / 2048)
    return clampSmoothing(Math.pow(base, fftRatio))
  }

  private resetState(): void {
    if (isNativeAvailable()) {
      nativeSpectrum.reset()
    }
    this.resetJsState()
    this.sampleRate = Math.max(1, this.dataSource.getSampleRate())
    this.lastSampleRate = 0
    this.invalidate()
  }

  setOptions(options: Partial<SpectrumAnalyzerOptions>): void {
    const { dataSource, frameScheduler: _frameScheduler, ...optionUpdates } = options
    const nextOptions = { ...this.options, ...optionUpdates }
    if (optionUpdates.tiltDbPerOctave !== undefined) {
      nextOptions.tiltDbPerOctave = clampSpectrumTiltDbPerOctave(optionUpdates.tiltDbPerOctave)
    }
    if (optionUpdates.heatmapTiltDbPerOctave !== undefined) {
      nextOptions.heatmapTiltDbPerOctave = clampSpectrumHeatmapTiltDbPerOctave(optionUpdates.heatmapTiltDbPerOctave)
    }

    const shouldResetForOptions = (
      optionUpdates.fftSize !== undefined
      || optionUpdates.smoothing !== undefined
      || optionUpdates.heatmapSmoothing !== undefined
      || optionUpdates.showSideLine !== undefined
    )

    this.options = nextOptions
    this.heatLut = buildHeatLUT(this.options.heatColors)
    let didReset = false

    if (dataSource && dataSource !== this.dataSource) {
      this.dataSource = dataSource
      this.subscribeToSessionChanges()
      this.resetState()
      didReset = true
    }

    if (isNativeAvailable()) {
      if (options.fftSize !== undefined) {
        nativeSpectrum.setFFTSize(options.fftSize)
      }
      if (options.smoothing !== undefined || options.fftSize !== undefined) {
        nativeSpectrum.setSmoothing(this.getNativeSmoothing())
      }
    }

    if (shouldResetForOptions && !didReset) {
      this.resetState()
      didReset = true
    }

    this.staticLayerKey = ''
    if (!didReset) {
      this.invalidate()
    }
  }

  start(): void {
    this.frameLoop.start()
  }

  stop(): void {
    this.frameLoop.stop()
  }

  invalidate(): void {
    this.frameLoop.invalidate()
  }

  resize(): void {
    this.staticLayerKey = ''
    this.invalidate()
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  private getInterpolatedValue(data: Float32Array, index: number): number {
    const i0 = Math.floor(index)
    const i1 = Math.min(i0 + 1, data.length - 1)
    const t = index - i0
    return this.lerp(data[i0], data[i1], t)
  }

  private frequencyAtPosition(t: number, minFrequency: number, maxFrequency: number): number {
    if (this.options.scaleType === 'log') {
      const logMin = Math.log10(minFrequency)
      const logMax = Math.log10(maxFrequency)
      return Math.pow(10, logMin + t * (logMax - logMin))
    }
    return minFrequency + t * (maxFrequency - minFrequency)
  }

  private resolvePeakInRange(
    data: Float32Array,
    startIndex: number,
    endIndex: number,
    binWidth: number,
  ): SpectrumRangePeak {
    const clampedStart = Math.max(0, Math.min(data.length - 1, startIndex))
    const clampedEnd = Math.max(0, Math.min(data.length - 1, endIndex))
    const lo = Math.floor(Math.min(clampedStart, clampedEnd))
    const hi = Math.ceil(Math.max(clampedStart, clampedEnd))

    if (hi <= lo) {
      const rawDb = this.getInterpolatedValue(data, clampedStart)
      return {
        rawDb,
        frequencyHz: Math.max(0, clampedStart * binWidth),
      }
    }

    let peakBin = lo
    let peakDb = Number.NEGATIVE_INFINITY
    for (let i = lo; i <= hi; i += 1) {
      if (data[i] > peakDb) {
        peakDb = data[i]
        peakBin = i
      }
    }

    if (peakBin > 0 && peakBin < data.length - 1) {
      const y1 = data[peakBin - 1]
      const y2 = data[peakBin]
      const y3 = data[peakBin + 1]
      const denominator = y1 - (2 * y2) + y3
      if (Math.abs(denominator) > 1e-9) {
        const offset = Math.max(-0.5, Math.min(0.5, 0.5 * (y1 - y3) / denominator))
        const interpolatedDb = y2 - (0.25 * (y1 - y3) * offset)
        return {
          rawDb: interpolatedDb,
          frequencyHz: Math.max(0, (peakBin + offset) * binWidth),
        }
      }
    }

    return {
      rawDb: peakDb,
      frequencyHz: Math.max(0, peakBin * binWidth),
    }
  }

  private applyTilt(db: number, frequency: number, tiltDbPerOctave = this.options.tiltDbPerOctave): number {
    const safeFreq = Math.max(1, frequency)
    const reference = Math.max(1, this.options.tiltReferenceHz)
    const octaves = Math.log2(safeFreq / reference)
    return db + tiltDbPerOctave * octaves
  }

  private ensurePointBuffers(pointCount: number): void {
    if (this.primaryPointX.length !== pointCount) {
      this.primaryPointX = new Float32Array(pointCount)
      this.primaryPointY = new Float32Array(pointCount)
      this.heatmapPointY = new Float32Array(pointCount)
      this.primaryPointHeatmap = new Float32Array(pointCount)
      this.secondaryPointX = new Float32Array(pointCount)
      this.secondaryPointY = new Float32Array(pointCount)
      this.primaryPointDb = new Float32Array(pointCount)
      this.primaryPointFrequency = new Float32Array(pointCount)
    }
  }

  private recordNativeBufferedSamples(length: number): void {
    if (length <= 0) {
      return
    }
    this.nativeBufferedSamples = Math.min(this.options.fftSize, this.nativeBufferedSamples + length)
  }

  private pushPendingSpectrumChunks(pendingSpectrum: Float32Array[]): number {
    if (pendingSpectrum.length === 0) return 0

    if (pendingSpectrum.length === 1) {
      if (pendingSpectrum[0].length > 0) {
        nativeSpectrum.pushSamples(pendingSpectrum[0])
        this.recordNativeBufferedSamples(pendingSpectrum[0].length)
      }
      return pendingSpectrum[0].length
    }

    let totalLength = 0
    for (const chunk of pendingSpectrum) {
      totalLength += chunk.length
    }
    if (totalLength === 0) return 0

    if (this.pushScratch.length < totalLength) {
      this.pushScratch = new Float32Array(totalLength)
    }

    const merged = this.pushScratch.length === totalLength
      ? this.pushScratch
      : this.pushScratch.subarray(0, totalLength)

    let offset = 0
    for (const chunk of pendingSpectrum) {
      if (chunk.length > 0) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
    }

    nativeSpectrum.pushSamples(merged)
    this.recordNativeBufferedSamples(totalLength)
    return totalLength
  }

  private clearPendingSpectrumQueues(): void {
    this.dataSource.getPendingSpectrumSamples()
    this.dataSource.getPendingSpectrumStereoSamples()
  }

  private pushJsSpectrumHistory(left: Float32Array, right: Float32Array, length: number): void {
    const fftSize = this.options.fftSize
    if (length >= fftSize) {
      const start = length - fftSize
      for (let index = 0; index < fftSize; index += 1) {
        const leftValue = left[start + index] ?? 0
        const rightValue = right[start + index] ?? leftValue
        this.jsMidHistory[index] = (leftValue + rightValue) * 0.5
        this.jsSideHistory[index] = (leftValue - rightValue) * 0.5
      }
      this.jsBufferedSamples = fftSize
      return
    }

    this.jsMidHistory.copyWithin(0, length)
    this.jsSideHistory.copyWithin(0, length)
    const writeStart = fftSize - length
    for (let index = 0; index < length; index += 1) {
      const leftValue = left[index] ?? 0
      const rightValue = right[index] ?? leftValue
      this.jsMidHistory[writeStart + index] = (leftValue + rightValue) * 0.5
      this.jsSideHistory[writeStart + index] = (leftValue - rightValue) * 0.5
    }
    this.jsBufferedSamples = Math.min(fftSize, this.jsBufferedSamples + length)
  }

  private updateSmoothedMagnitudes(
    rawMagnitudes: Float32Array,
    dataLength: number,
    smoothedMagnitudes: Float32Array,
    smoothing: number,
    bypassSmoothing: boolean,
  ): number {
    const count = Math.min(dataLength, rawMagnitudes.length, smoothedMagnitudes.length)
    if (count <= 0) {
      return 0
    }

    const smoothingAmount = clampSmoothing(smoothing)
    for (let index = 0; index < count; index += 1) {
      const rawDb = Number.isFinite(rawMagnitudes[index]) ? rawMagnitudes[index] : FFT_SILENCE_DB
      if (bypassSmoothing) {
        smoothedMagnitudes[index] = rawDb
        continue
      }

      smoothedMagnitudes[index] = smoothingAmount * smoothedMagnitudes[index] + (1 - smoothingAmount) * rawDb
      if (!Number.isFinite(smoothedMagnitudes[index])) {
        smoothedMagnitudes[index] = FFT_SILENCE_DB
      }
    }

    return count
  }

  private updateJsMagnitudes(
    history: Float32Array,
    smoothedMagnitudes: Float32Array,
    rawMagnitudesOut: Float32Array | null = null,
  ): void {
    const fftSize = this.options.fftSize
    const window = getHannWindow(fftSize)

    for (let index = 0; index < fftSize; index += 1) {
      this.jsFftRe[index] = history[index] * window[index]
      this.jsFftIm[index] = 0
    }

    fft(this.jsFftRe, this.jsFftIm)

    const scale = 2 / fftSize
    const rawMagnitudes = rawMagnitudesOut ?? this.jsRawScratch
    for (let index = 0; index < smoothedMagnitudes.length; index += 1) {
      const magnitude = Math.hypot(this.jsFftRe[index], this.jsFftIm[index]) * scale
      let db = 20 * Math.log10(Math.max(magnitude, 1e-10))
      db += 6
      db = Math.min(SPECTRUM_DB_CEILING, Math.max(SPECTRUM_DB_FLOOR, db))
      rawMagnitudes[index] = db
    }

    this.updateSmoothedMagnitudes(
      rawMagnitudes,
      rawMagnitudes.length,
      smoothedMagnitudes,
      this.options.smoothing,
      this.jsBufferedSamples < fftSize,
    )
  }

  private processJsSpectrumChunks(pendingSpectrum: SpectrumStereoChunk[]): void {
    let didReceiveAudio = false
    for (const chunk of pendingSpectrum) {
      const length = Math.min(chunk.left.length, chunk.right.length)
      if (length <= 0) {
        continue
      }

      this.pushJsSpectrumHistory(chunk.left, chunk.right, length)
      didReceiveAudio = true
    }

    if (!didReceiveAudio) {
      return
    }

    this.updateJsMagnitudes(this.jsMidHistory, this.jsMidMagnitudes, this.jsMidRawMagnitudes)
    this.updateJsMagnitudes(this.jsSideHistory, this.jsSideMagnitudes)
    this.updateSmoothedMagnitudes(
      this.jsMidRawMagnitudes,
      this.jsMidRawMagnitudes.length,
      this.heatmapMagnitudeBuffer,
      this.options.heatmapSmoothing,
      this.jsBufferedSamples < this.options.fftSize,
    )
    this.jsHasSpectrumData = true
  }

  private fillSpectrumPoints(
    frequencyData: Float32Array,
    dataLength: number,
    width: number,
    height: number,
    minFrequency: number,
    maxFrequency: number,
    nyquist: number,
    tiltDbPerOctave: number,
    xOut: Float32Array,
    yOut: Float32Array,
    heatmapIntensityOut: Float32Array | null,
    capturePeakInfo = false,
  ): SpectrumPointFillResult {
    const bufferLength = Math.min(dataLength, frequencyData.length)
    if (bufferLength <= 0) {
      return { pointCount: 0, peakInfo: null }
    }
    const binWidth = nyquist / bufferLength
    const numPoints = Math.max(2, Math.floor(width))

    for (let index = 0; index < numPoints; index += 1) {
      const t0 = index / (numPoints - 1)
      const t1 = Math.min(1, (index + 1) / (numPoints - 1))
      const x = t0 * width

      const frequency0 = this.frequencyAtPosition(t0, minFrequency, maxFrequency)
      const frequency1 = this.frequencyAtPosition(t1, minFrequency, maxFrequency)
      const centerFrequency = (frequency0 + frequency1) * 0.5
      const bin0 = frequency0 / binWidth
      const bin1 = frequency1 / binWidth
      const centerBin = (bin0 + bin1) * 0.5
      const binSpan = Math.abs(bin1 - bin0)
      const resolvedPeak = (capturePeakInfo || binSpan > 1)
        ? this.resolvePeakInRange(frequencyData, bin0, bin1, binWidth)
        : null
      const rawDb = binSpan <= 1
        ? this.getInterpolatedValue(frequencyData, Math.min(centerBin, bufferLength - 1))
        : (resolvedPeak?.rawDb ?? this.getInterpolatedValue(frequencyData, Math.min(centerBin, bufferLength - 1)))
      const db = this.applyTilt(rawDb, centerFrequency, tiltDbPerOctave)

      const normalized = (db - this.options.minDecibels) / (this.options.maxDecibels - this.options.minDecibels)
      const clampedNormalized = Math.max(0, Math.min(1, normalized))

      xOut[index] = x
      yOut[index] = height - clampedNormalized * height
      if (heatmapIntensityOut) {
        heatmapIntensityOut[index] = Math.pow(clampedNormalized, HEATMAP_GAMMA)
      }

      if (capturePeakInfo) {
        this.primaryPointDb[index] = db
        this.primaryPointFrequency[index] = resolvedPeak?.frequencyHz ?? centerFrequency
      }
    }

    return {
      pointCount: numPoints,
      peakInfo: capturePeakInfo ? this.selectPeakInfo(numPoints, height) : null,
    }
  }

  private buildPeakInfoAt(index: number, height: number): SpectrumPeakInfo | null {
    if (
      index < 0
      || index >= this.primaryPointDb.length
      || index >= this.primaryPointFrequency.length
      || index >= this.primaryPointX.length
      || index >= this.primaryPointY.length
    ) {
      return null
    }

    const frequencyHz = this.primaryPointFrequency[index]
    const db = this.primaryPointDb[index]
    return {
      db,
      frequencyHz,
      normalizedX: this.primaryPointX[index] / Math.max(1, this.canvas.width),
      normalizedY: this.primaryPointY[index] / Math.max(1, height),
      key: formatSpectrumPitchInfo(resolveSpectrumPitchInfo(frequencyHz)),
    }
  }

  private isLocalPeak(index: number, pointCount: number): boolean {
    const currentDb = this.primaryPointDb[index]
    const previousDb = index > 0
      ? this.primaryPointDb[index - 1]
      : Number.NEGATIVE_INFINITY
    const nextDb = index + 1 < pointCount
      ? this.primaryPointDb[index + 1]
      : Number.NEGATIVE_INFINITY

    return currentDb >= previousDb
      && currentDb >= nextDb
      && (currentDb > previousDb || currentDb > nextDb)
  }

  private getPeakSelectionScore(index: number): number {
    const frequencyHz = this.primaryPointFrequency[index]
    const db = this.primaryPointDb[index]
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || !Number.isFinite(db)) {
      return Number.NEGATIVE_INFINITY
    }

    const referenceFrequencyHz = Math.max(1, this.options.minFrequency)
    const octaveOffset = Math.max(0, Math.log2(frequencyHz / referenceFrequencyHz))
    return db - octaveOffset * PEAK_SELECTION_LOW_FREQUENCY_BIAS_DB_PER_OCTAVE
  }

  private isBetterPeakIndex(candidateIndex: number, bestIndex: number): boolean {
    const candidateScore = this.getPeakSelectionScore(candidateIndex)
    const bestScore = this.getPeakSelectionScore(bestIndex)
    if (candidateScore !== bestScore) {
      return candidateScore > bestScore
    }

    const candidateDb = this.primaryPointDb[candidateIndex]
    const bestDb = this.primaryPointDb[bestIndex]
    if (candidateDb !== bestDb) {
      return candidateDb > bestDb
    }

    return this.primaryPointFrequency[candidateIndex] < this.primaryPointFrequency[bestIndex]
  }

  private findBestPeakIndex(candidateIndices: number[]): number {
    let bestIndex = candidateIndices[0]

    for (let index = 1; index < candidateIndices.length; index += 1) {
      const candidateIndex = candidateIndices[index]
      if (this.isBetterPeakIndex(candidateIndex, bestIndex)) {
        bestIndex = candidateIndex
      }
    }

    return bestIndex
  }

  private findBestPointIndex(pointCount: number): number {
    let bestIndex = 0

    for (let index = 1; index < pointCount; index += 1) {
      if (this.isBetterPeakIndex(index, bestIndex)) {
        bestIndex = index
      }
    }

    return bestIndex
  }

  private findBestNearbyPeakIndex(candidateIndices: number[], targetFrequencyHz: number): number {
    let bestIndex = -1

    for (const candidateIndex of candidateIndices) {
      const candidateFrequencyHz = this.primaryPointFrequency[candidateIndex]
      if (!Number.isFinite(candidateFrequencyHz) || candidateFrequencyHz <= 0) {
        continue
      }

      const octaveDistance = Math.abs(Math.log2(candidateFrequencyHz / targetFrequencyHz))
      if (octaveDistance > PEAK_SELECTION_MAX_DISTANCE_OCTAVES) {
        continue
      }

      if (bestIndex === -1 || this.isBetterPeakIndex(candidateIndex, bestIndex)) {
        bestIndex = candidateIndex
      }
    }

    return bestIndex
  }

  private selectPeakInfo(pointCount: number, height: number): SpectrumPeakInfo | null {
    if (pointCount <= 0) {
      this.lastSelectedPeakInfo = null
      return null
    }

    const candidateIndices: number[] = []
    for (let index = 0; index < pointCount; index += 1) {
      if (this.isLocalPeak(index, pointCount)) {
        candidateIndices.push(index)
      }
    }

    if (candidateIndices.length === 0) {
      candidateIndices.push(this.findBestPointIndex(pointCount))
    }

    const strongestIndex = this.findBestPeakIndex(candidateIndices)
    const strongestScore = this.getPeakSelectionScore(strongestIndex)

    const previousPeak = this.lastSelectedPeakInfo
    let selectedIndex = strongestIndex

    if (previousPeak && Number.isFinite(previousPeak.frequencyHz) && previousPeak.frequencyHz > 0) {
      const stickyIndex = this.findBestNearbyPeakIndex(candidateIndices, previousPeak.frequencyHz)

      if (
        stickyIndex !== -1
        && strongestScore < (
          this.getPeakSelectionScore(stickyIndex)
          + PEAK_SELECTION_SWITCH_THRESHOLD_DB
          + (
            this.primaryPointFrequency[strongestIndex] > this.primaryPointFrequency[stickyIndex]
              ? PEAK_SELECTION_UPWARD_SWITCH_THRESHOLD_DB
              : 0
          )
        )
      ) {
        selectedIndex = stickyIndex
      }
    }

    const peakInfo = this.buildPeakInfoAt(selectedIndex, height)
    this.lastSelectedPeakInfo = peakInfo
    return peakInfo
  }

  private emitPeakInfo(peakInfo: SpectrumPeakInfo | null): void {
    if (peakInfo === null) {
      this.lastSelectedPeakInfo = null
    }
    this.options.onPeakInfo(peakInfo)
  }

  private renderHeatmap(xPoints: Float32Array, yPoints: Float32Array, heatmapIntensity: Float32Array, pointCount: number, width: number, height: number): void {
    const baseColor = this.options.heatBaseColor
    const parsedBaseColor = baseColor ? parseColorToRgba(baseColor) : null
    const shouldRenderBaseColor = !!baseColor && baseColor !== 'transparent' && (!parsedBaseColor || parsedBaseColor.a > 0)

    for (let index = 0; index < pointCount; index += 1) {
      const x = Math.floor(xPoints[index])
      const y = yPoints[index]
      const nextX = index < pointCount - 1 ? Math.floor(xPoints[index + 1]) : width
      const columnWidth = Math.max(1, nextX - x)
      const fillHeight = height - y
      if (fillHeight <= 0) {
        continue
      }

      if (shouldRenderBaseColor) {
        this.ctx.fillStyle = baseColor
        this.ctx.fillRect(x, Math.floor(y), columnWidth, Math.ceil(fillHeight))
      }

      const lutIndex = Math.round(heatmapIntensity[index] * 255)
      const r = this.heatLut[lutIndex * 4]
      const g = this.heatLut[lutIndex * 4 + 1]
      const b = this.heatLut[lutIndex * 4 + 2]
      const a = Math.round((this.heatLut[lutIndex * 4 + 3] * heatmapIntensity[index]))
      if (a <= 0) {
        continue
      }

      this.ctx.fillStyle = a >= 255
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`
      this.ctx.fillRect(x, Math.floor(y), columnWidth, Math.ceil(fillHeight))
    }
  }

  private renderGradientFill(xPoints: Float32Array, yPoints: Float32Array, pointCount: number, width: number, height: number): void {
    this.ctx.beginPath()
    this.ctx.moveTo(xPoints[0], yPoints[0])

    for (let index = 1; index < pointCount; index += 1) {
      this.ctx.lineTo(xPoints[index], yPoints[index])
    }

    this.ctx.lineTo(width, height)
    this.ctx.lineTo(0, height)
    this.ctx.closePath()

    const gradient = this.ctx.createLinearGradient(0, height, 0, 0)
    const colors = this.options.gradientColors
    for (let index = 0; index < colors.length; index += 1) {
      gradient.addColorStop(index / (colors.length - 1), colors[index])
    }

    this.ctx.fillStyle = gradient
    this.ctx.fill()
  }

  private renderStroke(xPoints: Float32Array, yPoints: Float32Array, pointCount: number, color: string, lineWidth: number): void {
    if (pointCount === 0) {
      return
    }

    this.ctx.beginPath()
    this.ctx.moveTo(xPoints[0], yPoints[0])
    for (let index = 1; index < pointCount; index += 1) {
      this.ctx.lineTo(xPoints[index], yPoints[index])
    }

    this.ctx.lineWidth = lineWidth
    this.ctx.strokeStyle = color
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.ctx.stroke()
  }

  private drawFrame = (): void => {
    const { canvas, options } = this
    const width = canvas.width
    const height = canvas.height
    const dpr = window.devicePixelRatio || 1
    if (width <= 0 || height <= 0) {
      return
    }

    this.updateSampleRateIfNeeded()

    const nyquist = this.sampleRate / 2
    const minFrequency = Math.max(1, Math.min(options.minFrequency, nyquist))
    const maxFrequency = Math.max(minFrequency + 1, Math.min(options.maxFrequency, nyquist))

    if (!this.dataSource.isPlaying()) {
      this.clearPendingSpectrumQueues()
      if (isNativeAvailable()) {
        nativeSpectrum.reset()
      }
      this.resetJsState()
      this.renderStaticLayer(minFrequency, maxFrequency)
      this.emitPeakInfo(null)
      return
    }

    let primaryData: Float32Array | null = null
    let heatmapData: Float32Array | null = null
    let secondaryData: Float32Array | null = null
    let primaryDataLength = 0
    let heatmapDataLength = 0
    let secondaryDataLength = 0

    if (options.showSideLine) {
      this.processJsSpectrumChunks(this.dataSource.getPendingSpectrumStereoSamples())
      primaryData = this.jsHasSpectrumData ? this.jsMidMagnitudes : null
      heatmapData = this.jsHasSpectrumData ? this.heatmapMagnitudeBuffer : null
      secondaryData = this.jsHasSpectrumData ? this.jsSideMagnitudes : null
      primaryDataLength = primaryData?.length ?? 0
      heatmapDataLength = heatmapData?.length ?? 0
      secondaryDataLength = secondaryData?.length ?? 0
    } else {
      if (!isNativeAvailable()) {
        console.error('SpectrumAnalyzer: Native DSP required')
        this.renderStaticLayer(minFrequency, maxFrequency)
        this.emitPeakInfo(null)
        return
      }

      const pendingSpectrum = this.dataSource.getPendingSpectrumSamples()
      const receivedNativeSamples = this.pushPendingSpectrumChunks(pendingSpectrum)

      this.ensureMagnitudeBufferSize()
      primaryData = this.nativeMagnitudeBuffer
      primaryDataLength = nativeSpectrum.fillMagnitudes(this.nativeMagnitudeBuffer)

      if (receivedNativeSamples > 0 || !this.nativeHasSpectrumData) {
        heatmapDataLength = nativeSpectrum.fillRawMagnitudes(this.nativeRawMagnitudeBuffer)
        if (heatmapDataLength > 0) {
          this.updateSmoothedMagnitudes(
            this.nativeRawMagnitudeBuffer,
            heatmapDataLength,
            this.heatmapMagnitudeBuffer,
            options.heatmapSmoothing,
            this.nativeBufferedSamples < options.fftSize,
          )
          this.nativeHasSpectrumData = true
        }
      } else if (this.nativeHasSpectrumData) {
        heatmapDataLength = this.heatmapMagnitudeBuffer.length
      }

      heatmapData = this.nativeHasSpectrumData ? this.heatmapMagnitudeBuffer : null
    }

    if (!primaryData || primaryDataLength === 0) {
      this.renderStaticLayer(minFrequency, maxFrequency)
      this.emitPeakInfo(null)
      return
    }

    const pointCount = Math.max(2, Math.floor(width))
    this.ensurePointBuffers(pointCount)
    const primaryRender = this.fillSpectrumPoints(
      primaryData,
      primaryDataLength,
      width,
      height,
      minFrequency,
      maxFrequency,
      nyquist,
      options.tiltDbPerOctave,
      this.primaryPointX,
      this.primaryPointY,
      null,
      options.capturePeakInfo,
    )
    const heatmapRender = heatmapData && heatmapDataLength > 0
      ? this.fillSpectrumPoints(
        heatmapData,
        heatmapDataLength,
        width,
        height,
        minFrequency,
        maxFrequency,
        nyquist,
        options.heatmapTiltDbPerOctave,
        this.primaryPointX,
        this.heatmapPointY,
        this.primaryPointHeatmap,
      )
      : { pointCount: 0, peakInfo: null }

    const secondaryRender = secondaryData && secondaryDataLength > 0
      ? this.fillSpectrumPoints(
        secondaryData,
        secondaryDataLength,
        width,
        height,
        minFrequency,
        maxFrequency,
        nyquist,
        options.tiltDbPerOctave,
        this.secondaryPointX,
        this.secondaryPointY,
        null,
      )
      : { pointCount: 0, peakInfo: null }

    this.renderStaticLayer(minFrequency, maxFrequency)

    if (options.heatmapFill && heatmapRender.pointCount > 0) {
      const renderPointCount = Math.min(primaryRender.pointCount, heatmapRender.pointCount)
      this.renderHeatmap(
        this.primaryPointX,
        this.primaryPointY,
        this.primaryPointHeatmap,
        renderPointCount,
        width,
        height,
      )
    } else if (options.fillGradient && primaryRender.pointCount > 0) {
      this.renderGradientFill(this.primaryPointX, this.primaryPointY, primaryRender.pointCount, width, height)
    }

    this.renderStroke(this.primaryPointX, this.primaryPointY, primaryRender.pointCount, options.lineColor, options.lineWidth * dpr)
    if (secondaryRender.pointCount > 0) {
      const secondaryLineWidth = Math.max(dpr, options.lineWidth * SIDE_LINE_WIDTH_RATIO * dpr)
      this.renderStroke(this.secondaryPointX, this.secondaryPointY, secondaryRender.pointCount, options.secondaryLineColor, secondaryLineWidth)
    }

    this.emitPeakInfo(primaryRender.peakInfo)
  }

  private renderStaticLayer(minFrequency: number, maxFrequency: number): void {
    this.ensureStaticLayer(minFrequency, maxFrequency)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.drawImage(this.staticLayerCanvas, 0, 0)
  }

  private ensureStaticLayer(minFrequency: number, maxFrequency: number): void {
    const { canvas, options } = this
    const key = [
      canvas.width,
      canvas.height,
      options.backgroundColor,
      options.showGrid,
      options.gridColor,
      options.scaleType,
      options.minDecibels,
      options.maxDecibels,
      minFrequency,
      maxFrequency,
    ].join(':')

    if (this.staticLayerKey === key) {
      return
    }

    this.staticLayerCanvas.width = canvas.width
    this.staticLayerCanvas.height = canvas.height
    this.staticLayerCtx.clearRect(0, 0, canvas.width, canvas.height)

    if (options.backgroundColor !== 'transparent') {
      this.staticLayerCtx.fillStyle = options.backgroundColor
      this.staticLayerCtx.fillRect(0, 0, canvas.width, canvas.height)
    }

    if (options.showGrid) {
      this.drawGrid(this.staticLayerCtx, minFrequency, maxFrequency)
    }

    this.staticLayerKey = key
  }

  private drawGrid(ctx: CanvasRenderingContext2D, minFrequency: number, maxFrequency: number): void {
    const { canvas, options } = this
    const width = canvas.width
    const height = canvas.height
    const dpr = window.devicePixelRatio || 1

    ctx.strokeStyle = options.gridColor
    ctx.lineWidth = dpr

    const dbSteps = [-80, -60, -40, -20, 0]
    ctx.fillStyle = options.gridColor
    ctx.font = `${10 * dpr}px monospace`
    ctx.textAlign = 'left'

    for (const db of dbSteps) {
      const normalized = (db - options.minDecibels) / (options.maxDecibels - options.minDecibels)
      const y = height - normalized * height

      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      ctx.fillText(`${db}dB`, 4 * dpr, y - 2 * dpr)
    }

    const freqSteps = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
    ctx.textAlign = 'center'

    for (const freq of freqSteps) {
      if (freq < minFrequency || freq > maxFrequency) continue

      let x: number
      if (options.scaleType === 'log') {
        const logMin = Math.log10(minFrequency)
        const logMax = Math.log10(maxFrequency)
        const logFreq = Math.log10(freq)
        x = ((logFreq - logMin) / (logMax - logMin)) * width
      } else {
        x = ((freq - minFrequency) / (maxFrequency - minFrequency)) * width
      }

      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()

      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`
      ctx.fillText(label, x, height - 4 * dpr)
    }
  }

  dispose(): void {
    this.stop()
    this.frameLoop.dispose()
    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
      this.unsubscribeSessionChange = null
    }

    if (isNativeAvailable()) {
      nativeSpectrum.reset()
    }
    this.resetJsState()
    this.lastSampleRate = 0
    this.emitPeakInfo(null)
  }
}

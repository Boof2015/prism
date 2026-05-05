import { audioRouter } from '../audio/AudioRouter'
import type { LUFSMeterMode, LUFSMeterReadout } from '../../types/lufsmeter'
import { resolveColorToRgb } from '../utils/color'
import { defaultVisualizerSessionSource, type VisualizerSessionSource } from './dataSource'
import { FrameScheduler } from './frameScheduler'
import { VisualizerFrameLoop } from './visualizerFrameLoop'
import {
  VUMeterBallistics,
  VU_METER_MIN_DB,
  type VUMeterSnapshot,
} from './vuMeterBallistics'

export interface LUFSMeterDataSource extends VisualizerSessionSource {
  getPendingLUFSMeterSamples: () => Array<{ left: Float32Array; right: Float32Array }>
}

export interface LUFSMeterOptions {
  mode?: LUFSMeterMode
  readout?: LUFSMeterReadout
  backgroundColor?: string
  lineColor?: string
  trackColor?: string
  targetColor?: string
  scaleColor?: string
  labelColor?: string
  dataSource?: LUFSMeterDataSource
  frameScheduler?: FrameScheduler
}

type ResolvedLUFSMeterOptions = Required<Omit<LUFSMeterOptions, 'dataSource' | 'frameScheduler'>>

const defaultOptions: ResolvedLUFSMeterOptions = {
  mode: 'bar',
  readout: 'shortTerm',
  backgroundColor: 'transparent',
  lineColor: '#38bdf8',
  trackColor: 'rgba(56, 189, 248, 0.08)',
  targetColor: 'rgba(56, 189, 248, 0.25)',
  scaleColor: 'rgba(255, 255, 255, 0.35)',
  labelColor: 'rgba(255, 255, 255, 0.8)',
}

const defaultLUFSMeterDataSource: LUFSMeterDataSource = {
  getPendingLUFSMeterSamples: () => audioRouter.flushPendingLUFSMeterSamples(),
  ...defaultVisualizerSessionSource,
}

function colorWithAlpha(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function relativeLuminanceChannel(channel: number): number {
  const normalized = Math.max(0, Math.min(255, channel)) / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---- Constants ----

const METER_MIN_LUFS = -60
const COMPACT_METER_MIN_DB = -50
const COMPACT_METER_MAX_DB = 0
const MOMENTARY_WINDOW_S = 0.4
const SHORT_TERM_WINDOW_S = 3.0
const INTEGRATED_BLOCK_S = 0.4
const INTEGRATED_HOP_S = 0.1
const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_OFFSET = -10
const TARGET_LUFS = -14
const SMOOTHING = 0.7
const INTEGRATED_HISTOGRAM_MIN_LUFS = ABSOLUTE_GATE_LUFS
const INTEGRATED_HISTOGRAM_MAX_LUFS = 10
const INTEGRATED_HISTOGRAM_BIN_WIDTH = 0.1
const INTEGRATED_HISTOGRAM_BIN_COUNT = Math.round(
  (INTEGRATED_HISTOGRAM_MAX_LUFS - INTEGRATED_HISTOGRAM_MIN_LUFS) / INTEGRATED_HISTOGRAM_BIN_WIDTH
) + 1

const INITIAL_VU_SNAPSHOT: VUMeterSnapshot = {
  vuLDb: VU_METER_MIN_DB,
  vuRDb: VU_METER_MIN_DB,
  barLDb: VU_METER_MIN_DB,
  barRDb: VU_METER_MIN_DB,
  peakLDb: VU_METER_MIN_DB,
  peakRDb: VU_METER_MIN_DB,
  correlation: 0,
}

// ---- K-weighting filter coefficients (ITU-R BS.1770) ----

interface BiquadCoeffs {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

// Pre-filter (high shelf) — 48kHz
const PRE_FILTER_48K: BiquadCoeffs = {
  b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285,
  a1: -1.69065929318241, a2: 0.73248077421585,
}

// RLB weighting (high pass) — 48kHz
const RLB_FILTER_48K: BiquadCoeffs = {
  b0: 1.0, b1: -2.0, b2: 1.0,
  a1: -1.99004745483398, a2: 0.99007225036621,
}

// Pre-filter — 44.1kHz
const PRE_FILTER_44K: BiquadCoeffs = {
  b0: 1.5308412300498355, b1: -2.6509799951536985, b2: 1.1690790799210956,
  a1: -1.6636551132560204, a2: 0.7125954280732254,
}

// RLB — 44.1kHz
const RLB_FILTER_44K: BiquadCoeffs = {
  b0: 1.0, b1: -2.0, b2: 1.0,
  a1: -1.9891696736297957, a2: 0.9891990357870394,
}

function getKWeightingCoeffs(sampleRate: number): { pre: BiquadCoeffs; rlb: BiquadCoeffs } {
  if (Math.abs(sampleRate - 44100) < 100) {
    return { pre: PRE_FILTER_44K, rlb: RLB_FILTER_44K }
  }
  // Default to 48kHz (also reasonable approximation for 96kHz, etc.)
  return { pre: PRE_FILTER_48K, rlb: RLB_FILTER_48K }
}

// ---- Biquad filter state ----

interface BiquadState {
  x1: number; x2: number
  y1: number; y2: number
}

function createBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 }
}

function applyBiquad(coeffs: BiquadCoeffs, state: BiquadState, input: number): number {
  const output = coeffs.b0 * input + coeffs.b1 * state.x1 + coeffs.b2 * state.x2
    - coeffs.a1 * state.y1 - coeffs.a2 * state.y2
  state.x2 = state.x1
  state.x1 = input
  state.y2 = state.y1
  state.y1 = output
  return output
}

function histogramIndexFromLufs(lufs: number): number {
  const normalized = (lufs - INTEGRATED_HISTOGRAM_MIN_LUFS) / INTEGRATED_HISTOGRAM_BIN_WIDTH
  return Math.max(0, Math.min(INTEGRATED_HISTOGRAM_BIN_COUNT - 1, Math.round(normalized)))
}

function histogramLufsAtIndex(index: number): number {
  return INTEGRATED_HISTOGRAM_MIN_LUFS + (index * INTEGRATED_HISTOGRAM_BIN_WIDTH)
}

// ---- Loudness meter class ----

export class LUFSMeter {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private options: ResolvedLUFSMeterOptions
  private dataSource: LUFSMeterDataSource
  private frameLoop: VisualizerFrameLoop
  private meterBallistics: VUMeterBallistics

  // K-weighting filter state (per channel, two stages)
  private preFilterL = createBiquadState()
  private preFilterR = createBiquadState()
  private rlbFilterL = createBiquadState()
  private rlbFilterR = createBiquadState()
  private currentSampleRate = 48000
  private kWeightingCoeffs = getKWeightingCoeffs(48000)

  // Ring buffer for K-weighted squared samples (sized for SHORT_TERM_WINDOW_S)
  private ringBufferL = new Float32Array(0)
  private ringBufferR = new Float32Array(0)
  private ringBufferPos = 0
  private ringBufferFilled = 0  // how many samples have been written total (capped at buffer size)

  // Integrated loudness: accumulate 400ms block mean-squares with 100ms hop
  private integratedBlockSumL = 0
  private integratedBlockSumR = 0
  private integratedBlockSamples = 0
  private integratedHopCounter = 0
  private integratedHistogramCounts = new Uint32Array(INTEGRATED_HISTOGRAM_BIN_COUNT)
  private integratedHistogramPowerSums = new Float64Array(INTEGRATED_HISTOGRAM_BIN_COUNT)

  // Smoothed display values
  private momentaryLUFS = METER_MIN_LUFS
  private shortTermLUFS = METER_MIN_LUFS
  private integratedLUFS = METER_MIN_LUFS
  private fastSnapshot: VUMeterSnapshot = { ...INITIAL_VU_SNAPSHOT }
  private unsubscribeSessionChange: (() => void) | null = null

  constructor(canvas: HTMLCanvasElement, options: LUFSMeterOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D context')
    this.ctx = ctx

    const { dataSource, frameScheduler, ...optionOverrides } = options
    this.options = { ...defaultOptions, ...optionOverrides }
    this.dataSource = dataSource ?? defaultLUFSMeterDataSource
    this.meterBallistics = new VUMeterBallistics(this.dataSource.getSampleRate())
    this.frameLoop = new VisualizerFrameLoop({
      frameScheduler,
      shouldRun: () => this.dataSource.isPlaying(),
      onFrame: this.drawFrame,
    })

    this.initRingBuffer(this.dataSource.getSampleRate())
    this.subscribeToSessionChanges()
  }

  private subscribeToSessionChanges(): void {
    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
    }
    this.unsubscribeSessionChange = this.dataSource.subscribeToSessionChanges(() => {
      this.resetMeters()
    })
  }

  private initRingBuffer(sampleRate: number): void {
    this.currentSampleRate = Math.max(1, sampleRate)
    this.kWeightingCoeffs = getKWeightingCoeffs(this.currentSampleRate)
    this.meterBallistics.reinitialize(this.currentSampleRate)
    const bufferSize = Math.ceil(this.currentSampleRate * SHORT_TERM_WINDOW_S)
    this.ringBufferL = new Float32Array(bufferSize)
    this.ringBufferR = new Float32Array(bufferSize)
    this.ringBufferPos = 0
    this.ringBufferFilled = 0
  }

  private resetMeters(): void {
    this.momentaryLUFS = METER_MIN_LUFS
    this.shortTermLUFS = METER_MIN_LUFS
    this.integratedLUFS = METER_MIN_LUFS
    this.meterBallistics.reset()
    this.fastSnapshot = this.meterBallistics.getSnapshot()
    this.ringBufferL.fill(0)
    this.ringBufferR.fill(0)
    this.ringBufferPos = 0
    this.ringBufferFilled = 0
    this.integratedBlockSumL = 0
    this.integratedBlockSumR = 0
    this.integratedBlockSamples = 0
    this.integratedHopCounter = 0
    this.integratedHistogramCounts.fill(0)
    this.integratedHistogramPowerSums.fill(0)
    this.preFilterL = createBiquadState()
    this.preFilterR = createBiquadState()
    this.rlbFilterL = createBiquadState()
    this.rlbFilterR = createBiquadState()
    this.invalidate()
  }

  setOptions(options: Partial<LUFSMeterOptions>): void {
    const { dataSource, frameScheduler: _frameScheduler, ...optionUpdates } = options
    this.options = { ...this.options, ...optionUpdates }
    if (dataSource && dataSource !== this.dataSource) {
      this.dataSource = dataSource
      this.subscribeToSessionChanges()
      this.initRingBuffer(this.dataSource.getSampleRate())
      this.resetMeters()
    }
    this.invalidate()
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
    // Canvas resize handled externally
    this.invalidate()
  }

  private processAudio(): void {
    const chunks = this.dataSource.getPendingLUFSMeterSamples()

    // Check if sample rate changed
    const sr = this.dataSource.getSampleRate()
    if (Math.abs(sr - this.currentSampleRate) > 100) {
      this.initRingBuffer(sr)
      this.resetMeters()
    }

    const playing = this.dataSource.isPlaying()

    if (!playing && chunks.length === 0) {
      this.meterBallistics.reset()
      this.fastSnapshot = this.meterBallistics.getSnapshot()
      // Decay toward silence only when truly stopped
      this.momentaryLUFS = this.momentaryLUFS * SMOOTHING + METER_MIN_LUFS * (1 - SMOOTHING)
      this.shortTermLUFS = this.shortTermLUFS * SMOOTHING + METER_MIN_LUFS * (1 - SMOOTHING)
      return
    }

    this.fastSnapshot = this.meterBallistics.process(chunks, performance.now())

    // Process any new audio chunks into the ring buffer
    if (chunks.length > 0) {
      const { pre, rlb } = this.kWeightingCoeffs
      const bufLen = this.ringBufferL.length
      const hopSamples = Math.round(this.currentSampleRate * INTEGRATED_HOP_S)
      const blockSamples = Math.round(this.currentSampleRate * INTEGRATED_BLOCK_S)

      for (const chunk of chunks) {
        const len = Math.min(chunk.left.length, chunk.right.length)
        for (let i = 0; i < len; i++) {
          // Apply K-weighting: pre-filter then RLB, per channel
          const kwL = applyBiquad(rlb, this.rlbFilterL, applyBiquad(pre, this.preFilterL, chunk.left[i]))
          const kwR = applyBiquad(rlb, this.rlbFilterR, applyBiquad(pre, this.preFilterR, chunk.right[i]))

          // Store squared K-weighted samples in ring buffer
          const sqL = kwL * kwL
          const sqR = kwR * kwR
          this.ringBufferL[this.ringBufferPos] = sqL
          this.ringBufferR[this.ringBufferPos] = sqR
          this.ringBufferPos = (this.ringBufferPos + 1) % bufLen
          if (this.ringBufferFilled < bufLen) this.ringBufferFilled++

          // Accumulate for integrated measurement
          this.integratedBlockSumL += sqL
          this.integratedBlockSumR += sqR
          this.integratedBlockSamples++
          this.integratedHopCounter++

          // Every hop interval, store a block loudness value
          if (this.integratedHopCounter >= hopSamples && this.integratedBlockSamples >= blockSamples) {
            const meanSqL = this.integratedBlockSumL / this.integratedBlockSamples
            const meanSqR = this.integratedBlockSumR / this.integratedBlockSamples
            const blockPower = Math.max(meanSqL + meanSqR, 1e-10)
            const blockLUFS = -0.691 + 10 * Math.log10(blockPower)
            if (blockLUFS > ABSOLUTE_GATE_LUFS) {
              const histogramIndex = histogramIndexFromLufs(blockLUFS)
              this.integratedHistogramCounts[histogramIndex] += 1
              this.integratedHistogramPowerSums[histogramIndex] += blockPower
            }

            // Slide the block window: remove oldest hop worth of samples
            // Approximate by keeping a running sum and subtracting the hop fraction
            const hopFraction = hopSamples / this.integratedBlockSamples
            this.integratedBlockSumL *= (1 - hopFraction)
            this.integratedBlockSumR *= (1 - hopFraction)
            this.integratedBlockSamples = Math.round(this.integratedBlockSamples * (1 - hopFraction))
            this.integratedHopCounter = 0
          }
        }
      }
    }

    // Always compute M/S from the ring buffer (it persists across frames)
    const bufLen = this.ringBufferL.length

    // Compute momentary loudness (last 400ms)
    const momentarySamples = Math.min(
      Math.round(this.currentSampleRate * MOMENTARY_WINDOW_S),
      this.ringBufferFilled
    )
    if (momentarySamples > 0) {
      let sumL = 0, sumR = 0
      for (let i = 0; i < momentarySamples; i++) {
        const idx = (this.ringBufferPos - 1 - i + bufLen) % bufLen
        sumL += this.ringBufferL[idx]
        sumR += this.ringBufferR[idx]
      }
      const rawM = -0.691 + 10 * Math.log10(Math.max(sumL / momentarySamples + sumR / momentarySamples, 1e-10))
      this.momentaryLUFS = this.momentaryLUFS * SMOOTHING + Math.max(METER_MIN_LUFS, rawM) * (1 - SMOOTHING)
    }

    // Compute short-term loudness (last 3s)
    const shortTermSamples = Math.min(
      Math.round(this.currentSampleRate * SHORT_TERM_WINDOW_S),
      this.ringBufferFilled
    )
    if (shortTermSamples > 0) {
      let sumL = 0, sumR = 0
      for (let i = 0; i < shortTermSamples; i++) {
        const idx = (this.ringBufferPos - 1 - i + bufLen) % bufLen
        sumL += this.ringBufferL[idx]
        sumR += this.ringBufferR[idx]
      }
      const rawS = -0.691 + 10 * Math.log10(Math.max(sumL / shortTermSamples + sumR / shortTermSamples, 1e-10))
      this.shortTermLUFS = this.shortTermLUFS * SMOOTHING + Math.max(METER_MIN_LUFS, rawS) * (1 - SMOOTHING)
    }

    // Compute integrated loudness with gating
    this.integratedLUFS = this.computeGatedIntegratedLoudness()
  }

  private computeGatedIntegratedLoudness(): number {
    let absoluteCount = 0
    let absolutePowerSum = 0
    for (let index = 0; index < this.integratedHistogramCounts.length; index += 1) {
      const count = this.integratedHistogramCounts[index]
      if (count === 0) {
        continue
      }
      absoluteCount += count
      absolutePowerSum += this.integratedHistogramPowerSums[index]
    }
    if (absoluteCount === 0 || absolutePowerSum <= 0) {
      return METER_MIN_LUFS
    }

    const ungatedMean = -0.691 + 10 * Math.log10(absolutePowerSum / absoluteCount)
    const relativeThreshold = ungatedMean + RELATIVE_GATE_OFFSET

    let relativeCount = 0
    let relativePowerSum = 0
    for (let index = 0; index < this.integratedHistogramCounts.length; index += 1) {
      const count = this.integratedHistogramCounts[index]
      if (count === 0) {
        continue
      }
      if (histogramLufsAtIndex(index) <= relativeThreshold) {
        continue
      }
      relativeCount += count
      relativePowerSum += this.integratedHistogramPowerSums[index]
    }
    if (relativeCount === 0 || relativePowerSum <= 0) {
      return METER_MIN_LUFS
    }

    return Math.max(METER_MIN_LUFS, -0.691 + 10 * Math.log10(relativePowerSum / relativeCount))
  }

  private drawFrame = (): void => {
    const { canvas, ctx, options } = this
    const width = canvas.width
    const height = canvas.height

    if (width <= 0 || height <= 0) {
      return
    }

    this.processAudio()

    ctx.clearRect(0, 0, width, height)
    if (options.backgroundColor !== 'transparent') {
      ctx.fillStyle = options.backgroundColor
      ctx.fillRect(0, 0, width, height)
    }

    this.drawBars(width, height)
  }

  private selectedLufs(): number {
    switch (this.options.readout) {
      case 'momentary':
        return this.momentaryLUFS
      case 'shortTerm':
        return this.shortTermLUFS
      case 'integrated':
      default:
        return this.integratedLUFS
    }
  }

  private compactDbToNormalized(db: number): number {
    const clamped = Math.max(COMPACT_METER_MIN_DB, Math.min(COMPACT_METER_MAX_DB, db))
    return (clamped - COMPACT_METER_MIN_DB) / (COMPACT_METER_MAX_DB - COMPACT_METER_MIN_DB)
  }

  private contrastForLevelColor(): string {
    const { r, g, b } = resolveColorToRgb(this.options.lineColor)
    const luminance = 0.2126 * relativeLuminanceChannel(r)
      + 0.7152 * relativeLuminanceChannel(g)
      + 0.0722 * relativeLuminanceChannel(b)
    return contrastRatio(luminance, 0) >= contrastRatio(luminance, 1)
      ? 'rgba(0, 0, 0, 0.9)'
      : 'rgba(255, 255, 255, 0.94)'
  }

  private resolveReadoutTextLayout(
    candidates: string[],
    maxWidth: number,
    maxFontSize: number,
    minFontSize: number,
  ): { text: string; fontSize: number } {
    const ctx = this.ctx
    for (const text of candidates) {
      ctx.font = `800 ${maxFontSize}px "JetBrains Mono", "SF Mono", monospace`
      const measuredWidth = ctx.measureText(text).width
      if (measuredWidth <= maxWidth) {
        return { text, fontSize: maxFontSize }
      }

      const scaledFontSize = Math.floor(maxFontSize * (maxWidth / Math.max(1, measuredWidth)))
      if (scaledFontSize >= minFontSize) {
        return { text, fontSize: scaledFontSize }
      }
    }

    return {
      text: candidates[candidates.length - 1] ?? '',
      fontSize: minFontSize,
    }
  }

  private drawFastPeakBar(
    x: number,
    y: number,
    width: number,
    height: number,
    levelDb: number,
    peakDb: number,
    tint: { r: number; g: number; b: number },
    dpr: number,
  ): void {
    const ctx = this.ctx
    const barBottom = y + height
    const levelHeight = Math.round(this.compactDbToNormalized(levelDb) * height)

    ctx.fillStyle = this.options.trackColor
    ctx.fillRect(x, y, width, height)

    if (levelHeight > 0) {
      ctx.fillStyle = colorWithAlpha(tint.r, tint.g, tint.b, 0.88)
      ctx.fillRect(x, barBottom - levelHeight, width, levelHeight)
    }

    const peakNorm = this.compactDbToNormalized(peakDb)
    if (peakNorm > 0.001) {
      const peakY = Math.round(barBottom - peakNorm * height)
      ctx.fillStyle = `rgb(${tint.r}, ${tint.g}, ${tint.b})`
      ctx.fillRect(x, peakY, width, Math.max(1, Math.round(2 * dpr)))
    }
  }

  private drawBars(width: number, height: number): void {
    const ctx = this.ctx
    const tint = resolveColorToRgb(this.options.lineColor)
    const dpr = window.devicePixelRatio || 1

    const paddingX = Math.max(Math.round(4 * dpr), Math.floor(width * 0.012))
    const paddingY = Math.max(Math.round(4 * dpr), Math.floor(height * 0.025))
    const meterTop = paddingY
    const meterBottom = height - paddingY
    const meterHeight = Math.max(1, meterBottom - meterTop)
    const scaleWidth = Math.max(Math.round(26 * dpr), Math.min(Math.round(42 * dpr), Math.floor(width * 0.16)))
    const barWidth = Math.max(Math.round(6 * dpr), Math.min(Math.round(14 * dpr), Math.floor(width * 0.04)))
    const barGap = Math.max(Math.round(3 * dpr), Math.floor(width * 0.012))
    const lufsBarGap = Math.max(Math.round(5 * dpr), Math.floor(width * 0.018))
    const lufsBarWidth = Math.max(Math.round(12 * dpr), Math.min(Math.round(28 * dpr), Math.floor(width * 0.07)))
    const tagGap = Math.max(Math.round(8 * dpr), Math.floor(width * 0.025))
    const leftBarX = paddingX + scaleWidth
    const rightBarX = leftBarX + barWidth + barGap
    const lufsBarX = rightBarX + barWidth + lufsBarGap
    const tagX = lufsBarX + lufsBarWidth + tagGap
    const tagWidth = Math.max(1, width - paddingX - tagX)
    const meterRight = tagX + tagWidth

    this.drawFastPeakBar(
      leftBarX,
      meterTop,
      barWidth,
      meterHeight,
      this.fastSnapshot.barLDb,
      this.fastSnapshot.peakLDb,
      tint,
      dpr,
    )
    this.drawFastPeakBar(
      rightBarX,
      meterTop,
      barWidth,
      meterHeight,
      this.fastSnapshot.barRDb,
      this.fastSnapshot.peakRDb,
      tint,
      dpr,
    )

    const selectedLufs = this.selectedLufs()
    const loudnessNorm = this.compactDbToNormalized(selectedLufs)
    const loudnessY = Math.round(meterBottom - loudnessNorm * meterHeight)
    const lufsBarHeight = Math.round(loudnessNorm * meterHeight)

    ctx.fillStyle = this.options.trackColor
    ctx.fillRect(lufsBarX, meterTop, lufsBarWidth, meterHeight)
    if (lufsBarHeight > 0) {
      ctx.fillStyle = this.options.lineColor
      ctx.fillRect(lufsBarX, meterBottom - lufsBarHeight, lufsBarWidth, lufsBarHeight)
      ctx.fillRect(lufsBarX, loudnessY, lufsBarWidth, Math.max(1, Math.round(2 * dpr)))
    }

    const targetY = Math.round(meterBottom - this.compactDbToNormalized(TARGET_LUFS) * meterHeight)
    ctx.fillStyle = this.options.targetColor
    ctx.fillRect(leftBarX, targetY, Math.max(1, meterRight - leftBarX), Math.max(1, Math.round(dpr)))

    const tickValues = [0, -6, -12, -24, -36, -50]
    const tickMarkWidth = Math.max(4, Math.round(8 * dpr))
    const tickFontSize = Math.max(Math.round(8 * dpr), Math.min(Math.round(15 * dpr), Math.floor(height * 0.06)))
    ctx.font = `600 ${tickFontSize}px "JetBrains Mono", "SF Mono", monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = this.options.scaleColor
    for (const tick of tickValues) {
      const y = Math.round(meterBottom - this.compactDbToNormalized(tick) * meterHeight)
      const labelY = Math.max(
        meterTop + tickFontSize / 2,
        Math.min(meterBottom - tickFontSize / 2, y),
      )
      ctx.fillText(`${Math.abs(tick)}`, paddingX + scaleWidth - Math.round(8 * dpr), labelY)
      ctx.fillRect(paddingX + scaleWidth - tickMarkWidth, y, tickMarkWidth, Math.max(1, Math.round(dpr)))
    }

    const displayValue = selectedLufs <= METER_MIN_LUFS + 1
      ? '-∞'
      : selectedLufs.toFixed(1)
    const displayCandidates = [
      `${displayValue}LUFS`,
      displayValue,
    ]
    const tagHeight = Math.min(
      meterHeight,
      Math.max(Math.round(22 * dpr), Math.min(Math.round(34 * dpr), Math.floor(height * 0.16))),
    )
    const tagY = Math.round(Math.max(meterTop, Math.min(meterBottom - tagHeight, loudnessY - tagHeight / 2)))
    const tagPadding = Math.max(Math.round(4 * dpr), Math.min(Math.round(8 * dpr), Math.floor(tagWidth * 0.08)))
    const maxReadoutFontSize = Math.max(
      Math.round(10 * dpr),
      Math.min(Math.round(20 * dpr), Math.floor(tagHeight * 0.52)),
    )
    const minReadoutFontSize = Math.min(maxReadoutFontSize, Math.max(Math.round(7 * dpr), Math.floor(tagHeight * 0.38)))
    const readoutLayout = this.resolveReadoutTextLayout(
      displayCandidates,
      Math.max(1, tagWidth - tagPadding * 2),
      maxReadoutFontSize,
      minReadoutFontSize,
    )

    ctx.fillStyle = this.options.lineColor
    ctx.fillRect(tagX, tagY, tagWidth, tagHeight)

    ctx.font = `800 ${readoutLayout.fontSize}px "JetBrains Mono", "SF Mono", monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = this.contrastForLevelColor()
    ctx.fillText(readoutLayout.text, tagX + tagPadding, tagY + tagHeight / 2)
  }

  dispose(): void {
    this.stop()
    this.frameLoop.dispose()
    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
      this.unsubscribeSessionChange = null
    }
  }
}

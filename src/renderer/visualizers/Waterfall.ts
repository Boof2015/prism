import { audioRouter } from '../audio/AudioRouter'
import { waterfall as nativeWaterfall } from '../audio/native'
import { frequencyBoundsForRange, buildFrequencyGuides } from '../../types/frequencyScale'
import { DEFAULT_WATERFALL_SETTINGS, normalizeWaterfallSettings, type WaterfallAudioChunk, type WaterfallFrame, type WaterfallNativeAnalyzer, type WaterfallSettings } from '../../types/waterfall'
import { defaultVisualizerSessionSource, type VisualizerSessionSource } from './dataSource'
import type { FrameScheduler } from './frameScheduler'
import { VisualizerFrameLoop } from './visualizerFrameLoop'
import { parseColorToRgba } from '../utils/color'
import { normalizeHeatDb } from './heatScale'
import { softenWaterfallSpectra, waterfallRidgeHeight, waterfallPlotLayout } from './waterfallPlot'

export interface WaterfallDataSource extends VisualizerSessionSource {
  getPendingWaterfallSamples(): WaterfallAudioChunk[]
}
export interface WaterfallOptions extends Partial<WaterfallSettings> {
  lineColor?: string
  backgroundColor?: string
  gridColor?: string
  labelColor?: string
  heatColors?: [string, string, string]
  dataSource?: WaterfallDataSource
  frameScheduler?: FrameScheduler
  nativeAnalyzer?: WaterfallNativeAnalyzer
}
const defaultSource: WaterfallDataSource = {
  ...defaultVisualizerSessionSource,
  getPendingWaterfallSamples: () => audioRouter.flushPendingWaterfallSamples(),
}
const defaults = {
  ...DEFAULT_WATERFALL_SETTINGS,
  lineColor: '#00ffff', backgroundColor: 'transparent', gridColor: 'rgba(128,128,128,0.25)', labelColor: '#999999',
  heatColors: ['#0f0721', '#a31a79', '#fff1d1'] as [string, string, string],
}
type DrawOptions = typeof defaults

function heatPalette(colors: [string, string, string]): string[] {
  const stops = colors.map((color) => parseColorToRgba(color) ?? { r: 0, g: 255, b: 255, a: 1 })
  return Array.from({ length: 256 }, (_, index) => {
    const t = index / 255 * 2
    const a = stops[t < 1 ? 0 : 1], b = stops[t < 1 ? 1 : 2]
    const mix = t < 1 ? t : t - 1
    return `rgb(${Math.round(a.r + (b.r - a.r) * mix)},${Math.round(a.g + (b.g - a.g) * mix)},${Math.round(a.b + (b.b - a.b) * mix)})`
  })
}

export class Waterfall {
  private readonly ctx: CanvasRenderingContext2D
  private readonly traces: HTMLCanvasElement
  private readonly traceContext: CanvasRenderingContext2D
  private readonly loop: VisualizerFrameLoop
  private readonly analyzer: WaterfallNativeAnalyzer
  private source: WaterfallDataSource
  private options: DrawOptions
  private unsubscribe: (() => void) | null = null
  private configKey = ''
  private lastSequence: number | undefined
  private sessionActive = false
  private palette: string[]

  constructor(private readonly canvas: HTMLCanvasElement, options: WaterfallOptions = {}) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get waterfall 2D context')
    this.ctx = ctx
    this.traces = document.createElement('canvas')
    this.traceContext = this.traces.getContext('2d')!
    this.options = { ...defaults, ...options, ...normalizeWaterfallSettings(options) }
    this.palette = heatPalette(this.options.heatColors)
    this.source = options.dataSource ?? defaultSource
    this.analyzer = options.nativeAnalyzer ?? nativeWaterfall
    this.loop = new VisualizerFrameLoop({ frameScheduler: options.frameScheduler, shouldRun: () => this.sessionActive && this.source.isPlaying(), onFrame: this.draw })
    this.attachSession()
  }

  private attachSession(): void {
    this.unsubscribe?.()
    let sessionId: number | undefined
    let sampleRate: number | undefined
    this.unsubscribe = this.source.subscribeToSessionChanges((state) => {
      this.sessionActive = state.capturing && !state.suspended
      if (sessionId !== state.sessionId || sampleRate !== state.sampleRate) {
        this.analyzer.reset()
        this.lastSequence = undefined
        this.configKey = ''
      }
      sessionId = state.sessionId
      sampleRate = state.sampleRate
      this.loop.invalidate()
    })
  }
  start(): void { this.loop.start() }
  stop(): void { this.loop.stop() }
  resize(): void { this.loop.invalidate() }
  dispose(): void { this.unsubscribe?.(); this.loop.dispose() }
  setOptions(options: WaterfallOptions): void {
    this.options = { ...this.options, ...options, ...normalizeWaterfallSettings({ ...this.options, ...options }) }
    this.palette = heatPalette(this.options.heatColors)
    if (options.dataSource && options.dataSource !== this.source) {
      this.source = options.dataSource
      this.attachSession()
    }
    this.loop.invalidate()
  }

  private draw = (): void => {
    const o = this.options
    const range = frequencyBoundsForRange(o.frequencyRangeMode, this.source.getSampleRate())
    const config = { sampleRate: this.source.getSampleRate(), fftSize: o.fftSize, historySeconds: o.historySeconds,
      smoothing: o.smoothing, tiltDbPerOctave: o.tiltDbPerOctave, scaleMode: o.scaleMode, ...range }
    const key = JSON.stringify(config)
    if (key !== this.configKey) { this.analyzer.configure(config); this.configKey = key }
    if (this.sessionActive && this.source.isPlaying()) {
      for (const chunk of this.source.getPendingWaterfallSamples()) {
        // A cleared history visibly separates audio across an overrun or capture gap.
        if (chunk.sequence && this.lastSequence && chunk.sequence !== this.lastSequence + 1) this.analyzer.reset()
        if (chunk.sequence) this.lastSequence = chunk.sequence
        this.analyzer.processStereo(chunk.left, chunk.right)
      }
    }
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.width / dpr, height = this.canvas.height / dpr
    if (width <= 0 || height <= 0) return
    const layout = waterfallPlotLayout(height, o.density, o.showGrid)
    const frame = this.analyzer.getFrame(layout.ridgeCount, Math.max(2, Math.min(512, Math.round(width))))
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = o.backgroundColor
    ctx.fillRect(0, 0, width, height)
    if (!frame) {
      ctx.fillStyle = o.labelColor
      ctx.font = '12px sans-serif'
      ctx.fillText('Waterfall requires the native audio module', 10, 22)
      return
    }
    this.paintRidges(frame, layout, width, height, dpr)
    if (!o.showGrid || width < 90 || height < 55) return
    const left = width >= 240 ? 36 : 12, right = width - 12
    const rulerY = layout.bottom + 3
    const showHistory = width >= 240 && height >= 80
    const backY = layout.bottom - layout.historyHeight
    ctx.save()
    ctx.font = '10px monospace'
    ctx.lineWidth = 1
    ctx.fillStyle = o.labelColor
    ctx.strokeStyle = o.gridColor
    // Keep the rulers at the edges: interior grid lines can be mistaken for
    // spectrum history. The corner anchors the front edge to the present.
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    if (showHistory) { ctx.moveTo(left - 1, backY); ctx.lineTo(left - 1, rulerY) }
    else ctx.moveTo(left - 1, rulerY)
    ctx.lineTo(right, rulerY)
    ctx.stroke()
    ctx.globalAlpha = 1

    // Short ruler marks need the label contrast; the subdued grid color is
    // intended for long lines and made intermediate ticks almost invisible.
    ctx.strokeStyle = o.labelColor
    ctx.lineWidth = 1.25
    ctx.textAlign = 'center'
    const guides = buildFrequencyGuides(range.minFrequency, range.maxFrequency, o.scaleMode, right - left)
    let labelRight = left - 4
    let lastTickX = left - 8
    for (const guide of guides) {
      const x = left + guide.normalizedPosition * (right - left)
      if (x - lastTickX < 4) continue
      lastTickX = x
      const major = guide.kind === 'major'
      ctx.globalAlpha = major ? 1 : 0.85
      ctx.beginPath(); ctx.moveTo(x, rulerY); ctx.lineTo(x, rulerY + (major ? 6 : 4)); ctx.stroke()
      if (!guide.label) continue
      const halfWidth = ctx.measureText(guide.label).width / 2
      const labelX = Math.max(left + halfWidth, Math.min(right - halfWidth, x))
      if (labelX - halfWidth < labelRight + 12) continue
      ctx.globalAlpha = 1
      ctx.fillText(guide.label, labelX, layout.bottom + 18)
      labelRight = labelX + halfWidth
    }

    ctx.globalAlpha = 1
    if (width >= 240) {
      ctx.textAlign = 'right'
      ctx.font = '9px monospace'
      ctx.fillText('Hz', left - 8, layout.bottom + 18)
    }
    if (showHistory) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const fractions = layout.historyHeight >= 100 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]
      for (const fraction of fractions) {
        const y = layout.bottom - fraction * layout.historyHeight
        const major = fraction === 0 || fraction === 1 || (fraction === 0.5 && layout.historyHeight >= 70)
        ctx.globalAlpha = major ? 1 : 0.85
        ctx.beginPath(); ctx.moveTo(left - (major ? 7 : 5), y); ctx.lineTo(left - 1, y); ctx.stroke()
        if (!major) continue
        ctx.globalAlpha = 1
        ctx.font = fraction === 0 ? '600 9px monospace' : '10px monospace'
        const label = fraction === 0 ? 'NOW' : `${Number((fraction * o.historySeconds).toFixed(1))}s`
        ctx.fillText(label, left - 9, y)
      }
    }
    ctx.restore()
  }

  private paintRidges(frame: WaterfallFrame, layout: ReturnType<typeof waterfallPlotLayout>, width: number, height: number, dpr: number): void {
    if (this.traces.width !== this.canvas.width || this.traces.height !== this.canvas.height) {
      this.traces.width = this.canvas.width; this.traces.height = this.canvas.height
    }
    const ctx = this.traceContext, o = this.options
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const left = o.showGrid && width >= 240 ? 36 : 12, right = width - 12
    const levels = softenWaterfallSpectra(frame)
    const xs = Array.from({ length: frame.columns }, (_, i) => left + i / (frame.columns - 1) * (right - left))
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    for (let ridge = frame.ages.length - 1; ridge >= 0; --ridge) {
      const depth = Math.min(1, frame.ages[ridge] / o.historySeconds)
      const baseline = layout.bottom - depth * layout.historyHeight
      const ys = xs.map((_, column) => baseline - waterfallRidgeHeight(levels[ridge * frame.columns + column], layout.amplitude))
      const path = new Path2D()
      path.moveTo(xs[0], ys[0])
      for (let x = 1; x < xs.length; x++) path.lineTo(xs[x], ys[x])
      // Erase older traces beneath this ridge on a transparent layer; never paint an opaque backdrop.
      const mask = new Path2D(path)
      mask.lineTo(xs[xs.length - 1], height); mask.lineTo(xs[0], height); mask.closePath()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fill(mask)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.16 + 0.84 * Math.pow(1 - depth, 1.4)
      ctx.lineWidth = ridge === 0 ? 1.4 : 1
      if (o.colorMode === 'theme') {
        ctx.strokeStyle = o.lineColor
        ctx.stroke(path)
      } else {
        // Batch similarly colored segments to avoid a canvas stroke per FFT column.
        const coloredPaths: Array<Path2D | undefined> = new Array(64)
        for (let x = 1; x < xs.length; ++x) {
          const db = (levels[ridge * frame.columns + x - 1] + levels[ridge * frame.columns + x]) / 2
          const colorIndex = Math.min(63, Math.floor(normalizeHeatDb(db) * 64))
          const coloredPath = coloredPaths[colorIndex] ??= new Path2D()
          coloredPath.moveTo(xs[x - 1], ys[x - 1])
          coloredPath.lineTo(xs[x], ys[x])
        }
        for (let colorIndex = 0; colorIndex < coloredPaths.length; ++colorIndex) {
          const coloredPath = coloredPaths[colorIndex]
          if (!coloredPath) continue
          ctx.strokeStyle = this.palette[Math.min(255, colorIndex * 4 + 2)]
          ctx.stroke(coloredPath)
        }
      }
    }
    ctx.globalAlpha = 1
    this.ctx.drawImage(this.traces, 0, 0, width, height)
  }
}

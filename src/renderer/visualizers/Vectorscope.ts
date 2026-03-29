import { audioRouter } from '../audio/AudioRouter'
import { vectorscope as nativeVectorscope, isNativeAvailable } from '../audio/native'
import { transformPoint, drawVectorscopeGridForMode, getVectorscopeLayout } from './vectorscopeGrids'
import { MultibandSplitter, MultibandBuffer } from './multibandSplitter'
import { defaultVisualizerSessionSource, type VisualizerSessionSource } from './dataSource'
import { FrameScheduler } from './frameScheduler'
import { VisualizerFrameLoop } from './visualizerFrameLoop'

export type VectorscopeMode = 'lissajous' | 'polar-unipolar' | 'polar-bipolar' | 'linear-unipolar' | 'linear-bipolar'

export interface VectorscopeDataSource extends VisualizerSessionSource {
  getPendingVectorscopeSamples: () => Array<{ left: Float32Array; right: Float32Array }>
}

export interface VectorscopeOptions {
  lineColor?: string
  lineWidth?: number
  backgroundColor?: string
  showGrid?: boolean
  gridColor?: string
  bandColors?: {
    low: string
    mid: string
    high: string
  }
  persistence?: number
  displayPoints?: number
  mode?: VectorscopeMode
  multiband?: boolean
  dataSource?: VectorscopeDataSource
  frameScheduler?: FrameScheduler
}

type ResolvedVectorscopeOptions = Required<Omit<VectorscopeOptions, 'dataSource' | 'frameScheduler'>>

const defaultOptions: ResolvedVectorscopeOptions = {
  lineColor: '#00ffff',
  lineWidth: 1.5,
  backgroundColor: 'transparent',
  showGrid: true,
  gridColor: 'rgba(255, 255, 255, 0.1)',
  bandColors: {
    low: '#ff4444',
    mid: '#44dd44',
    high: '#4488ff',
  },
  persistence: 0.10,
  displayPoints: 4096,
  mode: 'lissajous',
  multiband: false,
}

const defaultVectorscopeDataSource: VectorscopeDataSource = {
  getPendingVectorscopeSamples: () => audioRouter.flushPendingVectorscopeSamples(),
  ...defaultVisualizerSessionSource,
}

const BAND_ORDER = ['low', 'mid', 'high'] as const

export class Vectorscope {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private offscreenCanvas: HTMLCanvasElement
  private offscreenCtx: CanvasRenderingContext2D
  private staticLayerCanvas: HTMLCanvasElement
  private staticLayerCtx: CanvasRenderingContext2D
  private options: ResolvedVectorscopeOptions
  private dataSource: VectorscopeDataSource
  private frameLoop: VisualizerFrameLoop
  private nativeInitialized = false
  private lastSampleRate = 0
  private unsubscribeSessionChange: (() => void) | null = null
  private splitter: MultibandSplitter = new MultibandSplitter()
  private multibandBuffer: MultibandBuffer = new MultibandBuffer()
  private staticLayerKey = ''

  constructor(canvas: HTMLCanvasElement, options: VectorscopeOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D context')
    this.ctx = ctx

    const { dataSource, frameScheduler, ...optionOverrides } = options
    this.options = { ...defaultOptions, ...optionOverrides }
    this.dataSource = dataSource ?? defaultVectorscopeDataSource
    this.frameLoop = new VisualizerFrameLoop({
      frameScheduler,
      shouldRun: () => this.dataSource.isPlaying(),
      onFrame: this.drawFrame,
    })

    this.offscreenCanvas = document.createElement('canvas')
    this.offscreenCanvas.width = canvas.width
    this.offscreenCanvas.height = canvas.height
    const offCtx = this.offscreenCanvas.getContext('2d')
    if (!offCtx) throw new Error('Could not get offscreen 2D context')
    this.offscreenCtx = offCtx
    this.staticLayerCanvas = document.createElement('canvas')
    const staticLayerCtx = this.staticLayerCanvas.getContext('2d')
    if (!staticLayerCtx) throw new Error('Could not get static offscreen 2D context')
    this.staticLayerCtx = staticLayerCtx

    this.initNative()
    this.subscribeToSessionChanges()
  }

  private subscribeToSessionChanges(): void {
    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
    }
    this.unsubscribeSessionChange = this.dataSource.subscribeToSessionChanges(() => {
      this.resetDisplay()
    })
  }

  private initNative(): void {
    if (isNativeAvailable() && !this.nativeInitialized) {
      const sampleRate = this.dataSource.getSampleRate()
      this.lastSampleRate = sampleRate
      nativeVectorscope.setSampleRate(sampleRate)
      this.nativeInitialized = true
      console.log(`Vectorscope: Using native DSP (${sampleRate}Hz)`)
    } else if (!isNativeAvailable()) {
      console.log('Vectorscope: Using JavaScript fallback')
    }
  }

  private updateSampleRateIfNeeded(): void {
    const currentRate = this.dataSource.getSampleRate()
    if (currentRate !== this.lastSampleRate && currentRate > 0) {
      this.lastSampleRate = currentRate
      if (isNativeAvailable()) {
        nativeVectorscope.setSampleRate(currentRate)
      }
      this.splitter.configure(currentRate)
    }
  }

  private resetDisplay(): void {
    if (isNativeAvailable()) {
      nativeVectorscope.reset()
    }
    this.splitter.reset()
    this.multibandBuffer.reset()
    this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
    this.invalidate()
  }

  setOptions(options: Partial<VectorscopeOptions>): void {
    const { dataSource, frameScheduler: _frameScheduler, ...optionUpdates } = options
    this.options = { ...this.options, ...optionUpdates }
    if (dataSource && dataSource !== this.dataSource) {
      this.dataSource = dataSource
      this.subscribeToSessionChanges()
      this.resetDisplay()
    }
    this.staticLayerKey = ''
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
    this.staticLayerKey = ''
    this.invalidate()
  }

  private drawFrame = (): void => {
    const { canvas, ctx, offscreenCanvas, offscreenCtx, options } = this
    const width = canvas.width
    const height = canvas.height
    if (width <= 0 || height <= 0) return

    const isPolar = options.mode === 'polar-unipolar' || options.mode === 'polar-bipolar'
    const visualGain = isPolar ? 1.2 : 1.5
    const layout = getVectorscopeLayout(width, height, options.mode)
    const centerX = layout.centerX
    const centerY = layout.centerY
    const scale = layout.radius * visualGain

    if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
      offscreenCanvas.width = width
      offscreenCanvas.height = height
    }

    this.updateSampleRateIfNeeded()

    if (!this.dataSource.isPlaying()) {
      this.renderStaticLayer()
      return
    }

    offscreenCtx.globalCompositeOperation = 'destination-in'
    offscreenCtx.fillStyle = `rgba(255, 255, 255, ${options.persistence})`
    offscreenCtx.fillRect(0, 0, width, height)
    offscreenCtx.globalCompositeOperation = 'source-over'

    const nativeTransport = this.dataSource.getNativeVisualizerTransport?.() ?? null
    const pendingSamples = this.dataSource.getPendingVectorscopeSamples()

    if (options.multiband) {
      this.drawMultibandPoints(offscreenCtx, pendingSamples, centerX, centerY, scale)
    } else if (isNativeAvailable()) {
      if (!nativeTransport) {
        for (const chunk of pendingSamples) {
          nativeVectorscope.pushSamples(chunk.left, chunk.right)
        }
      }

      const pointsResult = nativeVectorscope.getPoints(options.displayPoints)
      if (pointsResult && pointsResult.count > 0) {
        this.drawPoints(offscreenCtx, pointsResult.x, pointsResult.y, pointsResult.count, centerX, centerY, scale)
      }
    } else {
      this.drawFallbackPoints(offscreenCtx, pendingSamples, centerX, centerY, scale)
    }

    this.renderStaticLayer()
    ctx.drawImage(offscreenCanvas, 0, 0)
  }

  private renderStaticLayer(): void {
    this.ensureStaticLayer()
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.drawImage(this.staticLayerCanvas, 0, 0)
  }

  private ensureStaticLayer(): void {
    const { canvas, options } = this
    const key = [
      canvas.width,
      canvas.height,
      options.backgroundColor,
      options.showGrid,
      options.gridColor,
      options.mode,
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
      const dpr = window.devicePixelRatio || 1
      drawVectorscopeGridForMode(this.staticLayerCtx, canvas.width, canvas.height, options.gridColor, options.mode, dpr)
    }

    this.staticLayerKey = key
  }

  private drawPoints(
    ctx: CanvasRenderingContext2D,
    x: Float32Array,
    y: Float32Array,
    count: number,
    centerX: number,
    centerY: number,
    scale: number
  ): void {
    const { options } = this
    const mode = options.mode
    const dpr = window.devicePixelRatio || 1
    const dotSize = options.lineWidth * dpr

    const segments = 8
    const pointsPerSegment = Math.ceil(count / segments)

    for (let seg = 0; seg < segments; seg++) {
      const startIdx = seg * pointsPerSegment
      const endIdx = Math.min((seg + 1) * pointsPerSegment, count)
      if (startIdx >= count) break

      const alpha = 0.15 + 0.85 * (seg / Math.max(segments - 1, 1))

      ctx.fillStyle = options.lineColor
      ctx.globalAlpha = alpha

      for (let i = startIdx; i < endIdx; i++) {
        const point = transformPoint(y[i], x[i], mode)
        if (!point) continue

        const px = centerX + point.dx * scale
        const py = centerY - point.dy * scale
        ctx.fillRect(px - dotSize / 2, py - dotSize / 2, dotSize, dotSize)
      }
    }
    ctx.globalAlpha = 1.0
  }

  private drawFallbackPoints(
    ctx: CanvasRenderingContext2D,
    pendingSamples: { left: Float32Array; right: Float32Array }[],
    centerX: number,
    centerY: number,
    scale: number
  ): void {
    if (pendingSamples.length === 0) return

    const { options } = this
    const mode = options.mode
    const dpr = window.devicePixelRatio || 1
    const dotSize = options.lineWidth * dpr

    ctx.fillStyle = options.lineColor
    ctx.globalAlpha = 0.8

    for (const chunk of pendingSamples) {
      for (let i = 0; i < chunk.left.length; i++) {
        const point = transformPoint(chunk.left[i], chunk.right[i], mode)
        if (!point) continue

        const px = centerX + point.dx * scale
        const py = centerY - point.dy * scale
        ctx.fillRect(px - dotSize / 2, py - dotSize / 2, dotSize, dotSize)
      }
    }
    ctx.globalAlpha = 1.0
  }

  private drawMultibandPoints(
    ctx: CanvasRenderingContext2D,
    pendingSamples: { left: Float32Array; right: Float32Array }[],
    centerX: number,
    centerY: number,
    scale: number
  ): void {
    const { options } = this
    const mode = options.mode
    const dpr = window.devicePixelRatio || 1
    const dotSize = options.lineWidth * dpr

    const sampleRate = this.dataSource.getSampleRate()
    if (sampleRate > 0) {
      this.splitter.configure(sampleRate)
    }

    if (isNativeAvailable()) {
      for (const chunk of pendingSamples) {
        nativeVectorscope.pushSamples(chunk.left, chunk.right)
      }
    }

    for (const chunk of pendingSamples) {
      const bands = this.splitter.split(chunk.left, chunk.right)
      this.multibandBuffer.push(bands)
    }

    const result = this.multibandBuffer.getPoints(options.displayPoints)
    if (result.count === 0) return

    const segments = 8
    const pointsPerSegment = Math.ceil(result.count / segments)

    for (let seg = 0; seg < segments; seg++) {
      const startIdx = seg * pointsPerSegment
      const endIdx = Math.min((seg + 1) * pointsPerSegment, result.count)
      if (startIdx >= result.count) break

      const alpha = 0.15 + 0.85 * (seg / Math.max(segments - 1, 1))
      ctx.globalAlpha = alpha

      for (const band of BAND_ORDER) {
        const bandData = result.bands[band]
        ctx.fillStyle = options.bandColors[band]

        for (let i = startIdx; i < endIdx; i++) {
          const point = transformPoint(bandData.left[i], bandData.right[i], mode)
          if (!point) continue

          const px = centerX + point.dx * scale
          const py = centerY - point.dy * scale
          ctx.fillRect(px - dotSize / 2, py - dotSize / 2, dotSize, dotSize)
        }
      }
    }
    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.stop()
    this.frameLoop.dispose()

    if (this.unsubscribeSessionChange) {
      this.unsubscribeSessionChange()
      this.unsubscribeSessionChange = null
    }

    if (isNativeAvailable()) {
      nativeVectorscope.reset()
    }
  }
}

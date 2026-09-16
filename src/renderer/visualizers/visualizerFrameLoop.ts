import { FrameScheduler } from './frameScheduler'
import { latencyProbe, type BenchScope } from '../benchmark/latencyProbe'

interface VisualizerFrameLoopOptions {
  benchmarkScope?: BenchScope
  frameScheduler?: FrameScheduler
  shouldRun: () => boolean
  onFrame: () => void
}

export class VisualizerFrameLoop {
  private readonly benchmarkScope?: BenchScope
  private readonly frameScheduler: FrameScheduler
  private readonly shouldRun: () => boolean
  private readonly onFrame: () => void
  private unsubscribeFrame: (() => void) | null = null
  private isStarted = false
  private isInvalidated = false

  constructor({ frameScheduler, shouldRun, onFrame, benchmarkScope }: VisualizerFrameLoopOptions) {
    this.benchmarkScope = benchmarkScope
    this.frameScheduler = frameScheduler ?? new FrameScheduler()
    this.shouldRun = shouldRun
    this.onFrame = onFrame
  }

  start(): void {
    if (this.isStarted) return
    this.isStarted = true
    this.invalidate()
  }

  stop(): void {
    this.isStarted = false
    this.detach()
  }

  invalidate(): void {
    if (!this.isStarted) return
    this.isInvalidated = true
    this.sync()
  }

  dispose(): void {
    this.stop()
  }

  private sync(): void {
    if (!this.isStarted) {
      this.detach()
      return
    }

    if (this.isInvalidated || this.shouldRun()) {
      if (this.unsubscribeFrame === null) {
        this.unsubscribeFrame = this.frameScheduler.subscribe(this.tick)
      }
      return
    }

    this.detach()
  }

  private detach(): void {
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame()
      this.unsubscribeFrame = null
    }
  }

  private tick = (): void => {
    if (!this.isStarted) return
    this.isInvalidated = false
    if (latencyProbe?.active && this.benchmarkScope) {
      latencyProbe.beginFrame(this.benchmarkScope)
      try { this.onFrame() } finally { latencyProbe.endFrame() }
    } else {
      this.onFrame()
    }
    this.sync()
  }
}

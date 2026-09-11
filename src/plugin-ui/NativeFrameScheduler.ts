import { FrameScheduler, type FrameSchedulerCallback } from '../renderer/visualizers/frameScheduler'

/** JUCE supplies the display clock; embedded WebKit may suspend browser RAF. */
export class NativeFrameScheduler extends FrameScheduler {
  private readonly nativeCallbacks = new Set<FrameSchedulerCallback>()

  override subscribe(callback: FrameSchedulerCallback): () => void {
    this.nativeCallbacks.add(callback)
    return () => { this.nativeCallbacks.delete(callback) }
  }

  dispatchFrame(): void {
    for (const callback of [...this.nativeCallbacks]) callback()
  }
}

import type {
  RollingAudioSnapshot,
  RollingCaptureDurationSeconds,
} from '../../types/audioClip'

function floatToPcm16(sample: number): number {
  if (!Number.isFinite(sample)) return 0
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0
    ? Math.round(clamped * 32768)
    : Math.round(clamped * 32767)
}

function normalizeChannelCount(channelCount: number): 1 | 2 {
  return channelCount > 1 ? 2 : 1
}

export class RollingAudioBuffer {
  private samples: Int16Array
  private capacityFrames: number
  private writeFrameIndex = 0
  private bufferedFrames = 0

  readonly sampleRate: number
  readonly channelCount: 1 | 2
  private _durationSeconds: RollingCaptureDurationSeconds

  constructor(
    durationSeconds: RollingCaptureDurationSeconds,
    sampleRate: number,
    channelCount: number,
  ) {
    this._durationSeconds = durationSeconds
    this.sampleRate = Math.max(1, Math.floor(sampleRate) || 1)
    this.channelCount = normalizeChannelCount(channelCount)
    this.capacityFrames = Math.max(1, Math.floor(durationSeconds * this.sampleRate))
    this.samples = new Int16Array(this.capacityFrames * this.channelCount)
  }

  get durationSeconds(): RollingCaptureDurationSeconds {
    return this._durationSeconds
  }

  get frameCount(): number {
    return this.bufferedFrames
  }

  get isReady(): boolean {
    return this.bufferedFrames >= this.capacityFrames
  }

  get allocatedBytes(): number {
    return this.samples.byteLength
  }

  append(left: Float32Array, right: Float32Array, channelCount: number): void {
    const effectiveChannels = normalizeChannelCount(channelCount)
    if (effectiveChannels !== this.channelCount) return

    const availableFrames = this.channelCount === 1
      ? left.length
      : Math.min(left.length, right.length)
    if (availableFrames <= 0) return

    const framesToWrite = Math.min(availableFrames, this.capacityFrames)
    let sourceFrameIndex = availableFrames - framesToWrite
    let remainingFrames = framesToWrite

    while (remainingFrames > 0) {
      const contiguousFrames = Math.min(
        remainingFrames,
        this.capacityFrames - this.writeFrameIndex,
      )

      for (let offset = 0; offset < contiguousFrames; offset += 1) {
        const sourceIndex = sourceFrameIndex + offset
        const destinationIndex = (this.writeFrameIndex + offset) * this.channelCount
        this.samples[destinationIndex] = floatToPcm16(left[sourceIndex] ?? 0)
        if (this.channelCount === 2) {
          this.samples[destinationIndex + 1] = floatToPcm16(right[sourceIndex] ?? 0)
        }
      }

      this.writeFrameIndex = (this.writeFrameIndex + contiguousFrames) % this.capacityFrames
      this.bufferedFrames = Math.min(
        this.capacityFrames,
        this.bufferedFrames + contiguousFrames,
      )
      sourceFrameIndex += contiguousFrames
      remainingFrames -= contiguousFrames
    }
  }

  resize(durationSeconds: RollingCaptureDurationSeconds): void {
    if (durationSeconds === this._durationSeconds) return

    const nextCapacityFrames = Math.max(1, Math.floor(durationSeconds * this.sampleRate))
    const framesToKeep = Math.min(this.bufferedFrames, nextCapacityFrames)
    const nextSamples = new Int16Array(nextCapacityFrames * this.channelCount)

    if (framesToKeep > 0) {
      const startFrame = (
        this.writeFrameIndex - framesToKeep + this.capacityFrames
      ) % this.capacityFrames
      this.copyFramesTo(nextSamples, startFrame, framesToKeep)
    }

    this._durationSeconds = durationSeconds
    this.capacityFrames = nextCapacityFrames
    this.samples = nextSamples
    this.bufferedFrames = framesToKeep
    this.writeFrameIndex = framesToKeep % nextCapacityFrames
  }

  snapshot(): RollingAudioSnapshot | null {
    if (this.bufferedFrames <= 0) return null

    const pcmSamples = new Int16Array(this.bufferedFrames * this.channelCount)
    const startFrame = (
      this.writeFrameIndex - this.bufferedFrames + this.capacityFrames
    ) % this.capacityFrames
    this.copyFramesTo(pcmSamples, startFrame, this.bufferedFrames)

    return {
      pcmSamples,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      frameCount: this.bufferedFrames,
    }
  }

  private copyFramesTo(
    destination: Int16Array,
    startFrame: number,
    frameCount: number,
  ): void {
    const firstFrameCount = Math.min(frameCount, this.capacityFrames - startFrame)
    const firstSampleStart = startFrame * this.channelCount
    const firstSampleCount = firstFrameCount * this.channelCount
    destination.set(
      this.samples.subarray(firstSampleStart, firstSampleStart + firstSampleCount),
      0,
    )

    const remainingFrames = frameCount - firstFrameCount
    if (remainingFrames <= 0) return

    destination.set(
      this.samples.subarray(0, remainingFrames * this.channelCount),
      firstSampleCount,
    )
  }
}

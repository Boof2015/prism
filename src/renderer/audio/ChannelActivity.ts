const ACTIVITY_RELEASE_MS = 300
const ACTIVITY_STALE_MS = 1000

export interface ChannelActivitySnapshot {
  readonly sessionId: number
  readonly sourceKey: string
  readonly channelCount: number
  readonly updatedAt: number
  readonly opacities: readonly number[]
}

export function sourcePeakToOpacity(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0.001) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(peak) + 60) / 60)) * 0.5
}

/** Holds brief signals between paints; all times use the renderer performance clock. */
export class ChannelActivity {
  private sessionId: number | null = null
  private sourceKey: string | null = null
  private opacities = new Float32Array(0)
  private updatedAt: number | null = null

  beginSession(sessionId: number, sourceKey: string, channelCount: number): void {
    this.sessionId = sessionId
    this.sourceKey = sourceKey
    this.opacities = new Float32Array(channelCount)
    this.updatedAt = null
  }

  reset(): void {
    this.sessionId = null
    this.sourceKey = null
    this.opacities = new Float32Array(0)
    this.updatedAt = null
  }

  ingest(peaks: Float32Array | undefined, capturedAt: number): void {
    if (this.sessionId === null || !Number.isFinite(capturedAt)) return
    if (this.updatedAt !== null && capturedAt < this.updatedAt) return
    if (!peaks?.length) {
      this.opacities.fill(0)
      this.updatedAt = null
      return
    }
    if (peaks.length !== this.opacities.length) {
      this.opacities = new Float32Array(peaks.length)
      this.updatedAt = null
    }
    const elapsed = this.updatedAt === null ? Infinity : capturedAt - this.updatedAt
    const release = elapsed >= ACTIVITY_STALE_MS ? 0 : Math.exp(-elapsed / ACTIVITY_RELEASE_MS)
    for (let index = 0; index < peaks.length; index += 1) {
      this.opacities[index] = Math.max(
        sourcePeakToOpacity(peaks[index]),
        this.opacities[index] * release,
      )
    }
    this.updatedAt = capturedAt
  }

  getSnapshot(now: number): ChannelActivitySnapshot | null {
    if (this.sessionId === null || this.sourceKey === null || this.updatedAt === null
      || !Number.isFinite(now) || now - this.updatedAt >= ACTIVITY_STALE_MS) return null
    const release = Math.exp(-Math.max(0, now - this.updatedAt) / ACTIVITY_RELEASE_MS)
    return {
      sessionId: this.sessionId,
      sourceKey: this.sourceKey,
      channelCount: this.opacities.length,
      updatedAt: this.updatedAt,
      opacities: Array.from(this.opacities, (opacity) => {
        const decayed = opacity * release
        return decayed < 0.001 ? 0 : decayed
      }),
    }
  }
}

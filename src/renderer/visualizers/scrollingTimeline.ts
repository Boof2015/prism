import type { CaptureBackendKind } from '../../types/capture'
import type { DawTransportSnapshot, TimelineUnit } from '../../types/dawBridge'

export type TimelineSeamKind = 'Loop' | 'Jump' | 'Gap'

interface TimelinePoint {
  seconds?: number
  ppq?: number
  bpm?: number
  numerator: number
  denominator: number
  lastBarPpq?: number
  seam?: TimelineSeamKind
}

export interface TimelineChunkAnchor {
  frameCount: number
  sampleRate: number
  transport?: DawTransportSnapshot
}

export interface PreviousTimelineAnchor {
  sequence: number
  frameCount: number
  timeInSamples?: number
  isPlaying: boolean
  isLooping: boolean
}

const SECOND_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]

function formatSeconds(value: number): string {
  const safe = Math.max(0, value)
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  if (minutes > 0) return `${minutes}:${seconds.toFixed(seconds < 10 ? 1 : 0).padStart(4, '0')}`
  return `${seconds.toFixed(safe < 10 ? 1 : 0)}s`
}

export function resolveTimelineSeam(
  previous: PreviousTimelineAnchor | null,
  current: DawTransportSnapshot,
): TimelineSeamKind | undefined {
  if (!previous) return undefined
  if (current.sequence !== previous.sequence + 1) return 'Gap'
  if (!previous.isPlaying && current.isPlaying) return 'Jump'
  if (previous.timeInSamples === undefined || current.timeInSamples === undefined) return undefined

  const expected = previous.timeInSamples + previous.frameCount
  if (Math.abs(current.timeInSamples - expected) <= Math.max(2, previous.frameCount * 0.1)) return undefined
  if (current.isLooping && current.timeInSamples < previous.timeInSamples) return 'Loop'
  return 'Jump'
}

function niceSecondStep(points: TimelinePoint[], width: number, dpr: number): number {
  const timed = points.filter((point) => point.seconds !== undefined)
  if (timed.length < 2) return 1
  const first = timed[0].seconds!
  const last = timed[timed.length - 1].seconds!
  const span = Math.max(0.001, Math.abs(last - first))
  const targetTicks = Math.max(1, width / Math.max(1, 80 * dpr))
  const targetStep = span / targetTicks
  return SECOND_STEPS.find((step) => step >= targetStep) ?? SECOND_STEPS[SECOND_STEPS.length - 1]
}

export class ScrollingTimeline {
  private points: TimelinePoint[] = []
  private previousAnchor: PreviousTimelineAnchor | null = null
  private pendingSeam: TimelineSeamKind | undefined
  private stoppedPosition: TimelinePoint | null = null

  reset(): void {
    this.points = []
    this.previousAnchor = null
    this.pendingSeam = undefined
    this.stoppedPosition = null
  }

  resize(capacity: number): void {
    if (capacity <= 0) {
      this.points = []
      return
    }
    if (this.points.length > capacity) {
      this.points = this.points.slice(this.points.length - capacity)
    }
  }

  append(anchor: TimelineChunkAnchor, columnCount: number, capacity: number): void {
    const transport = anchor.transport
    if (!transport) {
      this.appendUnmapped(columnCount, capacity)
      return
    }

    const seam = resolveTimelineSeam(this.previousAnchor, transport)
    if (seam) this.pendingSeam = seam
    this.previousAnchor = {
      sequence: transport.sequence,
      frameCount: anchor.frameCount,
      timeInSamples: transport.timeInSamples,
      isPlaying: transport.isPlaying,
      isLooping: transport.isLooping,
    }

    const sampleRate = Math.max(1, anchor.sampleRate)
    const numerator = Math.max(1, transport.timeSignature?.numerator ?? 4)
    const denominator = Math.max(1, transport.timeSignature?.denominator ?? 4)
    if (!transport.isPlaying) {
      this.stoppedPosition = {
        seconds: transport.timeInSeconds
          ?? (transport.timeInSamples !== undefined ? transport.timeInSamples / sampleRate : undefined),
        ppq: transport.ppqPosition,
        bpm: transport.bpm,
        numerator,
        denominator,
        lastBarPpq: transport.ppqPositionOfLastBarStart,
      }
      this.appendUnmapped(columnCount, capacity)
      return
    }

    this.stoppedPosition = null
    for (let column = 0; column < columnCount; column += 1) {
      const frameOffset = ((column + 1) / Math.max(1, columnCount)) * anchor.frameCount
      const secondsOffset = frameOffset / sampleRate
      const seconds = transport.timeInSeconds !== undefined
        ? transport.timeInSeconds + secondsOffset
        : transport.timeInSamples !== undefined
          ? (transport.timeInSamples + frameOffset) / sampleRate
          : undefined
      const ppq = transport.ppqPosition !== undefined && transport.bpm !== undefined
        ? transport.ppqPosition + secondsOffset * transport.bpm / 60
        : transport.ppqPosition
      this.points.push({
        seconds,
        ppq,
        bpm: transport.bpm,
        numerator,
        denominator,
        lastBarPpq: transport.ppqPositionOfLastBarStart,
        ...(column === 0 && this.pendingSeam ? { seam: this.pendingSeam } : {}),
      })
      if (column === 0) this.pendingSeam = undefined
    }
    this.resize(capacity)
  }

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    unit: TimelineUnit,
    backendKind: CaptureBackendKind | null,
    gridColor: string,
    labelColor: string,
    orientation: 'horizontal' | 'vertical' = 'horizontal',
  ): void {
    if (unit === 'off' || backendKind !== 'daw-bridge' || this.points.length === 0) return

    const dpr = window.devicePixelRatio || 1
    const axisLength = orientation === 'horizontal' ? width : height
    const start = axisLength - this.points.length
    const hasPpq = this.points.some((point) => point.ppq !== undefined)
    const effectiveUnit: TimelineUnit = unit === 'bars-beats' && !hasPpq ? 'seconds' : unit
    const secondStep = niceSecondStep(this.points, axisLength, dpr)
    let lastLabelPosition = -Infinity

    ctx.save()
    ctx.font = `${10 * dpr}px monospace`
    ctx.textBaseline = 'top'
    ctx.lineWidth = Math.max(1, dpr)

    for (let index = 1; index < this.points.length; index += 1) {
      const previous = this.points[index - 1]
      const point = this.points[index]
      const position = start + index

      if (point.seam) {
        ctx.save()
        ctx.strokeStyle = labelColor
        ctx.setLineDash([4 * dpr, 4 * dpr])
        ctx.beginPath()
        if (orientation === 'horizontal') {
          ctx.moveTo(position, 0)
          ctx.lineTo(position, height)
        } else {
          ctx.moveTo(0, position)
          ctx.lineTo(width, position)
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = labelColor
        ctx.fillText(
          point.seam,
          orientation === 'horizontal' ? position + 4 * dpr : 4 * dpr,
          orientation === 'horizontal' ? 3 * dpr : position + 3 * dpr,
        )
        ctx.restore()
        continue
      }

      let major = false
      let label: string | null = null
      let musicalLabel = false
      if (effectiveUnit === 'bars-beats' && previous.ppq !== undefined && point.ppq !== undefined) {
        const beatLength = 4 / point.denominator
        const previousBeatIndex = Math.floor((previous.ppq + beatLength * 1.0e-7) / beatLength)
        const beatIndex = Math.floor((point.ppq + beatLength * 1.0e-7) / beatLength)
        if (previousBeatIndex === beatIndex) continue
        const quartersPerBar = point.numerator * beatLength
        const tickPpq = beatIndex * beatLength
        const barAnchor = point.lastBarPpq
        const beatsFromBarAnchor = barAnchor !== undefined
          ? Math.round((tickPpq - barAnchor) / beatLength)
          : beatIndex
        const beatNumber = ((beatsFromBarAnchor % point.numerator) + point.numerator) % point.numerator + 1
        const barNumber = Math.floor((tickPpq + quartersPerBar * 1.0e-7) / quartersPerBar) + 1
        const ppqPerPixel = Math.abs(point.ppq - previous.ppq)
        const estimatedBeatPixelSpacing = ppqPerPixel > 0 ? beatLength / ppqPerPixel : 0
        const hasRoomForBeatLabel = estimatedBeatPixelSpacing >= 34 * dpr
        major = beatNumber === 1
        musicalLabel = true
        // At roomy zoom levels the ruler names every beat. Dense histories keep
        // every bar number instead of dropping apparently random bars.
        label = major
          ? hasRoomForBeatLabel ? `${barNumber}|1` : `${barNumber}`
          : hasRoomForBeatLabel ? `${barNumber}|${beatNumber}` : null
      } else if (previous.seconds !== undefined && point.seconds !== undefined) {
        if (Math.floor(previous.seconds / secondStep) === Math.floor(point.seconds / secondStep)) continue
        major = true
        label = formatSeconds(Math.floor(point.seconds / secondStep) * secondStep)
      } else {
        continue
      }

      ctx.strokeStyle = gridColor
      ctx.globalAlpha = major ? 0.8 : 0.3
      ctx.beginPath()
      if (orientation === 'horizontal') {
        ctx.moveTo(position, 0)
        ctx.lineTo(position, height)
      } else {
        ctx.moveTo(0, position)
        ctx.lineTo(width, position)
      }
      ctx.stroke()
      ctx.globalAlpha = 1

      const secondsLabelHasRoom = label
        ? position - lastLabelPosition >= Math.max(20 * dpr, ctx.measureText(label).width + 6 * dpr)
        : false
      if (label && (musicalLabel || secondsLabelHasRoom)) {
        ctx.fillStyle = labelColor
        ctx.fillText(
          label,
          orientation === 'horizontal' ? position + 3 * dpr : 3 * dpr,
          orientation === 'horizontal' ? height - 15 * dpr : position + 3 * dpr,
        )
        if (!musicalLabel) lastLabelPosition = position
      }
    }

    if (unit === 'bars-beats' && effectiveUnit === 'seconds') {
      ctx.fillStyle = labelColor
      ctx.fillText('Seconds (beat data unavailable)', 5 * dpr, 4 * dpr)
    }

    if (this.stoppedPosition) {
      const stoppedBeatLength = 4 / this.stoppedPosition.denominator
      const stoppedQuartersPerBar = this.stoppedPosition.numerator * stoppedBeatLength
      const stoppedBarAnchor = this.stoppedPosition.lastBarPpq
        ?? Math.floor((this.stoppedPosition.ppq ?? 0) / stoppedQuartersPerBar) * stoppedQuartersPerBar
      const stoppedLabel = effectiveUnit === 'bars-beats' && this.stoppedPosition.ppq !== undefined
        ? `Stopped · ${Math.floor(this.stoppedPosition.ppq / stoppedQuartersPerBar) + 1}|${Math.floor((this.stoppedPosition.ppq - stoppedBarAnchor) / stoppedBeatLength) + 1}`
        : this.stoppedPosition.seconds !== undefined
          ? `Stopped · ${formatSeconds(this.stoppedPosition.seconds)}`
          : 'Stopped'
      ctx.fillStyle = labelColor
      if (orientation === 'horizontal') {
        ctx.textAlign = 'right'
        ctx.fillText(stoppedLabel, width - 5 * dpr, 4 * dpr)
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(stoppedLabel, 5 * dpr, Math.max(4 * dpr, height - 15 * dpr))
      }
    }

    ctx.restore()
  }

  private appendUnmapped(columnCount: number, capacity: number): void {
    for (let column = 0; column < columnCount; column += 1) {
      this.points.push({ numerator: 4, denominator: 4 })
    }
    this.resize(capacity)
  }
}

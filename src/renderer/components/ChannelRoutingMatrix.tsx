import { useLayoutEffect, useRef, type CSSProperties, type JSX } from 'react'
import { audioCapture } from '../audio/AudioCapture'
import { getHorizontalWheelScrollResult } from '../utils/horizontalWheelScroll'
import type {
  CaptureChannelDescriptor,
  CaptureChannelRouting,
} from '../../types/capture'

interface ChannelRoutingMatrixProps {
  channels: CaptureChannelDescriptor[]
  routing: CaptureChannelRouting
  onChange: (routing: CaptureChannelRouting) => void
  sourceKey: string | null
  activityEnabled?: boolean
}

export default function ChannelRoutingMatrix({
  channels,
  routing,
  onChange,
  sourceKey,
  activityEnabled = true,
}: ChannelRoutingMatrixProps): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      const result = getHorizontalWheelScrollResult({
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        scrollLeft: scroller.scrollLeft,
        deltaMode: event.deltaMode,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      })
      if (!result) return
      scroller.scrollLeft = result.nextScrollLeft
      event.preventDefault()
      event.stopPropagation()
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [channels.length])

  useLayoutEffect(() => {
    const cells = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-channel-index]') ?? [])
    if (!cells.length) return
    for (const cell of cells) cell.style.setProperty('--channel-activity-opacity', '0')
    if (!activityEnabled) return
    let frameId: number | null = null
    let lastPaint = -Infinity

    const paint = (now: number): void => {
      const snapshot = audioCapture.getChannelActivity(now)
      const opacities = snapshot?.sourceKey === sourceKey && snapshot.channelCount === channels.length
        ? snapshot.opacities
        : null
      for (const cell of cells) {
        const opacity = opacities?.[Number(cell.dataset.channelIndex)] ?? 0
        cell.style.setProperty('--channel-activity-opacity', opacity.toFixed(4))
      }
    }
    const tick = (now: number): void => {
      if (now - lastPaint >= 1000 / 30) {
        paint(now)
        lastPaint = now
      }
      frameId = requestAnimationFrame(tick)
    }
    const onVisibilityChange = (): void => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = null
      if (!document.hidden) {
        paint(performance.now())
        lastPaint = performance.now()
        frameId = requestAnimationFrame(tick)
      }
    }
    onVisibilityChange()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activityEnabled, channels, sourceKey])

  if (channels.length === 0) return null

  const renderRow = (
    side: 'left' | 'right',
    rowLabel: 'L' | 'R',
  ): JSX.Element => {
    const selectedIndex = routing[side]
    return (
      <div className="channel-routing__row" role="radiogroup" aria-label={`${rowLabel} channel routing`}>
        <span className="channel-routing__row-label" aria-hidden="true">{rowLabel}</span>
        {channels.map((channel) => {
          const selected = channel.index === selectedIndex
          return (
            <button
              key={`${side}:${channel.index}`}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Route ${channel.label} to ${side === 'left' ? 'Left' : 'Right'}`}
              title={`${channel.index + 1}: ${channel.label}. Fill indicates incoming signal strength.`}
              data-channel-index={channel.index}
              className={`channel-routing__cell ${selected ? 'is-selected' : ''}`.trim()}
              onClick={() => onChange({ ...routing, [side]: channel.index })}
            >
              <span className="channel-routing__cell-label">{channel.index + 1}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="channel-routing" aria-label="Channel Routing">
      <div ref={scrollRef} className="channel-routing__scroll">
        <div
          className="channel-routing__grid"
          style={{ '--channel-count': channels.length } as CSSProperties}
        >
          {renderRow('left', 'L')}
          {renderRow('right', 'R')}
        </div>
      </div>
    </div>
  )
}

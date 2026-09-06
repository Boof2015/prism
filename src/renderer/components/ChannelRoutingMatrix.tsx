import type { CSSProperties, JSX } from 'react'
import type {
  CaptureChannelDescriptor,
  CaptureChannelRouting,
} from '../../types/capture'

interface ChannelRoutingMatrixProps {
  channels: CaptureChannelDescriptor[]
  routing: CaptureChannelRouting
  onChange: (routing: CaptureChannelRouting) => void
}

export default function ChannelRoutingMatrix({
  channels,
  routing,
  onChange,
}: ChannelRoutingMatrixProps): JSX.Element | null {
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
              title={`${channel.index + 1}: ${channel.label}`}
              className={`channel-routing__cell ${selected ? 'is-selected' : ''}`.trim()}
              onClick={() => onChange({ ...routing, [side]: channel.index })}
            >
              {channel.index + 1}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="channel-routing" aria-label="Channel Routing">
      <div className="channel-routing__scroll">
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

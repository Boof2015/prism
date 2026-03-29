import type { WindowBounds } from '../types/popout'
import type { ResizeDirection } from '../types/windowResize'

interface Point {
  x: number
  y: number
}

interface ResizeWindowBoundsOptions {
  edge: ResizeDirection
  startBounds: WindowBounds
  startCursor: Point
  cursor: Point
  minWidth: number
  minHeight: number
}

export function calculateResizedWindowBounds({
  edge,
  startBounds,
  startCursor,
  cursor,
  minWidth,
  minHeight,
}: ResizeWindowBoundsOptions): WindowBounds {
  const deltaX = Math.round(cursor.x - startCursor.x)
  const deltaY = Math.round(cursor.y - startCursor.y)

  let nextX = startBounds.x
  let nextY = startBounds.y
  let nextWidth = startBounds.width
  let nextHeight = startBounds.height

  if (edge.includes('e')) {
    nextWidth = startBounds.width + deltaX
  }

  if (edge.includes('s')) {
    nextHeight = startBounds.height + deltaY
  }

  if (edge.includes('w')) {
    nextX = startBounds.x + deltaX
    nextWidth = startBounds.width - deltaX
  }

  if (edge.includes('n')) {
    nextY = startBounds.y + deltaY
    nextHeight = startBounds.height - deltaY
  }

  const clampedMinWidth = Math.max(1, Math.round(minWidth))
  const clampedMinHeight = Math.max(1, Math.round(minHeight))

  if (nextWidth < clampedMinWidth) {
    nextWidth = clampedMinWidth
    if (edge.includes('w')) {
      nextX = startBounds.x + startBounds.width - clampedMinWidth
    }
  }

  if (nextHeight < clampedMinHeight) {
    nextHeight = clampedMinHeight
    if (edge.includes('n')) {
      nextY = startBounds.y + startBounds.height - clampedMinHeight
    }
  }

  return {
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: Math.round(nextWidth),
    height: Math.round(nextHeight),
  }
}

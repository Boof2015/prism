const WHEEL_DELTA_LINE_PX = 16
const WHEEL_DELTA_PAGE_WIDTH_FACTOR = 0.9

export interface HorizontalWheelScrollInput {
  clientWidth: number
  deltaMode: number
  deltaX: number
  deltaY: number
  isTargetExcluded?: boolean
  scrollLeft: number
  scrollWidth: number
}

export interface HorizontalWheelScrollResult {
  appliedDelta: number
  nextScrollLeft: number
}

export function normalizeWheelDelta(delta: number, deltaMode: number, clientWidth: number): number {
  if (deltaMode === 1) {
    return delta * WHEEL_DELTA_LINE_PX
  }

  if (deltaMode === 2) {
    return delta * clientWidth * WHEEL_DELTA_PAGE_WIDTH_FACTOR
  }

  return delta
}

export function getHorizontalWheelScrollResult({
  clientWidth,
  deltaMode,
  deltaX,
  deltaY,
  isTargetExcluded = false,
  scrollLeft,
  scrollWidth,
}: HorizontalWheelScrollInput): HorizontalWheelScrollResult | null {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  if (isTargetExcluded || maxScrollLeft <= 0) return null
  if (deltaX !== 0 || deltaY === 0) return null

  const normalizedDelta = normalizeWheelDelta(deltaY, deltaMode, clientWidth)
  if (normalizedDelta === 0) return null

  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, scrollLeft + normalizedDelta))
  if (nextScrollLeft === scrollLeft) return null

  return {
    appliedDelta: nextScrollLeft - scrollLeft,
    nextScrollLeft,
  }
}

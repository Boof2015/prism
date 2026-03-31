import type { WindowBounds } from '../types/popout'

export interface WorkAreaBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface StackableWindowLike {
  isDestroyed(): boolean
  isAlwaysOnTop(): boolean
  moveTop(): void
}

function getRight(bounds: WorkAreaBounds): number {
  return bounds.x + bounds.width
}

function getBottom(bounds: WorkAreaBounds): number {
  return bounds.y + bounds.height
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA
}

function rectsIntersect(a: WorkAreaBounds, b: WorkAreaBounds): boolean {
  return rangesOverlap(a.x, getRight(a), b.x, getRight(b))
    && rangesOverlap(a.y, getBottom(a), b.y, getBottom(b))
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    return Math.round((min + max) / 2)
  }

  return Math.min(max, Math.max(min, value))
}

function unionBounds(boundsList: readonly WorkAreaBounds[]): WorkAreaBounds {
  const left = Math.min(...boundsList.map((bounds) => bounds.x))
  const top = Math.min(...boundsList.map((bounds) => bounds.y))
  const right = Math.max(...boundsList.map((bounds) => getRight(bounds)))
  const bottom = Math.max(...boundsList.map((bounds) => getBottom(bounds)))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function normalizeWorkAreas(workAreas: readonly WorkAreaBounds[]): WorkAreaBounds[] {
  return workAreas
    .filter((bounds) => bounds.width > 0 && bounds.height > 0)
    .map((bounds) => ({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }))
}

export function buildDisplayEnvelope(
  anchorBounds: WindowBounds,
  projectedBounds: WorkAreaBounds,
  workAreas: readonly WorkAreaBounds[],
): WorkAreaBounds {
  const normalizedWorkAreas = normalizeWorkAreas(workAreas)
  if (normalizedWorkAreas.length === 0) {
    return { ...projectedBounds }
  }

  const relevant = normalizedWorkAreas.filter((workArea) => {
    return rectsIntersect(workArea, projectedBounds)
      || rangesOverlap(workArea.x, getRight(workArea), anchorBounds.x, getRight(anchorBounds))
  })

  return unionBounds(relevant.length > 0 ? relevant : normalizedWorkAreas)
}

export function clampBoundsWithinEnvelope(
  bounds: WindowBounds,
  envelope: WorkAreaBounds,
): WindowBounds {
  const maxX = getRight(envelope) - bounds.width
  const maxY = getBottom(envelope) - bounds.height

  return {
    x: clamp(bounds.x, envelope.x, maxX),
    y: clamp(bounds.y, envelope.y, maxY),
    width: bounds.width,
    height: bounds.height,
  }
}

export function clampBoundsWithVisibleMargin(
  bounds: WindowBounds,
  envelope: WorkAreaBounds,
  visibleMargin: number,
): WindowBounds {
  const margin = Math.max(0, Math.round(visibleMargin))
  const minX = envelope.x + margin - bounds.width
  const maxX = getRight(envelope) - margin
  const minY = envelope.y + margin - bounds.height
  const maxY = getBottom(envelope) - margin

  return {
    x: clamp(bounds.x, minX, maxX),
    y: clamp(bounds.y, minY, maxY),
    width: bounds.width,
    height: bounds.height,
  }
}

export function resolveExpandedMainWindowBounds(
  logicalBounds: WindowBounds,
  settingsHeight: number,
  workAreas: readonly WorkAreaBounds[],
): WindowBounds {
  const nextSettingsHeight = Math.max(0, Math.round(settingsHeight))
  if (nextSettingsHeight === 0) {
    return { ...logicalBounds }
  }

  const projectedBounds: WindowBounds = {
    x: logicalBounds.x,
    y: logicalBounds.y,
    width: logicalBounds.width,
    height: logicalBounds.height + nextSettingsHeight,
  }

  const envelope = buildDisplayEnvelope(logicalBounds, projectedBounds, workAreas)
  return clampBoundsWithinEnvelope(projectedBounds, envelope)
}

export function clampDraggedMainWindowBounds(
  actualBounds: WindowBounds,
  workAreas: readonly WorkAreaBounds[],
  visibleMargin: number,
): WindowBounds {
  const envelope = buildDisplayEnvelope(actualBounds, actualBounds, workAreas)
  return clampBoundsWithVisibleMargin(actualBounds, envelope, visibleMargin)
}

export function raiseWindowAboveNormalPopouts(
  mainWindow: StackableWindowLike | null,
  popouts: Iterable<StackableWindowLike>,
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false
  }

  for (const popout of popouts) {
    if (!popout.isDestroyed() && !popout.isAlwaysOnTop()) {
      mainWindow.moveTop()
      return true
    }
  }

  return false
}

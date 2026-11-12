import type { WindowBounds } from '../types/popout'
import type { MainWindowSettingsRequest } from '../types/mainWindowSettings'

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
    .filter((bounds) => Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0)
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

export function selectMainWindowWorkArea(
  bounds: WindowBounds,
  workAreas: readonly WorkAreaBounds[],
): WorkAreaBounds {
  const areas = normalizeWorkAreas(workAreas)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const overlap = (area: WorkAreaBounds): number =>
    Math.max(0, Math.min(getRight(bounds), getRight(area)) - Math.max(bounds.x, area.x))
    * Math.max(0, Math.min(getBottom(bounds), getBottom(area)) - Math.max(bounds.y, area.y))
  const distance = (area: WorkAreaBounds): number =>
    (centerX - clamp(centerX, area.x, getRight(area))) ** 2
    + (centerY - clamp(centerY, area.y, getBottom(area))) ** 2
  areas.sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b))
  return areas[0] ?? { ...bounds }
}

export function normalizeMainWindowSettingsRequest(raw: unknown): MainWindowSettingsRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const { panelHeight, bottomBarHeight } = raw as MainWindowSettingsRequest
  if (!Number.isFinite(panelHeight) || !Number.isFinite(bottomBarHeight)
    || panelHeight < 0 || bottomBarHeight < 0) return null
  return panelHeight > 0 && bottomBarHeight > 0
    ? { panelHeight, bottomBarHeight }
    : { panelHeight: 0, bottomBarHeight: 0 }
}

export interface MainWindowLayoutOptions {
  logicalBounds: WindowBounds
  request: MainWindowSettingsRequest
  workAreas: readonly WorkAreaBounds[]
  zoomFactor?: number
  chromeHeight?: number
  /** A user resize while settings are open changes only the temporary viewport. */
  viewportHeight?: number
  /** Maximized/fullscreen or OS-constrained bounds: allocate without resizing. */
  fixedBounds?: WindowBounds
}

export function resolveMainWindowSettingsLayout({
  logicalBounds, request, workAreas, zoomFactor = 1, chromeHeight = 0,
  viewportHeight, fixedBounds,
}: MainWindowLayoutOptions): { bounds: WindowBounds; settingsHeight: number; minimumHeight: number } {
  const area = selectMainWindowWorkArea(logicalBounds, workAreas)
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const chrome = Math.max(0, chromeHeight)
  const open = request.panelHeight > 0 && request.bottomBarHeight > 0
  // Include the settings region's one CSS pixel top border.
  const desired = open ? Math.ceil((request.panelHeight + request.bottomBarHeight + 1) * zoom) : 0
  const controlsMinimum = open ? Math.ceil((request.bottomBarHeight + 180 + 1) * zoom) : 0
  const settingsMinimum = Math.min(desired, controlsMinimum)
  const limit = fixedBounds?.height ?? area.height
  const minimumHeight = Math.min(limit, chrome + 100 + settingsMinimum)
  const height = fixedBounds?.height ?? Math.round(clamp(
    open ? viewportHeight ?? logicalBounds.height + desired : logicalBounds.height,
    minimumHeight, limit,
  ))
  const contentHeight = Math.max(0, height - chrome)
  // On very short workspaces, keep the footer reachable before reserving scope space.
  const stripMinimum = Math.min(100, Math.max(0, contentHeight - Math.ceil((request.bottomBarHeight + 1) * zoom)))
  const applied = open ? Math.max(0, Math.min(
    desired,
    Math.max(height - logicalBounds.height, settingsMinimum),
    contentHeight - stripMinimum,
  )) : 0
  return {
    bounds: fixedBounds ? { ...fixedBounds } : {
      ...logicalBounds,
      x: clamp(logicalBounds.x, area.x, Math.max(area.x, getRight(area) - logicalBounds.width)),
      y: clamp(logicalBounds.y, area.y, getBottom(area) - height),
      height,
    },
    settingsHeight: applied / zoom,
    minimumHeight,
  }
}

export function clampDraggedMainWindowBounds(
  actualBounds: WindowBounds,
  workAreas: readonly WorkAreaBounds[],
  visibleMargin: number,
): WindowBounds {
  const envelope = buildDisplayEnvelope(actualBounds, actualBounds, workAreas)
  return clampBoundsWithVisibleMargin(actualBounds, envelope, visibleMargin)
}

export function clampRestoredWindowBounds(
  bounds: WindowBounds,
  workAreas: readonly WorkAreaBounds[],
  visibleMargin: number,
): WindowBounds {
  const envelope = buildDisplayEnvelope(bounds, bounds, workAreas)
  return clampBoundsWithVisibleMargin(bounds, envelope, visibleMargin)
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

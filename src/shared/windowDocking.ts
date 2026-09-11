import type { WindowBounds } from '../types/popout'
import type { WindowDockingPreferences } from '../types/windowDocking'
import { normalizeWindowBounds } from './profileState'

export function normalizeWindowDocking(raw: unknown): WindowDockingPreferences {
  const value = raw && typeof raw === 'object' ? raw as Partial<WindowDockingPreferences> : {}
  const parsedBounds = normalizeWindowBounds(value.floatingBounds, 400, 100)
  const floatingBounds = parsedBounds && Object.values(parsedBounds).every(Number.isFinite) ? parsedBounds : undefined
  const displayId = typeof value.displayId === 'number' && Number.isSafeInteger(value.displayId)
    ? value.displayId : null
  return {
    enabled: value.enabled === true && displayId !== null && floatingBounds !== undefined,
    edge: value.edge === 'top' ? 'top' : 'bottom',
    displayId,
    height: typeof value.height === 'number' && Number.isFinite(value.height)
      ? Math.max(100, Math.round(value.height)) : 180,
    floatingBounds,
  }
}

export function fitFloatingBounds(bounds: WindowBounds, area: WindowBounds): WindowBounds {
  const width = Math.min(Math.max(400, bounds.width), area.width)
  const height = Math.min(Math.max(100, bounds.height), area.height)
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width, height,
  }
}

export function dockSettingsBounds(rack: WindowBounds, area: WindowBounds, edge: 'top' | 'bottom', requestedHeight: number): WindowBounds {
  const available = edge === 'top'
    ? area.y + area.height - (rack.y + rack.height)
    : rack.y - area.y
  const height = Math.max(1, Math.min(Math.ceil(requestedHeight), available))
  return { x: rack.x, y: edge === 'top' ? rack.y + rack.height : rack.y - height, width: rack.width, height }
}

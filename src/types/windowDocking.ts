import type { WindowBounds } from './popout'

export type DockEdge = 'top' | 'bottom'

/** Machine-local preferences; never included in a shareable profile. */
export interface WindowDockingPreferences {
  enabled: boolean
  edge: DockEdge
  displayId: number | null
  height: number
  floatingBounds?: WindowBounds
}

export interface WindowDockingSnapshot extends WindowDockingPreferences {
  supported: boolean
  active: boolean
  error: string | null
}

export interface NativeWindowDockingAPI {
  messages(): { callback: number; taskbarCreated: number }
  register(handle: Buffer): boolean
  remove(handle: Buffer): void
  lower(handle: Buffer): void
  fullscreen(handle: Buffer): boolean
  workArea(monitor: WindowBounds): WindowBounds | null
  /** Negotiates the reserved rectangle with the shell, in physical pixels. */
  position(handle: Buffer, edge: DockEdge, monitor: WindowBounds, height: number): WindowBounds | null
}

import type { ScopeKind } from './scope'
import type { WindowBounds } from './popout'

export const WINDOW_LOCAL_STATE_FORMAT = 'prism-window-local'
export const WINDOW_LOCAL_STATE_VERSION = 1

export type WindowBackgroundMode = 'solid' | 'blurred' | 'clear'

export interface WindowBackgroundState {
  mode: WindowBackgroundMode
  /** How much of the desktop shows through the app background, 0-100. */
  transparency: number
}

export interface WindowBackgroundSnapshot {
  /** What the user chose (preserved even when the platform can't honor it). */
  stored: WindowBackgroundState
  /** What is actually applied after platform capability downgrades. */
  effective: WindowBackgroundState
}

export interface PrismWindowLocalStateV1 {
  format: typeof WINDOW_LOCAL_STATE_FORMAT
  version: typeof WINDOW_LOCAL_STATE_VERSION
  mainAlwaysOnTop: boolean
  popoutAlwaysOnTop: Partial<Record<ScopeKind, boolean>>
  nowPlayingConfigWindowBounds?: WindowBounds
  windowBackground: WindowBackgroundState
}

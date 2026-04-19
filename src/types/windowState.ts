import type { ScopeKind } from './scope'
import type { WindowBounds } from './popout'

export const WINDOW_LOCAL_STATE_FORMAT = 'prism-window-local'
export const WINDOW_LOCAL_STATE_VERSION = 1

export interface PrismWindowLocalStateV1 {
  format: typeof WINDOW_LOCAL_STATE_FORMAT
  version: typeof WINDOW_LOCAL_STATE_VERSION
  mainAlwaysOnTop: boolean
  popoutAlwaysOnTop: Partial<Record<ScopeKind, boolean>>
  nowPlayingConfigWindowBounds?: WindowBounds
}

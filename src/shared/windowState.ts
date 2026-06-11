import { normalizeScopeKind, type ScopeKind } from '../types/scope'
import { normalizeWindowBounds } from './profileState'
import {
  WINDOW_LOCAL_STATE_FORMAT,
  WINDOW_LOCAL_STATE_VERSION,
  type PrismWindowLocalStateV1,
  type WindowBackgroundMode,
  type WindowBackgroundState,
} from '../types/windowState'

const WINDOW_BACKGROUND_MODES: readonly WindowBackgroundMode[] = ['solid', 'blurred', 'clear']

export function createDefaultWindowBackgroundState(): WindowBackgroundState {
  return {
    mode: 'solid',
    transparency: 50,
  }
}

export function normalizeWindowBackgroundState(raw: unknown): WindowBackgroundState {
  const fallback = createDefaultWindowBackgroundState()
  if (typeof raw !== 'object' || raw === null) {
    return fallback
  }

  const candidate = raw as Partial<WindowBackgroundState>
  const mode = WINDOW_BACKGROUND_MODES.includes(candidate.mode as WindowBackgroundMode)
    ? candidate.mode as WindowBackgroundMode
    : fallback.mode
  const transparency = typeof candidate.transparency === 'number' && Number.isFinite(candidate.transparency)
    ? Math.min(100, Math.max(0, Math.round(candidate.transparency)))
    : fallback.transparency

  return { mode, transparency }
}

export function createEmptyWindowLocalState(): PrismWindowLocalStateV1 {
  return {
    format: WINDOW_LOCAL_STATE_FORMAT,
    version: WINDOW_LOCAL_STATE_VERSION,
    mainAlwaysOnTop: false,
    popoutAlwaysOnTop: {},
    nowPlayingConfigWindowBounds: undefined,
    windowBackground: createDefaultWindowBackgroundState(),
  }
}

export function normalizeWindowLocalState(raw: unknown): PrismWindowLocalStateV1 {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismWindowLocalStateV1>
    : {}

  const popoutAlwaysOnTop = typeof parsed.popoutAlwaysOnTop === 'object' && parsed.popoutAlwaysOnTop !== null
    ? Object.entries(parsed.popoutAlwaysOnTop).reduce((acc, [rawKind, value]) => {
        const kind = normalizeScopeKind(rawKind)
        if (kind && value === true) {
          acc[kind] = true
        }
        return acc
      }, {} as Partial<Record<ScopeKind, boolean>>)
    : {}

  return {
    format: WINDOW_LOCAL_STATE_FORMAT,
    version: WINDOW_LOCAL_STATE_VERSION,
    mainAlwaysOnTop: parsed.mainAlwaysOnTop === true,
    popoutAlwaysOnTop,
    nowPlayingConfigWindowBounds: normalizeWindowBounds(parsed.nowPlayingConfigWindowBounds),
    windowBackground: normalizeWindowBackgroundState(parsed.windowBackground),
  }
}

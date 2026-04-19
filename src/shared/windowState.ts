import { normalizeScopeKind, type ScopeKind } from '../types/scope'
import { normalizeWindowBounds } from './profileState'
import {
  WINDOW_LOCAL_STATE_FORMAT,
  WINDOW_LOCAL_STATE_VERSION,
  type PrismWindowLocalStateV1,
} from '../types/windowState'

export function createEmptyWindowLocalState(): PrismWindowLocalStateV1 {
  return {
    format: WINDOW_LOCAL_STATE_FORMAT,
    version: WINDOW_LOCAL_STATE_VERSION,
    mainAlwaysOnTop: false,
    popoutAlwaysOnTop: {},
    nowPlayingConfigWindowBounds: undefined,
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
  }
}

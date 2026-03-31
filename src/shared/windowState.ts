import { SCOPE_KINDS, type ScopeKind } from '../types/scope'
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
  }
}

export function normalizeWindowLocalState(raw: unknown): PrismWindowLocalStateV1 {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismWindowLocalStateV1>
    : {}

  const popoutAlwaysOnTop = typeof parsed.popoutAlwaysOnTop === 'object' && parsed.popoutAlwaysOnTop !== null
    ? SCOPE_KINDS.reduce((acc, kind) => {
        if ((parsed.popoutAlwaysOnTop as Partial<Record<ScopeKind, unknown>>)[kind] === true) {
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
  }
}

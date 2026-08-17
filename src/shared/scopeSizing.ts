import type { ScopeKind } from '../types/scope'

export const DEFAULT_SCOPE_POPOUT_MIN_WIDTH_PX = 220
export const MIN_LOUDNESS_METER_WIDTH_PX = 112

export function getScopePopoutMinWidth(kind: ScopeKind): number {
  return kind === 'lufsmeter'
    ? MIN_LOUDNESS_METER_WIDTH_PX
    : DEFAULT_SCOPE_POPOUT_MIN_WIDTH_PX
}

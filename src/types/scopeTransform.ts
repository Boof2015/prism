export type ScopeDisplayRotation = 0 | 90 | 180 | 270

export interface ScopeDisplayTransformSettings {
  rotation: ScopeDisplayRotation
  mirrorHorizontal: boolean
}

export const SCOPE_DISPLAY_ROTATIONS: readonly ScopeDisplayRotation[] = [0, 90, 180, 270]
export const DEFAULT_SCOPE_DISPLAY_ROTATION: ScopeDisplayRotation = 0
export const DEFAULT_SCOPE_MIRROR_HORIZONTAL = false

export function isScopeDisplayRotation(value: unknown): value is ScopeDisplayRotation {
  return typeof value === 'number'
    && SCOPE_DISPLAY_ROTATIONS.includes(value as ScopeDisplayRotation)
}

export function normalizeScopeDisplayRotation(value: unknown): ScopeDisplayRotation {
  return isScopeDisplayRotation(value) ? value : DEFAULT_SCOPE_DISPLAY_ROTATION
}

export function normalizeScopeMirrorHorizontal(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SCOPE_MIRROR_HORIZONTAL
}

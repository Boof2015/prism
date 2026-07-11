import type { CSSProperties } from 'react'
import type { ScopeDisplayRotation } from '../types/scopeTransform'

export interface ScopeCanvasLayout {
  viewportCssWidth: number
  viewportCssHeight: number
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
  dpr: number
}

export interface NormalizedScopePoint {
  x: number
  y: number
}

export function isQuarterTurn(rotation: ScopeDisplayRotation): boolean {
  return rotation === 90 || rotation === 270
}

export function resolveScopeCanvasLayout(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  rotation: ScopeDisplayRotation,
): ScopeCanvasLayout {
  const viewportCssWidth = Math.max(1, Math.floor(viewportWidth))
  const viewportCssHeight = Math.max(1, Math.floor(viewportHeight))
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio)
    ? devicePixelRatio
    : 1
  const cssWidth = isQuarterTurn(rotation) ? viewportCssHeight : viewportCssWidth
  const cssHeight = isQuarterTurn(rotation) ? viewportCssWidth : viewportCssHeight

  return {
    viewportCssWidth,
    viewportCssHeight,
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.floor(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * dpr)),
    dpr,
  }
}

export function measureScopeCanvasLayout(
  container: HTMLElement,
  rotation: ScopeDisplayRotation,
): ScopeCanvasLayout {
  const rect = container.getBoundingClientRect()
  return resolveScopeCanvasLayout(
    rect.width,
    rect.height,
    window.devicePixelRatio || 1,
    rotation,
  )
}

export function isSameScopeCanvasLayout(
  left: ScopeCanvasLayout | null,
  right: ScopeCanvasLayout | null,
): boolean {
  if (!left || !right) return false

  return left.viewportCssWidth === right.viewportCssWidth
    && left.viewportCssHeight === right.viewportCssHeight
    && left.cssWidth === right.cssWidth
    && left.cssHeight === right.cssHeight
    && left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && left.dpr === right.dpr
}

export function getScopeCanvasTransformStyle(
  rotation: ScopeDisplayRotation,
  mirrorHorizontal: boolean,
): CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    left: '50%',
    display: 'block',
    transformOrigin: 'center center',
    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${mirrorHorizontal ? -1 : 1})`,
  }
}

export function transformNormalizedScopePoint(
  point: NormalizedScopePoint,
  rotation: ScopeDisplayRotation,
  mirrorHorizontal: boolean,
): NormalizedScopePoint {
  const x = mirrorHorizontal ? 1 - point.x : point.x
  const y = point.y

  switch (rotation) {
    case 90:
      return { x: 1 - y, y: x }
    case 180:
      return { x: 1 - x, y: 1 - y }
    case 270:
      return { x: y, y: 1 - x }
    case 0:
    default:
      return { x, y }
  }
}

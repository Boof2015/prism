import type { ScopeDisplayRotation } from '../types/scopeTransform'
import {
  measureScopeCanvasLayout,
  type ScopeCanvasLayout,
} from '../renderer/scopeCanvasTransform'

type PixelSizeResolver = (
  cssWidth: number,
  cssHeight: number,
  dpr: number,
) => { width: number; height: number }

export function applyPluginScopeCanvasLayout(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  rotation: ScopeDisplayRotation,
  pixelSizeResolver?: PixelSizeResolver,
): { changed: boolean; layout: ScopeCanvasLayout } {
  const layout = measureScopeCanvasLayout(container, rotation)
  const resolvedPixels = pixelSizeResolver
    ? pixelSizeResolver(layout.cssWidth, layout.cssHeight, layout.dpr)
    : { width: layout.pixelWidth, height: layout.pixelHeight }

  canvas.style.width = `${layout.cssWidth}px`
  canvas.style.height = `${layout.cssHeight}px`

  const changed = canvas.width !== resolvedPixels.width || canvas.height !== resolvedPixels.height
  if (changed) {
    canvas.width = resolvedPixels.width
    canvas.height = resolvedPixels.height
  }

  return { changed, layout }
}

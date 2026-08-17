const DEFAULT_PIXEL_RATIO = 1

function normalizePositiveNumber(value: unknown, fallback = DEFAULT_PIXEL_RATIO): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function getComputedStyleForElement(element: Element): CSSStyleDeclaration | null {
  const ownerWindow = element.ownerDocument?.defaultView
  if (ownerWindow?.getComputedStyle) {
    return ownerWindow.getComputedStyle(element)
  }
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    return window.getComputedStyle(element)
  }
  return null
}

function parsePositiveCssPixelValue(value: string | null | undefined): number | null {
  if (!value) return null
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function getCanvasCssSize(canvas: HTMLCanvasElement, axis: 'width' | 'height'): number | null {
  const inlineSize = parsePositiveCssPixelValue(axis === 'width' ? canvas.style?.width : canvas.style?.height)
  if (inlineSize !== null) return inlineSize

  const computedStyle = getComputedStyleForElement(canvas)
  const computedSize = parsePositiveCssPixelValue(axis === 'width' ? computedStyle?.width : computedStyle?.height)
  if (computedSize !== null) return computedSize

  const clientSize = axis === 'width' ? canvas.clientWidth : canvas.clientHeight
  return Number.isFinite(clientSize) && clientSize > 0 ? clientSize : null
}

export function getCanvasBackingPixelRatio(canvas: HTMLCanvasElement): number {
  const cssWidth = getCanvasCssSize(canvas, 'width')
  if (cssWidth !== null && canvas.width > 0) {
    const ratio = canvas.width / cssWidth
    if (Number.isFinite(ratio) && ratio > 0) return ratio
  }

  const cssHeight = getCanvasCssSize(canvas, 'height')
  if (cssHeight !== null && canvas.height > 0) {
    const ratio = canvas.height / cssHeight
    if (Number.isFinite(ratio) && ratio > 0) return ratio
  }

  if (typeof window === 'undefined') return DEFAULT_PIXEL_RATIO
  return normalizePositiveNumber(window.devicePixelRatio)
}

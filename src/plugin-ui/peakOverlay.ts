import type { CSSProperties } from 'react'
import type { SpectrumPeakInfo } from '../types/spectrum'

/**
 * Peak-overlay positioning + formatting, mirroring ScopeModule.tsx so the plugin's
 * "following" peak readout behaves exactly like the Prism app. Kept as a local
 * copy (pure functions) so the plugin doesn't import the heavy ScopeModule.
 */

export interface CanvasResizeState {
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
  dpr: number
}

export interface SizeMeasurement {
  width: number
  height: number
}

const SPECTRUM_PEAK_OVERLAY_MARGIN_PX = 10
const SPECTRUM_PEAK_OVERLAY_FALLBACK_WIDTH_PX = 248
const SPECTRUM_PEAK_OVERLAY_FALLBACK_HEIGHT_PX = 42

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatSpectrumPeakDb(value: number): string {
  if (!Number.isFinite(value)) {
    return '--'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}dB`
}

export function formatSpectrumPeakFrequency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '--'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}kHz`
  }
  return `${value.toFixed(2)}Hz`
}

export function measureCanvasResizeState(container: HTMLElement): CanvasResizeState {
  const rect = container.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.floor(rect.width))
  const cssHeight = Math.max(1, Math.floor(rect.height))
  const dpr = window.devicePixelRatio || 1

  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.floor(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * dpr)),
    dpr,
  }
}

export function resolveFollowingPeakOverlayStyle(
  peakInfo: SpectrumPeakInfo,
  resizeState: CanvasResizeState | null,
  overlaySize: SizeMeasurement | null,
): CSSProperties {
  if (!resizeState) {
    return {
      left: `${SPECTRUM_PEAK_OVERLAY_MARGIN_PX}px`,
      top: `${SPECTRUM_PEAK_OVERLAY_MARGIN_PX}px`,
    }
  }

  const width = resizeState.cssWidth
  const height = resizeState.cssHeight
  const overlayWidth = overlaySize?.width ?? SPECTRUM_PEAK_OVERLAY_FALLBACK_WIDTH_PX
  const overlayHeight = overlaySize?.height ?? SPECTRUM_PEAK_OVERLAY_FALLBACK_HEIGHT_PX
  const peakX = peakInfo.normalizedX * width
  const peakY = peakInfo.normalizedY * height
  const maxLeft = Math.max(
    SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
    width - overlayWidth - SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
  )
  const maxTop = Math.max(
    SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
    height - overlayHeight - SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
  )

  const canPlaceAbove = peakY - overlayHeight >= SPECTRUM_PEAK_OVERLAY_MARGIN_PX
  const canPlaceBelow = peakY + overlayHeight <= height - SPECTRUM_PEAK_OVERLAY_MARGIN_PX

  const left = peakX
  const top = canPlaceAbove || !canPlaceBelow
    ? peakY - overlayHeight
    : peakY

  return {
    left: `${clampNumber(left, SPECTRUM_PEAK_OVERLAY_MARGIN_PX, maxLeft)}px`,
    top: `${clampNumber(top, SPECTRUM_PEAK_OVERLAY_MARGIN_PX, maxTop)}px`,
  }
}

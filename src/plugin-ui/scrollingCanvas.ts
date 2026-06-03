// The scrolling scopes (spectrogram + waveform) advance their waterfall by blitting
// the entire canvas onto itself every frame. That self-blit costs ~canvas area per
// frame and WKWebView's 2D canvas handles it far less efficiently than Chromium, so a
// large plugin window blows the frame budget even at low scroll speeds. Cap the
// backing-store resolution so the per-frame cost stays bounded regardless of window
// size; the canvas is CSS-stretched to fill, so it just looks slightly softer when the
// window is very large. Typical sizes stay fully crisp (they fall under the budget).
//
// Bonus for the spectrogram: rowCount is derived from the canvas height, so capping
// here also shrinks the per-column DSP work and the bridge payload.
const MAX_DEVICE_PIXELS = 2_000_000

export function resolveScrollingCanvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1
  let width = Math.max(1, Math.floor(cssWidth * dpr))
  let height = Math.max(1, Math.floor(cssHeight * dpr))

  const pixels = width * height
  if (pixels > MAX_DEVICE_PIXELS) {
    const scale = Math.sqrt(MAX_DEVICE_PIXELS / pixels)
    width = Math.max(1, Math.floor(width * scale))
    height = Math.max(1, Math.floor(height * scale))
  }

  return { width, height }
}

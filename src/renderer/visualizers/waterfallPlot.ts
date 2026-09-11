import { WATERFALL_RIDGES, type WaterfallDensity, type WaterfallFrame } from '../../types/waterfall'

// Keep the live spectrum's relief independent of history density. Reserve the
// remaining height for age, with enough headroom for the oldest spectrum's peaks.
const SPECTRUM_HEIGHT_RATIO = 0.32
const MIN_RIDGE_SPACING = 5

export function waterfallPlotLayout(height: number, density: WaterfallDensity, showGuides: boolean) {
  const bottom = height - (showGuides ? 22 : 10)
  const plotHeight = Math.max(1, bottom - 8)
  const amplitude = plotHeight * SPECTRUM_HEIGHT_RATIO
  const historyHeight = plotHeight - amplitude
  const ridgeCount = Math.max(2, Math.min(WATERFALL_RIDGES[density], Math.floor(historyHeight / MIN_RIDGE_SPACING) + 1))
  return {
    bottom,
    ridgeCount,
    spacing: historyHeight / (ridgeCount - 1),
    amplitude,
    historyHeight,
  }
}

export function waterfallRidgeHeight(db: number, amplitude: number): number {
  return Math.max(0, Math.min(1, (db + 90) / 80)) * amplitude
}

// One light three-point energy filter softens fine bin jitter. At full plot
// resolution the center retains 60% of its energy, limiting an isolated peak's
// attenuation to 2.22 dB. Coarser projections need less additional softening.
// Each spectrum is treated identically and independently: moving into history
// must never reshape it through averaging with other moments in time.
export function softenWaterfallSpectra(frame: WaterfallFrame): Float32Array {
  if (frame.columns < 2 || frame.ages.length === 0) return new Float32Array(frame.levels)
  const source = Float32Array.from(frame.levels, (db) => 10 ** (db / 10))
  const result = new Float32Array(source.length)
  const neighborWeight = 0.2 * Math.min(1, (frame.columns - 1) / 512)
  const centerWeight = 1 - 2 * neighborWeight
  for (let row = 0; row < source.length; row += frame.columns) {
    for (let column = 0; column < frame.columns; ++column) {
      const energy = source[row + column] * centerWeight
        + source[row + Math.max(0, column - 1)] * neighborWeight
        + source[row + Math.min(frame.columns - 1, column + 1)] * neighborWeight
      result[row + column] = 10 * Math.log10(Math.max(1e-20, energy))
    }
  }
  return result
}

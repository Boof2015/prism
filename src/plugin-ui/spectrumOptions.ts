import type { ScopeSettings } from '../types/settings'
import type { ResolvedSpectrumTheme } from '../types/theme'
import type { SpectrumAnalyzerOptions } from '../renderer/visualizers/SpectrumAnalyzer'
import { nominalFrequencyBoundsForRange } from '../types/frequencyScale'

/**
 * Map Prism's spectrum settings + resolved theme to SpectrumAnalyzer options.
 * Mirrors the `spectrum` case of `scopeSettingsToOptions` in ScopeModule.tsx —
 * kept local so the spectrum plugin doesn't pull in every other visualizer.
 */
export function spectrumSettingsToOptions(
  settings: ScopeSettings['spectrum'],
  theme: ResolvedSpectrumTheme,
): SpectrumAnalyzerOptions {
  const range = nominalFrequencyBoundsForRange(settings.frequencyRangeMode)
  return {
    lineColor: theme.line,
    secondaryLineColor: theme.sideLine,
    gradientColors: theme.fillGradient,
    heatColors: theme.heatColors,
    heatBaseColor: theme.heatBase,
    backgroundColor: theme.background,
    gridColor: theme.guides,
    scaleType: settings.scaleMode,
    minFrequency: range.minFrequency,
    maxFrequency: range.maxFrequency,
    fftSize: settings.fftSize,
    tiltDbPerOctave: settings.tiltDbPerOctave,
    heatmapFill: settings.heatmap,
    heatmapTiltDbPerOctave: settings.heatmapTiltDbPerOctave,
    heatmapSmoothing: settings.heatmapSmoothing,
    showGrid: settings.showGrid,
    fillGradient: settings.fillGradient,
    smoothing: settings.smoothing,
    showSideLine: settings.showSideLine,
  }
}

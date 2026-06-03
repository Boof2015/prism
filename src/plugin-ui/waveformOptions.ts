import type { ScopeSettings } from '../types/settings'
import type { ResolvedWaveformTheme } from '../types/theme'
import type { WaveformOptions } from '../renderer/visualizers/Waveform'

/**
 * Map Prism's waveform settings + resolved theme to Waveform options.
 * Mirrors the `waveform` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function waveformSettingsToOptions(
  settings: ScopeSettings['waveform'],
  theme: ResolvedWaveformTheme,
): WaveformOptions {
  return {
    backgroundColor: theme.background,
    lineColor: theme.line,
    gridMajorColor: theme.guides,
    gridMinorColor: theme.guidesSecondary,
    bandColors: {
      low: theme.bandLow,
      mid: theme.bandMid,
      high: theme.bandHigh,
    },
    mode: settings.mode,
    scrollSpeed: settings.scrollSpeed,
    multiband: settings.multiband,
  }
}

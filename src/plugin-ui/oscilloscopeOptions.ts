import type { ScopeSettings } from '../types/settings'
import type { ResolvedOscilloscopeTheme } from '../types/theme'
import type { OscilloscopeOptions } from '../renderer/visualizers/Oscilloscope'

/**
 * Map Prism's oscilloscope settings + resolved theme to Oscilloscope options.
 * Mirrors the `oscilloscope` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function oscilloscopeSettingsToOptions(
  settings: ScopeSettings['oscilloscope'],
  theme: ResolvedOscilloscopeTheme,
): OscilloscopeOptions {
  return {
    lineColor: theme.line,
    backgroundColor: theme.background,
    gridMajorColor: theme.guides,
    gridMinorColor: theme.guidesSecondary,
    underfillColor: theme.fill,
    pitchLock: settings.pitchLock,
    underfillEnabled: settings.underfillEnabled,
    showGrid: settings.showGrid,
    lineWidth: settings.lineWidth,
  }
}

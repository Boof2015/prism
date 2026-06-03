import type { ScopeSettings } from '../types/settings'
import type { ResolvedLUFSMeterTheme } from '../types/theme'
import type { LUFSMeterOptions } from '../renderer/visualizers/LUFSMeter'

/**
 * Map Prism's loudness meter settings + resolved theme to LUFSMeter options.
 * Mirrors the `lufsmeter` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function lufsmeterSettingsToOptions(
  settings: ScopeSettings['lufsmeter'],
  theme: ResolvedLUFSMeterTheme,
): LUFSMeterOptions {
  return {
    backgroundColor: theme.background,
    lineColor: theme.level,
    trackColor: theme.track,
    targetColor: theme.target,
    scaleColor: theme.scale,
    labelColor: theme.labels,
    mode: settings.mode,
    readout: settings.readout,
  }
}

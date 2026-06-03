import type { ScopeSettings } from '../types/settings'
import type { ResolvedVUMeterTheme } from '../types/theme'
import type { VUMeterOptions } from '../renderer/visualizers/VUMeter'

/**
 * Map Prism's VU meter settings + resolved theme to VUMeter options.
 * Mirrors the `vumeter` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function vumeterSettingsToOptions(
  settings: ScopeSettings['vumeter'],
  theme: ResolvedVUMeterTheme,
): VUMeterOptions {
  return {
    backgroundColor: theme.background,
    lineColor: theme.level,
    trackColor: theme.track,
    peakColor: theme.peak,
    clipColor: theme.clip,
    scaleColor: theme.scale,
    labelColor: theme.labels,
    needleLeftColor: theme.needleLeft,
    needleRightColor: theme.needleRight,
    needleCombinedColor: theme.needleCombined,
    mode: settings.mode,
    orientation: settings.orientation,
    needleChannels: settings.needleChannels,
    referenceDb: settings.referenceDb,
  }
}

import type { ScopeSettings } from '../types/settings'
import type { ResolvedVectorscopeTheme } from '../types/theme'
import type { VectorscopeOptions } from '../renderer/visualizers/Vectorscope'

/**
 * Map Prism's vectorscope settings + resolved theme to Vectorscope options.
 * Mirrors the `vectorscope` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function vectorscopeSettingsToOptions(
  settings: ScopeSettings['vectorscope'],
  theme: ResolvedVectorscopeTheme,
): VectorscopeOptions {
  return {
    lineColor: theme.trace,
    backgroundColor: theme.background,
    gridMajorColor: theme.guides,
    gridMinorColor: theme.guidesSecondary,
    labelColor: theme.labels,
    phaseRiskColor: theme.phaseRisk,
    bandColors: {
      low: theme.bandLow,
      mid: theme.bandMid,
      high: theme.bandHigh,
    },
    mode: settings.mode,
    zoomDb: settings.zoomDb,
    multiband: settings.multiband,
    showGrid: settings.showGrid,
    persistence: settings.persistence,
    lineWidth: settings.lineWidth,
  }
}

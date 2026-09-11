import type { WaterfallSettings } from '../types/waterfall'
import type { ResolvedWaterfallTheme } from '../types/theme'
import type { WaterfallOptions } from '../renderer/visualizers/Waterfall'

export function waterfallSettingsToOptions(settings: WaterfallSettings, theme: ResolvedWaterfallTheme): WaterfallOptions {
  return {
    ...settings, lineColor: theme.line, backgroundColor: theme.background,
    gridColor: theme.guides, labelColor: theme.labels, heatColors: theme.heatColors,
  }
}

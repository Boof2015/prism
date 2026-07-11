import type { ScopeSettings } from '../types/settings'
import type { ResolvedSpectrogramTheme } from '../types/theme'
import type { SpectrogramOptions } from '../renderer/visualizers/Spectrogram'

/**
 * Map Prism's spectrogram settings + resolved theme to Spectrogram options.
 * Mirrors the `spectrogram` case of `scopeSettingsToOptions` in ScopeModule.tsx.
 */
export function spectrogramSettingsToOptions(
  settings: ScopeSettings['spectrogram'],
  theme: ResolvedSpectrogramTheme,
): SpectrogramOptions {
  return {
    lineColor: theme.mono,
    heatColors: theme.heatColors,
    backgroundColor: theme.background,
    fftSize: settings.fftSize,
    tiltDbPerOctave: settings.tiltDbPerOctave,
    scrollSpeed: settings.scrollSpeed,
    contrast: settings.contrast,
    clarityMode: settings.clarityMode,
    scaleMode: settings.scaleMode,
    orientation: 'horizontal',
    colorScheme: settings.colorScheme,
  }
}

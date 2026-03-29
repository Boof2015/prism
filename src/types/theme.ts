import type { ScopeKind } from './scope'

export const THEME_FILE_FORMAT = 'prism-theme'
export const THEME_FILE_VERSION = 1
export const THEME_LOCAL_STATE_FORMAT = 'prism-theme-local'
export const THEME_LOCAL_STATE_VERSION = 1
export const LEGACY_THEME_MIGRATION_VERSION = 1
export const DEFAULT_THEME_ID = 'theme_default'
export const DEFAULT_THEME_NAME = 'Default'

export type ThemeSectionName =
  | 'all'
  | 'interface'
  | ScopeKind

export interface ThemeTokens {
  primary?: string
  secondary?: string
  guides?: string
  text?: string
  background?: string
  lowBand?: string
  midBand?: string
  highBand?: string
  fill?: string
  peak?: string
  clip?: string
  target?: string
  heatLow?: string
  heatMid?: string
  heatHigh?: string
  success?: string
  warning?: string
  danger?: string
}

export interface PrismTheme {
  id: string
  name: string
  credit?: string
  website?: string
  description?: string
  all: ThemeTokens
  interface: ThemeTokens
  spectrum: ThemeTokens
  oscilloscope: ThemeTokens
  vectorscope: ThemeTokens
  spectrogram: ThemeTokens
  vumeter: ThemeTokens
  lufsmeter: ThemeTokens
  waveform: ThemeTokens
  astra: ThemeTokens
}

export interface PrismThemeLocalStateV1 {
  format: typeof THEME_LOCAL_STATE_FORMAT
  version: typeof THEME_LOCAL_STATE_VERSION
  migrationVersion: number
  activeThemeId: string | null
}

export interface ThemeSummary {
  id: string
  name: string
  isDefault: boolean
}

export interface ThemeLibrarySnapshot {
  themes: Record<string, PrismTheme>
  activeThemeId: string | null
}

export interface LegacyThemeMigrationPayload {
  presetId: string | null
  customAccent: string | null
}

export interface LegacyThemeMigrationResult {
  didMigrate: boolean
  snapshot: ThemeLibrarySnapshot
}

export interface ResolvedInterfaceTheme {
  primary: string
  secondary: string
  guides: string
  text: string
  background: string
  accent: string
  accentHover: string
  accentGlow: string
  accentRgb: string
  bgPrimary: string
  bgSecondary: string
  bgTertiary: string
  panelSurface: string
  panelSurfaceSoft: string
  panelOutline: string
  panelOutlineStrong: string
  glassBg: string
  glassBorder: string
  glassHighlight: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textMuted: string
  toolbarBg: string
  settingsBgTop: string
  settingsBgBottom: string
  bottomBarBg: string
  menuBg: string
  menuBorder: string
  controlBg: string
  controlBgHover: string
  controlBgActive: string
  controlBorder: string
  controlBorderActive: string
  inputBg: string
  inputBgFocus: string
  inputBorder: string
  inputBorderFocus: string
  divider: string
  success: string
  warning: string
  danger: string
}

export interface ResolvedSpectrumTheme {
  primary: string
  secondary: string
  guides: string
  background: string
  fillGradient: [string, string, string]
  heatColors: [string, string, string]
}

export interface ResolvedOscilloscopeTheme {
  primary: string
  guides: string
  background: string
  fill: string
}

export interface ResolvedVectorscopeTheme {
  primary: string
  guides: string
  background: string
  lowBand: string
  midBand: string
  highBand: string
}

export interface ResolvedSpectrogramTheme {
  primary: string
  guides: string
  background: string
  heatColors: [string, string, string]
}

export interface ResolvedVUMeterTheme {
  primary: string
  peak: string
  clip: string
  guides: string
  text: string
  background: string
}

export interface ResolvedLUFSMeterTheme {
  primary: string
  target: string
  guides: string
  text: string
  background: string
}

export interface ResolvedWaveformTheme {
  primary: string
  guides: string
  background: string
  lowBand: string
  midBand: string
  highBand: string
}

export interface ResolvedAstraTheme {
  accent: string
  text: string
  subtext: string
  background: string
  surface: string
  border: string
  progressTrack: string
  progressFill: string
  buttonBg: string
  buttonBgHover: string
  buttonBgActive: string
  buttonBorder: string
  buttonText: string
  statusOk: string
  statusError: string
}

export interface PrismResolvedTheme {
  id: string
  name: string
  credit?: string
  website?: string
  description?: string
  interface: ResolvedInterfaceTheme
  spectrum: ResolvedSpectrumTheme
  oscilloscope: ResolvedOscilloscopeTheme
  vectorscope: ResolvedVectorscopeTheme
  spectrogram: ResolvedSpectrogramTheme
  vumeter: ResolvedVUMeterTheme
  lufsmeter: ResolvedLUFSMeterTheme
  waveform: ResolvedWaveformTheme
  astra: ResolvedAstraTheme
}

import type { ScopeKind } from './scope'

export const THEME_FILE_FORMAT = 'prism-theme'
export const THEME_FILE_VERSION = 2
export const THEME_LOCAL_STATE_FORMAT = 'prism-theme-local'
export const THEME_LOCAL_STATE_VERSION = 1
export const LEGACY_THEME_MIGRATION_VERSION = 1
export const DEFAULT_THEME_NAME = 'Default'

export type ThemeSectionName =
  | 'app'
  | 'controls'
  | 'scopes'
  | ScopeKind

export interface ThemeAppTokens {
  accent?: string
  success?: string
  warning?: string
  danger?: string
  background?: string
  surface?: string
  surfaceAlt?: string
  border?: string
  text?: string
  textMuted?: string
  toolbarBg?: string
  settingsBgTop?: string
  settingsBgBottom?: string
  bottomBarBg?: string
}

export interface ThemeControlsTokens {
  surface?: string
  surfaceHover?: string
  surfaceActive?: string
  border?: string
  borderActive?: string
  text?: string
  inputSurface?: string
  inputBorder?: string
  menuSurface?: string
  menuBorder?: string
  slider?: string
  flatControls?: string
}

export interface ThemeScopesTokens {
  background?: string
  guides?: string
  overlaySurface?: string
  overlayText?: string
  overlayBorder?: string
  resizeHandle?: string
}

export interface ThemeSpectrumTokens {
  background?: string
  line?: string
  sideLine?: string
  fill?: string
  heatLow?: string
  heatMid?: string
  heatHigh?: string
  heatBase?: string
  guides?: string
  labels?: string
}

export interface ThemeOscilloscopeTokens {
  background?: string
  line?: string
  fill?: string
  guides?: string
}

export interface ThemeVectorscopeTokens {
  background?: string
  trace?: string
  bandLow?: string
  bandMid?: string
  bandHigh?: string
  guides?: string
  labels?: string
}

export interface ThemeSpectrogramTokens {
  background?: string
  mono?: string
  heatLow?: string
  heatMid?: string
  heatHigh?: string
  guides?: string
  labels?: string
}

export interface ThemeVUMeterTokens {
  background?: string
  level?: string
  track?: string
  peak?: string
  clip?: string
  scale?: string
  labels?: string
  needleLeft?: string
  needleRight?: string
  needleCombined?: string
}

export interface ThemeLUFSMeterTokens {
  background?: string
  level?: string
  track?: string
  target?: string
  scale?: string
  labels?: string
}

export interface ThemeWaveformTokens {
  background?: string
  line?: string
  bandLow?: string
  bandMid?: string
  bandHigh?: string
  guides?: string
}

export interface ThemeNowPlayingTokens {
  accent?: string
  background?: string
  surface?: string
  border?: string
  text?: string
  progressTrack?: string
  progressFill?: string
  buttonSurface?: string
  buttonBorder?: string
  statusOk?: string
  statusError?: string
}

export type ThemeAstraTokens = ThemeNowPlayingTokens

export interface PrismTheme {
  name: string
  credit?: string
  website?: string
  description?: string
  app: ThemeAppTokens
  controls: ThemeControlsTokens
  scopes: ThemeScopesTokens
  spectrum: ThemeSpectrumTokens
  oscilloscope: ThemeOscilloscopeTokens
  vectorscope: ThemeVectorscopeTokens
  spectrogram: ThemeSpectrogramTokens
  vumeter: ThemeVUMeterTokens
  lufsmeter: ThemeLUFSMeterTokens
  waveform: ThemeWaveformTokens
  nowPlaying: ThemeNowPlayingTokens
}

export interface PrismThemeLocalStateV1 {
  format: typeof THEME_LOCAL_STATE_FORMAT
  version: typeof THEME_LOCAL_STATE_VERSION
  migrationVersion: number
  activeThemeId: string | null
}

export interface ThemeSummary {
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
  border: string
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
  colorScheme: 'light' | 'dark'
  glassBg: string
  glassBorder: string
  glassHighlight: string
  glassHighlightStrong: string
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
  controlText: string
  inputBg: string
  inputBgFocus: string
  inputBorder: string
  inputBorderFocus: string
  optionBg: string
  optionText: string
  sliderTrack: string
  sliderFill: string
  sliderThumb: string
  divider: string
  scopeBackground: string
  scopeGuides: string
  scopeOverlayBg: string
  scopeOverlayText: string
  scopeOverlayBorder: string
  scopeResizeHandle: string
  success: string
  warning: string
  danger: string
}

export interface ResolvedSpectrumTheme {
  line: string
  sideLine: string
  guides: string
  guidesSecondary: string
  labels: string
  background: string
  fill: string
  fillGradient: [string, string, string]
  heatColors: [string, string, string]
  heatBase: string
}

export interface ResolvedOscilloscopeTheme {
  line: string
  guides: string
  guidesSecondary: string
  background: string
  fill: string
}

export interface ResolvedVectorscopeTheme {
  trace: string
  guides: string
  guidesSecondary: string
  labels: string
  background: string
  bandLow: string
  bandMid: string
  bandHigh: string
}

export interface ResolvedSpectrogramTheme {
  mono: string
  background: string
  heatColors: [string, string, string]
  guides: string
  labels: string
}

export interface ResolvedVUMeterTheme {
  level: string
  track: string
  peak: string
  clip: string
  scale: string
  labels: string
  needleLeft: string
  needleRight: string
  needleCombined: string
  background: string
}

export interface ResolvedLUFSMeterTheme {
  level: string
  track: string
  target: string
  scale: string
  labels: string
  background: string
}

export interface ResolvedWaveformTheme {
  line: string
  guides: string
  guidesSecondary: string
  background: string
  bandLow: string
  bandMid: string
  bandHigh: string
}

export interface ResolvedNowPlayingTheme {
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

export type ResolvedAstraTheme = ResolvedNowPlayingTheme

export interface PrismResolvedTheme {
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
  nowPlaying: ResolvedNowPlayingTheme
}

import {
  DEFAULT_THEME_NAME,
  LEGACY_THEME_MIGRATION_VERSION,
  THEME_FILE_FORMAT,
  THEME_FILE_VERSION,
  THEME_LOCAL_STATE_FORMAT,
  THEME_LOCAL_STATE_VERSION,
  type LegacyThemeMigrationPayload,
  type PrismResolvedTheme,
  type PrismTheme,
  type PrismThemeLocalStateV1,
  type ResolvedNowPlayingTheme,
  type ResolvedInterfaceTheme,
  type ResolvedLUFSMeterTheme,
  type ResolvedOscilloscopeTheme,
  type ResolvedSpectrogramTheme,
  type ResolvedSpectrumTheme,
  type ResolvedVectorscopeTheme,
  type ResolvedVUMeterTheme,
  type ResolvedWaveformTheme,
  type ThemeAppTokens,
  type ThemeControlsTokens,
  type ThemeLUFSMeterTokens,
  type ThemeOscilloscopeTokens,
  type ThemeScopesTokens,
  type ThemeSectionName,
  type ThemeSpectrogramTokens,
  type ThemeSpectrumTokens,
  type ThemeVectorscopeTokens,
  type ThemeVUMeterTokens,
  type ThemeWaveformTokens,
  type ThemeNowPlayingTokens,
} from '../types/theme'

const DEFAULT_ACCENT = '#38bdf8'
const DEFAULT_SUCCESS = '#22c55e'
const DEFAULT_WARNING = 'rgb(255, 191, 0)'
const DEFAULT_DANGER = '#f87171'
const DEFAULT_SCOPE_GUIDES = 'rgba(255, 255, 255, 0.1)'
const DEFAULT_SCOPE_OVERLAY_BG = 'rgba(8, 12, 18, 0.88)'
const DEFAULT_SCOPE_OVERLAY_TEXT = 'rgba(255, 255, 255, 0.76)'
const DEFAULT_SCOPE_OVERLAY_BORDER = 'rgba(255, 255, 255, 0.12)'
const DEFAULT_SCOPE_RESIZE_HANDLE = 'rgba(255, 255, 255, 0.12)'
const DEFAULT_BAND_LOW = '#ff4444'
const DEFAULT_BAND_MID = '#44dd44'
const DEFAULT_BAND_HIGH = '#4488ff'
const DEFAULT_HEAT_LOW = 'rgb(15, 7, 33)'
const DEFAULT_HEAT_MID = 'rgb(163, 26, 121)'
const DEFAULT_HEAT_HIGH = 'rgb(255, 241, 209)'
const DEFAULT_VU_NEEDLE_LEFT = 'rgb(199, 223, 255)'
const DEFAULT_VU_NEEDLE_RIGHT = 'rgb(255, 71, 126)'
const DEFAULT_VU_NEEDLE_COMBINED = 'rgb(244, 248, 255)'

type SectionTokenMap = Partial<Record<string, string>>
type SectionSchema<T extends object> = Record<string, Extract<keyof T, string>>

const APP_SCHEMA = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  background: 'background',
  surface: 'surface',
  surface_alt: 'surfaceAlt',
  border: 'border',
  text: 'text',
  text_muted: 'textMuted',
  toolbar_bg: 'toolbarBg',
  settings_bg_top: 'settingsBgTop',
  settings_bg_bottom: 'settingsBgBottom',
  bottom_bar_bg: 'bottomBarBg',
} as const satisfies SectionSchema<ThemeAppTokens>

const CONTROLS_SCHEMA = {
  surface: 'surface',
  surface_hover: 'surfaceHover',
  surface_active: 'surfaceActive',
  border: 'border',
  border_active: 'borderActive',
  text: 'text',
  input_surface: 'inputSurface',
  input_border: 'inputBorder',
  menu_surface: 'menuSurface',
  menu_border: 'menuBorder',
  slider: 'slider',
  flat_controls: 'flatControls',
} as const satisfies SectionSchema<ThemeControlsTokens>

const SCOPES_SCHEMA = {
  background: 'background',
  guides: 'guides',
  overlay_surface: 'overlaySurface',
  overlay_text: 'overlayText',
  overlay_border: 'overlayBorder',
  resize_handle: 'resizeHandle',
} as const satisfies SectionSchema<ThemeScopesTokens>

const SPECTRUM_SCHEMA = {
  background: 'background',
  line: 'line',
  side_line: 'sideLine',
  fill: 'fill',
  heat_low: 'heatLow',
  heat_mid: 'heatMid',
  heat_high: 'heatHigh',
  heat_base: 'heatBase',
  guides: 'guides',
  labels: 'labels',
} as const satisfies SectionSchema<ThemeSpectrumTokens>

const OSCILLOSCOPE_SCHEMA = {
  background: 'background',
  line: 'line',
  fill: 'fill',
  guides: 'guides',
} as const satisfies SectionSchema<ThemeOscilloscopeTokens>

const VECTORSCOPE_SCHEMA = {
  background: 'background',
  trace: 'trace',
  phase_risk: 'phaseRisk',
  band_low: 'bandLow',
  band_mid: 'bandMid',
  band_high: 'bandHigh',
  guides: 'guides',
  labels: 'labels',
} as const satisfies SectionSchema<ThemeVectorscopeTokens>

const SPECTROGRAM_SCHEMA = {
  background: 'background',
  mono: 'mono',
  heat_low: 'heatLow',
  heat_mid: 'heatMid',
  heat_high: 'heatHigh',
  guides: 'guides',
  labels: 'labels',
} as const satisfies SectionSchema<ThemeSpectrogramTokens>

const VUMETER_SCHEMA = {
  background: 'background',
  level: 'level',
  track: 'track',
  peak: 'peak',
  clip: 'clip',
  scale: 'scale',
  labels: 'labels',
  needle_left: 'needleLeft',
  needle_right: 'needleRight',
  needle_combined: 'needleCombined',
} as const satisfies SectionSchema<ThemeVUMeterTokens>

const LUFSMETER_SCHEMA = {
  background: 'background',
  level: 'level',
  track: 'track',
  target: 'target',
  scale: 'scale',
  labels: 'labels',
} as const satisfies SectionSchema<ThemeLUFSMeterTokens>

const WAVEFORM_SCHEMA = {
  background: 'background',
  line: 'line',
  band_low: 'bandLow',
  band_mid: 'bandMid',
  band_high: 'bandHigh',
  guides: 'guides',
} as const satisfies SectionSchema<ThemeWaveformTokens>

const NOW_PLAYING_SCHEMA = {
  accent: 'accent',
  background: 'background',
  surface: 'surface',
  border: 'border',
  text: 'text',
  progress_track: 'progressTrack',
  progress_fill: 'progressFill',
  button_surface: 'buttonSurface',
  button_border: 'buttonBorder',
  status_ok: 'statusOk',
  status_error: 'statusError',
} as const satisfies SectionSchema<ThemeNowPlayingTokens>

const SECTION_KEY_MAP: Record<string, ThemeSectionName> = {
  app: 'app',
  controls: 'controls',
  scopes: 'scopes',
  spectrum: 'spectrum',
  oscilloscope: 'oscilloscope',
  vectorscope: 'vectorscope',
  spectrogram: 'spectrogram',
  vumeter: 'vumeter',
  lufsmeter: 'lufsmeter',
  waveform: 'waveform',
  now_playing: 'nowPlaying',
  astra: 'nowPlaying',
}

const SECTION_LABEL_MAP: Record<ThemeSectionName, string> = {
  app: 'App',
  controls: 'Controls',
  scopes: 'Scopes',
  spectrum: 'Spectrum',
  oscilloscope: 'Oscilloscope',
  vectorscope: 'Vectorscope',
  spectrogram: 'Spectrogram',
  vumeter: 'VUMeter',
  lufsmeter: 'LUFSMeter',
  waveform: 'Waveform',
  nowPlaying: 'Now Playing',
}

const SECTION_SCHEMAS = {
  app: APP_SCHEMA,
  controls: CONTROLS_SCHEMA,
  scopes: SCOPES_SCHEMA,
  spectrum: SPECTRUM_SCHEMA,
  oscilloscope: OSCILLOSCOPE_SCHEMA,
  vectorscope: VECTORSCOPE_SCHEMA,
  spectrogram: SPECTROGRAM_SCHEMA,
  vumeter: VUMETER_SCHEMA,
  lufsmeter: LUFSMETER_SCHEMA,
  waveform: WAVEFORM_SCHEMA,
  nowPlaying: NOW_PLAYING_SCHEMA,
} as const

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseByte(token: string): number | null {
  const value = Number.parseFloat(token.trim())
  if (!Number.isFinite(value)) return null
  return clampByte(value)
}

function parseThemeChannelColor(value: string): RgbaColor | null {
  const parts = value.split(',').map((token) => token.trim()).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null

  const r = parseByte(parts[0])
  const g = parseByte(parts[1])
  const b = parseByte(parts[2])
  if (r === null || g === null || b === null) return null

  const a = parts.length === 4 ? parseByte(parts[3]) : 255
  if (a === null) return null

  return {
    r,
    g,
    b,
    a: clampAlpha(a / 255),
  }
}

function parseCssToken(token: string): number | null {
  const trimmed = token.trim()
  if (!trimmed) return null

  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1))
    if (!Number.isFinite(percent)) return null
    return clampByte((percent / 100) * 255)
  }

  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value)) return null
  return clampByte(value)
}

function parseCssAlpha(token: string): number | null {
  const trimmed = token.trim()
  if (!trimmed) return null

  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1))
    if (!Number.isFinite(percent)) return null
    return clampAlpha(percent / 100)
  }

  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value)) return null
  return value > 1 ? clampAlpha(value / 255) : clampAlpha(value)
}

function parseCssColor(value: string): RgbaColor | null {
  const normalized = value.trim()
  if (!normalized) return null

  if (normalized.startsWith('#')) {
    const raw = normalized.slice(1)
    const expanded = raw.length === 3 || raw.length === 4
      ? raw.split('').map((part) => `${part}${part}`).join('')
      : raw

    if (expanded.length !== 6 && expanded.length !== 8) return null

    const r = Number.parseInt(expanded.slice(0, 2), 16)
    const g = Number.parseInt(expanded.slice(2, 4), 16)
    const b = Number.parseInt(expanded.slice(4, 6), 16)
    const a = expanded.length === 8
      ? Number.parseInt(expanded.slice(6, 8), 16) / 255
      : 1

    if ([r, g, b].some((channel) => Number.isNaN(channel))) return null
    return { r, g, b, a: clampAlpha(a) }
  }

  const match = /^rgba?\((.*)\)$/i.exec(normalized)
  if (!match) return null

  const body = match[1]?.trim() ?? ''
  if (!body) return null

  const [colorPart, alphaPart] = body.includes('/')
    ? body.split('/', 2)
    : [body, undefined]

  const colorTokens = colorPart.includes(',')
    ? colorPart.split(',').map((token) => token.trim())
    : colorPart.split(/\s+/).filter(Boolean)

  if (colorTokens.length < 3) return null

  const r = parseCssToken(colorTokens[0])
  const g = parseCssToken(colorTokens[1])
  const b = parseCssToken(colorTokens[2])
  if (r === null || g === null || b === null) return null

  const rawAlpha = alphaPart ?? colorTokens[3]
  const a = rawAlpha ? parseCssAlpha(rawAlpha) : 1
  if (a === null) return null

  return { r, g, b, a }
}

function getPerceivedBrightness(color: RgbaColor): number {
  return ((color.r * 299) + (color.g * 587) + (color.b * 114)) / 1000
}

function toCssColor(color: RgbaColor): string {
  if (Math.abs(color.a - 1) < 0.001) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`
}

function quantizeThemeColor(color: RgbaColor): RgbaColor {
  return {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b),
    a: clampAlpha(clampByte(color.a * 255) / 255),
  }
}

function toThemeChannels(color: string): string {
  const parsed = parseCssColor(color)
  if (!parsed) return '0, 0, 0'
  if (Math.abs(parsed.a - 1) < 0.001) {
    return `${parsed.r}, ${parsed.g}, ${parsed.b}`
  }
  return `${parsed.r}, ${parsed.g}, ${parsed.b}, ${clampByte(parsed.a * 255)}`
}

function withAlpha(color: string, alpha: number): string {
  const parsed = parseCssColor(color)
  if (!parsed) return color
  return toCssColor({ ...parsed, a: clampAlpha(alpha) })
}

function multiplyAlpha(color: string, factor: number): string {
  const parsed = parseCssColor(color)
  if (!parsed) return color
  return toCssColor({ ...parsed, a: clampAlpha(parsed.a * factor) })
}

function mixColors(left: string, right: string, amount: number): string {
  const leftColor = parseCssColor(left)
  const rightColor = parseCssColor(right)
  if (!leftColor) return right
  if (!rightColor) return left

  const t = clampAlpha(amount)
  return toCssColor({
    r: clampByte(leftColor.r + (rightColor.r - leftColor.r) * t),
    g: clampByte(leftColor.g + (rightColor.g - leftColor.g) * t),
    b: clampByte(leftColor.b + (rightColor.b - leftColor.b) * t),
    a: clampAlpha(leftColor.a + (rightColor.a - leftColor.a) * t),
  })
}

function lighten(color: string, amount: number): string {
  return mixColors(color, 'rgb(255, 255, 255)', amount)
}

function darken(color: string, amount: number): string {
  return mixColors(color, 'rgb(0, 0, 0)', amount)
}

function colorToRgbChannels(color: string): string {
  const parsed = parseCssColor(color)
  if (!parsed) return '0, 0, 0'
  return `${parsed.r}, ${parsed.g}, ${parsed.b}`
}

function blendText(primary: string, muted: string, amount: number): string {
  return mixColors(primary, muted, clampAlpha(amount))
}

function createEmptyTheme(): PrismTheme {
  return {
    name: DEFAULT_THEME_NAME,
    app: {},
    controls: {},
    scopes: {},
    spectrum: {},
    oscilloscope: {},
    vectorscope: {},
    spectrogram: {},
    vumeter: {},
    lufsmeter: {},
    waveform: {},
    nowPlaying: {},
  }
}

const PASSTHROUGH_KEYS: ReadonlySet<string> = new Set(['flatControls'])

function normalizeSectionTokens<T extends SectionTokenMap>(
  raw: unknown,
  schema: SectionSchema<T>,
): T {
  if (typeof raw !== 'object' || raw === null) {
    return {} as T
  }

  const parsed = raw as Record<string, unknown>
  const next = {} as T

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') continue

    const key = Object.entries(schema).find(([serializedKey, propertyKey]) => {
      return propertyKey === rawKey || serializedKey === normalizeKey(rawKey)
    })?.[1] as keyof T | undefined
    if (!key) continue

    if (PASSTHROUGH_KEYS.has(key as string)) {
      next[key] = rawValue as T[typeof key]
      continue
    }

    const parsedColor = parseCssColor(rawValue) ?? parseThemeChannelColor(rawValue)
    if (!parsedColor) continue
    next[key] = toCssColor(quantizeThemeColor(parsedColor)) as T[typeof key]
  }

  return next
}

export function createDefaultTheme(): PrismTheme {
  return normalizeTheme({
    name: DEFAULT_THEME_NAME,
    credit: 'Prism',
    app: {
      accent: DEFAULT_ACCENT,
      success: DEFAULT_SUCCESS,
      warning: DEFAULT_WARNING,
      danger: DEFAULT_DANGER,
      background: 'rgb(0, 0, 0)',
      surface: 'rgba(8, 11, 16, 0.92)',
      surfaceAlt: 'rgba(4, 8, 12, 0.98)',
      border: 'rgba(255, 255, 255, 0.09)',
      text: 'rgb(255, 255, 255)',
      textMuted: 'rgba(255, 255, 255, 0.42)',
    },
    controls: {
      surface: 'rgba(255, 255, 255, 0.03)',
      surfaceHover: 'rgba(255, 255, 255, 0.06)',
      surfaceActive: 'rgba(56, 189, 248, 0.12)',
      border: 'rgba(255, 255, 255, 0.08)',
      borderActive: 'rgba(56, 189, 248, 0.28)',
      text: 'rgba(255, 255, 255, 0.92)',
      inputSurface: 'rgba(10, 14, 20, 0.96)',
      inputBorder: 'rgba(255, 255, 255, 0.09)',
      menuSurface: 'rgba(8, 11, 16, 0.96)',
      menuBorder: 'rgba(255, 255, 255, 0.1)',
      slider: 'rgba(56, 189, 248, 0.82)',
    },
    scopes: {
      background: 'rgb(0, 0, 0)',
      guides: DEFAULT_SCOPE_GUIDES,
      overlaySurface: DEFAULT_SCOPE_OVERLAY_BG,
      overlayText: DEFAULT_SCOPE_OVERLAY_TEXT,
      overlayBorder: DEFAULT_SCOPE_OVERLAY_BORDER,
      resizeHandle: DEFAULT_SCOPE_RESIZE_HANDLE,
    },
    spectrum: {
      line: DEFAULT_ACCENT,
      sideLine: 'rgba(56, 189, 248, 0.5)',
      fill: 'rgba(56, 189, 248, 0.34)',
      heatLow: DEFAULT_HEAT_LOW,
      heatMid: DEFAULT_HEAT_MID,
      heatHigh: DEFAULT_HEAT_HIGH,
    },
    oscilloscope: {
      line: DEFAULT_ACCENT,
      fill: 'rgba(245, 248, 252, 0.18)',
    },
    vectorscope: {
      trace: DEFAULT_ACCENT,
      bandLow: DEFAULT_BAND_LOW,
      bandMid: DEFAULT_BAND_MID,
      bandHigh: DEFAULT_BAND_HIGH,
    },
    spectrogram: {
      mono: DEFAULT_ACCENT,
      heatLow: DEFAULT_HEAT_LOW,
      heatMid: DEFAULT_HEAT_MID,
      heatHigh: DEFAULT_HEAT_HIGH,
    },
    vumeter: {
      level: DEFAULT_ACCENT,
      track: 'rgba(56, 189, 248, 0.08)',
      peak: 'rgb(255, 127, 0)',
      clip: 'rgba(255, 120, 80, 0.9)',
      needleLeft: DEFAULT_VU_NEEDLE_LEFT,
      needleRight: DEFAULT_VU_NEEDLE_RIGHT,
      needleCombined: DEFAULT_VU_NEEDLE_COMBINED,
    },
    lufsmeter: {
      level: DEFAULT_ACCENT,
      track: 'rgba(56, 189, 248, 0.08)',
      target: 'rgba(56, 189, 248, 0.25)',
    },
    waveform: {
      line: DEFAULT_ACCENT,
      bandLow: DEFAULT_BAND_LOW,
      bandMid: DEFAULT_BAND_MID,
      bandHigh: DEFAULT_BAND_HIGH,
    },
    nowPlaying: {
      accent: DEFAULT_ACCENT,
      background: 'rgba(4, 8, 12, 0.9)',
      surface: 'rgba(10, 16, 24, 0.92)',
      border: 'rgba(255, 255, 255, 0.12)',
      text: 'rgb(248, 250, 252)',
      progressTrack: 'rgba(255, 255, 255, 0.18)',
      progressFill: DEFAULT_ACCENT,
      buttonSurface: 'rgba(255, 255, 255, 0.05)',
      buttonBorder: 'rgba(255, 255, 255, 0.12)',
      statusOk: DEFAULT_SUCCESS,
      statusError: DEFAULT_DANGER,
    },
  }, DEFAULT_THEME_NAME)
}

function cloneTheme(theme: PrismTheme): PrismTheme {
  return JSON.parse(JSON.stringify(theme)) as PrismTheme
}

const BUNDLED_TESTER_THEME_FILES = [
  {
    name: 'Alpha Centauri',
    content: `[Theme]
format = prism-theme
version = 2
credit = MxnGxzr
website = https://www.instagram.com/mxngxzr.jpeg/
description = It exists

[App]
accent = 0, 50, 220
background = 255, 255, 255
surface = 255, 255, 255, 255
surface_alt = 255, 255, 255, 250
border = 255, 255, 255, 23
text = 0, 0, 0
text_muted = 0, 0, 0, 200
toolbar_bg = 255, 255, 255, 199
settings_bg_top = 255, 255, 255, 235
settings_bg_bottom = 255, 255, 255, 250
bottom_bar_bg = 255, 255, 255, 250

[Scopes]
background = 255, 255, 255
guides = 0, 0, 0, 170

[Spectrum]
background = 255, 255, 255
line = 0, 50, 220
side_line = 240, 30, 180, 120
fill = 180, 50, 100, 87
heat_low = 255, 255, 255
heat_mid = 15, 30, 240
heat_high = 240, 30, 180
heat_base = 255, 255, 255
guides = 0, 0, 0, 40
labels = 0, 0, 0, 40

[Oscilloscope]
line = 0, 50, 220
fill = 240, 30, 180, 100
guides = 0, 0, 0, 40

[Vectorscope]
band_low = 0, 50, 180
band_mid = 11, 180, 140
band_high = 200, 50, 180
guides = 0, 0, 0, 70
labels = 0, 0, 0, 70

[Spectrogram]
background = 255, 255, 255, 0
mono = 255, 105, 180
heat_low = 15, 30, 240
heat_mid = 15, 30, 240
heat_high = 255, 105, 180

[VUMeter]
peak = 240, 30, 180
scale = 0, 0, 0, 100
labels = 0, 0, 0, 120

[LUFSMeter]
level = 0, 50, 220
track = 0, 50, 220, 20
target = 0, 50, 220, 120
scale = 0, 0, 0, 200
labels = 0, 0, 0, 225

[Waveform]
line = 0, 0, 0, 120
band_low = 0, 50, 180
band_mid = 70, 160, 240
band_high = 255, 105, 180
guides = 0, 0, 0, 120
`,
  },
  {
    name: 'Chroma Blue',
    content: `[Theme]
format = prism-theme
version = 2
credit = Prism
website = https://astramusic.dev/
description = Chroma key for transparent overlays

[App]
accent = 56, 140, 255
background = 8, 8, 14
surface = 10, 10, 18, 235
surface_alt = 8, 8, 14, 250
border = 180, 200, 240, 23
text = 255, 255, 255
text_muted = 160, 180, 220
success = 0, 210, 100
warning = 255, 210, 0
danger = 255, 75, 75
toolbar_bg = 8, 8, 14, 205
settings_bg_top = 10, 10, 18, 235
settings_bg_bottom = 8, 8, 14, 250
bottom_bar_bg = 8, 8, 14, 250

[Controls]
surface = 20, 30, 80, 15
surface_hover = 20, 30, 80, 28
surface_active = 56, 140, 255, 38
border = 160, 180, 220, 22
border_active = 56, 140, 255, 85
text = 255, 255, 255, 235
input_surface = 6, 6, 12, 245
input_border = 160, 180, 220, 24
menu_surface = 10, 10, 18, 248
menu_border = 160, 180, 220, 28
slider = 56, 140, 255, 210
flat_controls = true

[Scopes]
background = 0, 0, 255
guides = 0, 0, 255
overlay_surface = 8, 8, 16, 255
overlay_text = 255, 255, 255, 255
overlay_border = 160, 180, 220, 255
resize_handle = 160, 180, 220, 255

[Spectrum]
background = 0, 0, 255
line = 255, 255, 255
side_line = 255, 255, 255, 255
fill = 255, 255, 255, 0
heat_low = 0, 0, 255, 255
heat_high = 255, 255, 255, 255
heat_base = 0, 0, 255, 255
guides = 0, 0, 255
labels = 0, 0, 255

[Oscilloscope]
background = 0, 0, 255
line = 255, 255, 255
fill = 255, 255, 255, 255
guides = 0, 0, 255

[Vectorscope]
background = 0, 0, 255
trace = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 0, 255
labels = 0, 0, 255

[Spectrogram]
background = 0, 0, 255
mono = 255, 255, 255
heat_low = 0, 0, 255, 255
heat_high = 255, 255, 255, 255

[VUMeter]
background = 0, 0, 255
level = 255, 255, 255
track = 255, 255, 255, 255
peak = 255, 220, 0
clip = 255, 75, 75, 255
scale = 0, 0, 255
labels = 0, 0, 255

[LUFSMeter]
background = 0, 0, 255
level = 255, 255, 255
track = 255, 255, 255, 255
target = 255, 255, 255, 255
scale = 0, 0, 255
labels = 0, 0, 255

[Waveform]
background = 0, 0, 255
line = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 0, 255

[Now Playing]
accent = 56, 140, 255
background = 8, 8, 14, 255
surface = 10, 10, 18, 255
border = 160, 180, 220, 255
text = 255, 255, 255
progress_track = 30, 60, 160, 45
progress_fill = 56, 140, 255
button_surface = 20, 30, 80, 18
button_border = 160, 180, 220, 255
status_ok = 0, 210, 100
status_error = 255, 75, 75
`,
  },
  {
    name: 'Chroma Green',
    content: `[Theme]
format = prism-theme
version = 2
credit = Prism
website = https://astramusic.dev/
description = Chroma key for transparent overlays

[App]
accent = 0, 230, 80
background = 8, 12, 8
surface = 10, 15, 10, 235
surface_alt = 8, 12, 8, 250
border = 200, 240, 200, 23
text = 255, 255, 255
text_muted = 160, 210, 160
success = 0, 230, 80
warning = 255, 210, 0
danger = 255, 75, 75
toolbar_bg = 8, 12, 8, 205
settings_bg_top = 10, 15, 10, 235
settings_bg_bottom = 8, 12, 8, 250
bottom_bar_bg = 8, 12, 8, 250

[Controls]
surface = 0, 50, 20, 15
surface_hover = 0, 50, 20, 28
surface_active = 0, 230, 80, 38
border = 160, 210, 160, 22
border_active = 0, 230, 80, 85
text = 255, 255, 255, 235
input_surface = 6, 10, 6, 245
input_border = 160, 210, 160, 24
menu_surface = 10, 15, 10, 248
menu_border = 160, 210, 160, 28
slider = 0, 230, 80, 210
flat_controls = true

[Scopes]
background = 0, 255, 0
guides = 0, 255, 0
overlay_surface = 8, 14, 8, 255
overlay_text = 255, 255, 255, 255
overlay_border = 160, 210, 160, 255
resize_handle = 160, 210, 160, 38

[Spectrum]
background = 0, 255, 0
line = 255, 255, 255
side_line = 255, 255, 255, 255
fill = 255, 255, 255, 100
heat_low = 0, 255, 0, 255
heat_high = 255, 255, 255, 255
heat_base = 0, 255, 0, 255
guides = 0, 255, 0
labels = 0, 255, 0

[Oscilloscope]
background = 0, 255, 0
line = 255, 255, 255
fill = 255, 255, 255, 55
guides = 0, 255, 0

[Vectorscope]
background = 0, 255, 0
trace = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 255, 0
labels = 0, 255, 0

[Spectrogram]
background = 0, 255, 0
mono = 255, 255, 255
heat_low = 0, 255, 0, 255
heat_high = 255, 255, 255, 255

[VUMeter]
background = 0, 255, 0
level = 255, 255, 255
track = 255, 255, 255, 28
peak = 255, 220, 0
clip = 255, 75, 75, 230
scale = 0, 255, 0
labels = 0, 255, 0

[LUFSMeter]
background = 0, 255, 0
level = 255, 255, 255
track = 255, 255, 255, 28
target = 255, 255, 255, 75
scale = 0, 255, 0
labels = 0, 255, 0

[Waveform]
background = 0, 255, 0
line = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 255, 0

[Now Playing]
accent = 0, 230, 80
background = 8, 12, 8, 235
surface = 10, 16, 10, 238
border = 160, 210, 160, 38
text = 255, 255, 255
progress_track = 0, 160, 50, 45
progress_fill = 0, 230, 80
button_surface = 0, 50, 20, 18
button_border = 160, 210, 160, 38
status_ok = 0, 230, 80
status_error = 255, 75, 75
`,
  },
  {
    name: 'Redshift',
    content: `[Theme]
format = prism-theme
version = 2
credit = Boof2015
website = https://astramusic.dev/
description = A very red theme

[App]
accent = 230, 0, 69
background = 15, 15, 15
surface = 12, 13, 14, 235
surface_alt = 15, 15, 15, 250
text = 255, 255, 255
text_muted = 172, 192, 222
success = 127, 255, 127
warning = 230, 0, 69
danger = 230, 0, 69
toolbar_bg = 12, 13, 14, 199
settings_bg_top = 12, 13, 14, 235
settings_bg_bottom = 15, 15, 15, 250
bottom_bar_bg = 15, 15, 15, 250

[Controls]
surface = 72, 21, 39, 8
surface_hover = 72, 21, 39, 15
surface_active = 230, 0, 69, 31
border = 172, 192, 222, 20
border_active = 230, 0, 69, 71
text = 255, 255, 255, 235
input_surface = 15, 15, 15, 245
input_border = 172, 192, 222, 23
menu_surface = 12, 13, 14, 245
menu_border = 172, 192, 222, 26
slider = 230, 0, 69, 209

[Scopes]
background = 15, 15, 15
guides = 59, 64, 71
overlay_surface = 12, 13, 14, 224
overlay_text = 255, 255, 255, 194
overlay_border = 172, 192, 222, 31
resize_handle = 172, 192, 222, 31

[Spectrum]
line = 255, 255, 255
side_line = 255, 255, 255, 128
fill = 230, 0, 69, 87
heat_low = 180, 20, 40, 200
heat_mid = 220, 0, 55, 250
heat_high = 255, 90, 90, 255
heat_base = 15, 15, 15, 255
guides = 56, 58, 61
labels = 56, 58, 61

[Oscilloscope]
background = 15, 15, 15
line = 230, 0, 69
fill = 255, 255, 255, 46
guides = 56, 58, 61

[Vectorscope]
background = 15, 15, 15
trace = 230, 0, 69
band_low = 230, 0, 69
band_mid = 102, 90, 255
band_high = 0, 255, 255
guides = 56, 58, 61
labels = 56, 58, 61

[Spectrogram]
mono = 230, 0, 69
heat_low = 180, 20, 40, 200
heat_mid = 220, 0, 55, 250
heat_high = 255, 200, 200

[VUMeter]
background = 15, 15, 15
level = 153, 0, 53
track = 153, 0, 53, 20
peak = 230, 0, 69
clip = 255, 0, 0, 230
scale = 86, 96, 111
labels = 86, 96, 111

[LUFSMeter]
background = 15, 15, 15
level = 230, 0, 69
track = 230, 0, 69, 20
target = 230, 0, 69, 64
scale = 86, 96, 111
labels = 86, 96, 111

[Waveform]
background = 15, 15, 15
line = 230, 0, 69
band_low = 230, 0, 69
band_mid = 102, 90, 255
band_high = 0, 255, 255
guides = 86, 96, 111

[Now Playing]
accent = 230, 0, 69
background = 15, 15, 15, 230
surface = 12, 13, 14, 235
border = 172, 192, 222, 31
text = 255, 255, 255
progress_track = 86, 96, 111
progress_fill = 230, 0, 69
button_surface = 72, 21, 39, 13
button_border = 172, 192, 222, 31
status_ok = 127, 255, 127
status_error = 230, 0, 69
`,
  },
  {
    name: 'NeutralDark',
    content: `[Theme]
format = prism-theme
version = 2
credit = Boof2015
website = https://astramusic.dev/
description = A neutral dark theme

[App]
accent = 190, 210, 238
success = 160, 220, 180
warning = 220, 198, 140
danger = 230, 145, 145
background = 6, 10, 14
surface = 10, 15, 21, 235
surface_alt = 5, 8, 12, 250
border = 190, 210, 238, 24
text = 245, 247, 250
text_muted = 142, 157, 181
toolbar_bg = 10, 15, 21, 199
settings_bg_top = 10, 15, 21, 235
settings_bg_bottom = 5, 8, 12, 250
bottom_bar_bg = 5, 8, 12, 250

[Controls]
surface = 255, 255, 255, 8
surface_hover = 255, 255, 255, 15
surface_active = 190, 210, 238, 31
border = 190, 210, 238, 20
border_active = 190, 210, 238, 71
text = 245, 247, 250, 235
input_surface = 6, 10, 14, 245
input_border = 190, 210, 238, 23
menu_surface = 10, 15, 21, 245
menu_border = 190, 210, 238, 26
slider = 190, 210, 238, 209

[Scopes]
background = 6, 10, 14
guides = 48, 58, 70
overlay_surface = 10, 15, 21, 224
overlay_text = 245, 247, 250, 194
overlay_border = 190, 210, 238, 31
resize_handle = 190, 210, 238, 31

[Spectrum]
background = 6, 10, 14
line = 196, 216, 247
side_line = 196, 216, 247, 128
fill = 196, 216, 247, 78
heat_low = 42, 10, 82, 195
heat_mid = 206, 0, 126, 235
heat_high = 255, 82, 16
heat_base = 6, 10, 14
guides = 48, 58, 70
labels = 76, 90, 108

[Oscilloscope]
background = 6, 10, 14
line = 196, 216, 247
fill = 255, 58, 26, 36
guides = 48, 58, 70

[Vectorscope]
background = 6, 10, 14
trace = 196, 216, 247
band_low = 255, 40, 30
band_mid = 0, 255, 80
band_high = 58, 92, 255
guides = 48, 58, 70
labels = 76, 90, 108

[Spectrogram]
background = 6, 10, 14
mono = 196, 216, 247
heat_low = 42, 10, 82, 195
heat_mid = 206, 0, 126, 235
heat_high = 255, 82, 16

[VUMeter]
background = 6, 10, 14
level = 196, 216, 247
track = 196, 216, 247, 20
peak = 255, 131, 0
clip = 230, 145, 145, 230
scale = 100, 119, 145
labels = 174, 191, 216
needle_left = 196, 216, 247
needle_right = 255, 76, 38
needle_combined = 255, 144, 0

[LUFSMeter]
background = 6, 10, 14
level = 196, 216, 247
track = 196, 216, 247, 20
target = 255, 144, 0, 72
scale = 100, 119, 145
labels = 174, 191, 216

[Waveform]
background = 6, 10, 14
line = 196, 216, 247
band_low = 255, 60, 34
band_mid = 255, 0, 132
band_high = 92, 208, 255
guides = 100, 119, 145

[Now Playing]
accent = 190, 210, 238
background = 6, 10, 14, 230
surface = 10, 15, 21, 235
border = 190, 210, 238, 31
text = 245, 247, 250
progress_track = 100, 119, 145
progress_fill = 255, 82, 16
button_surface = 255, 255, 255, 13
button_border = 190, 210, 238, 31
status_ok = 160, 220, 180
status_error = 230, 145, 145
`,
  },
  {
    name: 'Stanky Leg',
    content: `[Theme]
format = prism-theme
version = 2
credit = MrAlibi
website = https://twitch.tv/mralibitv
description = I tripped, and now my leg turned too stanky

[App]
accent = 69, 20, 184
background = 0, 0, 0
surface = 69, 20, 184
surface_alt = 4, 8, 12, 250
border = 255, 255, 255, 23
text = 255, 255, 255

[Scopes]
guides = 255, 255, 255, 26

[Spectrum]
heat_low = 50, 19, 143
heat_mid = 173, 73, 191
heat_high = 255, 15, 223
heat_base = 0, 0, 0

[Oscilloscope]
fill = 191, 40, 201, 150

[Vectorscope]
band_low = 177, 105, 219
band_mid = 108, 31, 196
band_high = 69, 20, 184

[Spectrogram]
mono = 86, 25, 230
heat_low = 86, 25, 230
heat_mid = 177, 105, 219
heat_high = 177, 105, 219

[Waveform]
line = 86, 25, 230
band_low = 177, 105, 219
band_mid = 108, 31, 196
band_high = 69, 20, 184
`,
  },
  {
    name: 'Vy',
    content: `[Theme]
format = prism-theme
version = 2
credit = Lillith Rose
website = https://lilyy.gay
description = im so porpl

[App]
accent = 142, 77, 165
background = 45, 33, 45
surface = 51, 37, 51
surface_alt = 57, 42, 57
border = 255, 255, 255, 23
text = 255, 255, 255

[Vectorscope]
phase_risk = 255, 255, 255, 100
band_low = 37, 13, 45
band_mid = 101, 45, 122
band_high = 142, 77, 165

[Spectrogram]
heat_low = 37, 13, 45
heat_mid = 101, 45, 122
heat_high = 142, 77, 165
`,
  },
] as const

export function createBundledThemes(): PrismTheme[] {
  return [
    createDefaultTheme(),
    ...BUNDLED_TESTER_THEME_FILES.map((theme) => parseThemeFileContent(theme.content, theme.name)),
  ]
}

export function normalizeTheme(
  raw: unknown,
  fallbackName = DEFAULT_THEME_NAME,
): PrismTheme {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismTheme>
    : {}

  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim()
    : fallbackName

  const normalized = createEmptyTheme()
  normalized.name = name
  normalized.credit = typeof parsed.credit === 'string' && parsed.credit.trim()
    ? parsed.credit.trim()
    : undefined
  normalized.website = typeof parsed.website === 'string' && parsed.website.trim()
    ? parsed.website.trim()
    : undefined
  normalized.description = typeof parsed.description === 'string' && parsed.description.trim()
    ? parsed.description.trim()
    : undefined
  normalized.app = normalizeSectionTokens(parsed.app, APP_SCHEMA)
  normalized.controls = normalizeSectionTokens(parsed.controls, CONTROLS_SCHEMA)
  normalized.scopes = normalizeSectionTokens(parsed.scopes, SCOPES_SCHEMA)
  normalized.spectrum = normalizeSectionTokens(parsed.spectrum, SPECTRUM_SCHEMA)
  normalized.oscilloscope = normalizeSectionTokens(parsed.oscilloscope, OSCILLOSCOPE_SCHEMA)
  normalized.vectorscope = normalizeSectionTokens(parsed.vectorscope, VECTORSCOPE_SCHEMA)
  normalized.spectrogram = normalizeSectionTokens(parsed.spectrogram, SPECTROGRAM_SCHEMA)
  normalized.vumeter = normalizeSectionTokens(parsed.vumeter, VUMETER_SCHEMA)
  normalized.lufsmeter = normalizeSectionTokens(parsed.lufsmeter, LUFSMETER_SCHEMA)
  normalized.waveform = normalizeSectionTokens(parsed.waveform, WAVEFORM_SCHEMA)
  normalized.nowPlaying = normalizeSectionTokens(
    (parsed as { nowPlaying?: unknown; astra?: unknown }).nowPlaying
      ?? (parsed as { astra?: unknown }).astra,
    NOW_PLAYING_SCHEMA,
  )
  return normalized
}

export function createEmptyThemeLocalState(): PrismThemeLocalStateV1 {
  return {
    format: THEME_LOCAL_STATE_FORMAT,
    version: THEME_LOCAL_STATE_VERSION,
    migrationVersion: 0,
    activeThemeId: null,
  }
}

export function normalizeThemeLocalState(raw: unknown): PrismThemeLocalStateV1 {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismThemeLocalStateV1>
    : {}

  return {
    format: THEME_LOCAL_STATE_FORMAT,
    version: THEME_LOCAL_STATE_VERSION,
    migrationVersion: typeof parsed.migrationVersion === 'number' && Number.isFinite(parsed.migrationVersion)
      ? Math.max(0, Math.trunc(parsed.migrationVersion))
      : 0,
    activeThemeId: typeof parsed.activeThemeId === 'string'
      ? parsed.activeThemeId
      : null,
  }
}

export function normalizeLegacyThemePayload(raw: unknown): LegacyThemeMigrationPayload {
  if (typeof raw !== 'object' || raw === null) {
    return { presetId: null, customAccent: null }
  }

  const parsed = raw as Partial<LegacyThemeMigrationPayload>
  return {
    presetId: typeof parsed.presetId === 'string' ? parsed.presetId : null,
    customAccent: typeof parsed.customAccent === 'string' ? parsed.customAccent : null,
  }
}

function getSectionTokenRecord(
  theme: PrismTheme,
  section: ThemeSectionName,
): SectionTokenMap {
  return theme[section] as SectionTokenMap
}

function parseSectionValue(section: ThemeSectionName, key: string): string | null {
  const schema = SECTION_SCHEMAS[section] as Record<string, string>
  const mapped = schema[key]
  return mapped ?? null
}

function parseThemeContent(content: string, fallbackName: string): PrismTheme {
  const nextTheme = createEmptyTheme()
  nextTheme.name = fallbackName

  let currentSection: ThemeSectionName | 'theme' | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      const sectionKey = normalizeKey(sectionMatch[1] ?? '')
      currentSection = sectionKey === 'theme'
        ? 'theme'
        : (SECTION_KEY_MAP[sectionKey] ?? null)
      continue
    }

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1 || !currentSection) continue

    const key = normalizeKey(line.slice(0, equalsIndex))
    const value = line.slice(equalsIndex + 1).trim()
    if (!value) continue

    if (currentSection === 'theme') {
      switch (key) {
        case 'format':
          if (value !== THEME_FILE_FORMAT) {
            throw new Error(`Unsupported theme format "${value}".`)
          }
          break
        case 'version': {
          const version = Number.parseInt(value, 10)
          if (version !== THEME_FILE_VERSION) {
            throw new Error(`Unsupported theme version "${value}".`)
          }
          break
        }
        case 'credit':
          nextTheme.credit = value
          break
        case 'website':
          nextTheme.website = value
          break
        case 'description':
          nextTheme.description = value
          break
        default:
          break
      }
      continue
    }

    const tokenKey = parseSectionValue(currentSection, key)
    if (!tokenKey) continue

    if (PASSTHROUGH_KEYS.has(tokenKey)) {
      getSectionTokenRecord(nextTheme, currentSection)[tokenKey] = value
      continue
    }

    const parsedColor = parseCssColor(value) ?? parseThemeChannelColor(value)
    if (!parsedColor) continue
    getSectionTokenRecord(nextTheme, currentSection)[tokenKey] = toCssColor(quantizeThemeColor(parsedColor))
  }

  return normalizeTheme(nextTheme, fallbackName)
}

export function extractLegacyThemeFileId(content: string): string | null {
  let currentSection: ThemeSectionName | 'theme' | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      const sectionKey = normalizeKey(sectionMatch[1] ?? '')
      currentSection = sectionKey === 'theme'
        ? 'theme'
        : (SECTION_KEY_MAP[sectionKey] ?? null)
      continue
    }

    if (currentSection !== 'theme') continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue

    const key = normalizeKey(line.slice(0, equalsIndex))
    const value = line.slice(equalsIndex + 1).trim()
    if (key !== 'id' || !value) continue

    return value
  }

  return null
}

export function parseThemeFileContent(
  content: string,
  fallbackName = DEFAULT_THEME_NAME,
): PrismTheme {
  return parseThemeContent(content, fallbackName)
}

function serializeSection<T extends SectionTokenMap>(
  sectionName: string,
  tokens: T,
  schema: SectionSchema<T>,
): string[] {
  const lines: string[] = [`[${sectionName}]`]

  for (const [serializedKey, propertyKey] of Object.entries(schema)) {
    const value = tokens[propertyKey as keyof T]
    if (!value) continue
    if (PASSTHROUGH_KEYS.has(propertyKey)) {
      lines.push(`${serializedKey} = ${value}`)
    } else {
      lines.push(`${serializedKey} = ${toThemeChannels(value)}`)
    }
  }

  return lines
}

function commentExampleTokens(lines: string[]): string[] {
  return lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || /^\[.+\]$/.test(trimmed)) {
      return line
    }
    return `# ${line}`
  })
}

export function serializeThemeFile(theme: PrismTheme): string {
  const normalized = normalizeTheme(theme, theme.name)
  const sections: string[] = [
    '[Theme]',
    `format = ${THEME_FILE_FORMAT}`,
    `version = ${THEME_FILE_VERSION}`,
  ]

  if (normalized.credit) sections.push(`credit = ${normalized.credit}`)
  if (normalized.website) sections.push(`website = ${normalized.website}`)
  if (normalized.description) sections.push(`description = ${normalized.description}`)

  const output = [sections.join('\n')]

  for (const section of Object.keys(SECTION_SCHEMAS) as ThemeSectionName[]) {
    const tokens = normalized[section] as Record<string, string | undefined>
    if (!Object.values(tokens).some(Boolean)) continue
    const schema = SECTION_SCHEMAS[section] as SectionSchema<Record<string, string | undefined>>
    output.push(serializeSection(SECTION_LABEL_MAP[section], tokens, schema).join('\n'))
  }

  return `${output.join('\n\n')}\n`
}

export function createTemplateThemeFile(): string {
  const base = createDefaultTheme()
  const resolved = resolveTheme(base)
  const themeSection = [
    '[Theme]',
    `format = ${THEME_FILE_FORMAT}`,
    `version = ${THEME_FILE_VERSION}`,
    '# Optional metadata:',
    '# credit = Your Name',
    '# website = https://example.com',
    '# description = Custom Prism theme',
  ]
  const appSection = [
    '[App]',
    '# Start here. These are the main palette tokens.',
    `accent = ${toThemeChannels(base.app.accent ?? DEFAULT_ACCENT)}`,
    `background = ${toThemeChannels(base.app.background ?? 'rgb(0, 0, 0)')}`,
    `surface = ${toThemeChannels(base.app.surface ?? 'rgba(8, 11, 16, 0.92)')}`,
    `surface_alt = ${toThemeChannels(base.app.surfaceAlt ?? 'rgba(4, 8, 12, 0.98)')}`,
    `border = ${toThemeChannels(base.app.border ?? 'rgba(255, 255, 255, 0.09)')}`,
    `text = ${toThemeChannels(base.app.text ?? 'rgb(255, 255, 255)')}`,
    '',
    '# Optional palette extras:',
    ...commentExampleTokens([
      `text_muted = ${toThemeChannels(base.app.textMuted ?? 'rgba(255, 255, 255, 0.42)')}`,
      `success = ${toThemeChannels(base.app.success ?? DEFAULT_SUCCESS)}`,
      `warning = ${toThemeChannels(base.app.warning ?? DEFAULT_WARNING)}`,
      `danger = ${toThemeChannels(base.app.danger ?? DEFAULT_DANGER)}`,
    ]),
    '',
    '# Optional shell overrides:',
    ...commentExampleTokens([
      `toolbar_bg = ${toThemeChannels(withAlpha(base.app.surfaceAlt ?? 'rgba(4, 8, 12, 0.98)', 0.78))}`,
      `settings_bg_top = ${toThemeChannels(base.app.surface ?? 'rgba(8, 11, 16, 0.92)')}`,
      `settings_bg_bottom = ${toThemeChannels(base.app.surfaceAlt ?? 'rgba(4, 8, 12, 0.98)')}`,
      `bottom_bar_bg = ${toThemeChannels(withAlpha(base.app.surfaceAlt ?? 'rgba(4, 8, 12, 0.98)', 0.98))}`,
    ]),
  ]

  const controlsSection = commentExampleTokens(serializeSection('Controls', {
    ...base.controls,
    flatControls: 'false',
  }, CONTROLS_SCHEMA as SectionSchema<Record<string, string | undefined>>))
  controlsSection.splice(1, 0, '# Entire section optional. Uncomment tokens here only if you want to override Prism defaults.')

  const scopesSection = commentExampleTokens(
    serializeSection('Scopes', { ...base.scopes }, SCOPES_SCHEMA as SectionSchema<Record<string, string | undefined>>),
  )
  scopesSection.splice(1, 0, '# Entire section optional. Uncomment tokens here only if you want to override Prism defaults.')

  const spectrumSection = commentExampleTokens(serializeSection('Spectrum', {
    ...base.spectrum,
    background: resolved.spectrum.background,
    guides: resolved.spectrum.guides,
    labels: resolved.spectrum.labels,
    heatBase: resolved.spectrum.heatBase,
  }, SPECTRUM_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const oscilloscopeSection = commentExampleTokens(serializeSection('Oscilloscope', {
    ...base.oscilloscope,
    background: resolved.oscilloscope.background,
    guides: resolved.oscilloscope.guides,
  }, OSCILLOSCOPE_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const vectorscopeSection = commentExampleTokens(serializeSection('Vectorscope', {
    ...base.vectorscope,
    background: resolved.vectorscope.background,
    phaseRisk: resolved.vectorscope.phaseRisk,
    guides: resolved.vectorscope.guides,
    labels: resolved.vectorscope.labels,
  }, VECTORSCOPE_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const spectrogramSection = commentExampleTokens(serializeSection('Spectrogram', {
    ...base.spectrogram,
    background: resolved.spectrogram.background,
    guides: resolved.spectrogram.guides,
    labels: resolved.spectrogram.labels,
  }, SPECTROGRAM_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const vumeterSection = commentExampleTokens(serializeSection('VUMeter', {
    ...base.vumeter,
    background: resolved.vumeter.background,
    scale: resolved.vumeter.scale,
    labels: resolved.vumeter.labels,
  }, VUMETER_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const lufsmeterSection = commentExampleTokens(serializeSection('LUFSMeter', {
    ...base.lufsmeter,
    background: resolved.lufsmeter.background,
    scale: resolved.lufsmeter.scale,
    labels: resolved.lufsmeter.labels,
  }, LUFSMETER_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const waveformSection = commentExampleTokens(serializeSection('Waveform', {
    ...base.waveform,
    background: resolved.waveform.background,
    guides: resolved.waveform.guides,
  }, WAVEFORM_SCHEMA as SectionSchema<Record<string, string | undefined>>))

  const nowPlayingSection = commentExampleTokens(serializeSection(
    'Now Playing',
    { ...base.nowPlaying },
    NOW_PLAYING_SCHEMA as SectionSchema<Record<string, string | undefined>>,
  ))

  return `# Prism theme template
#
# Colors use R, G, B or R, G, B, A (0-255)
# CSS colors like #hex, rgb(), and rgba() also work
#
# Start with [App].
# Everything else below is optional and starts commented out.
# Uncomment the tokens you want to customize and leave the rest commented to inherit defaults.
#
# [Controls] and [Scopes] are shared override groups.
# Module sections show the full set of supported tokens for each module.
# Spectrum and Spectrogram heat token alpha is honored directly.
# Leave Spectrum heat_base commented unless you want an explicit underlay beneath the heatmap.
#
# Comment out any optional token to let Prism inherit or derive it.
# Leave an entire optional section commented if that area should use Prism's defaults.
#
${[
  themeSection.join('\n'),
  appSection.join('\n'),
  controlsSection.join('\n'),
  scopesSection.join('\n'),
  '# Module sections below are optional overrides.',
  '# Uncomment the tokens you want to customize and leave the rest as examples.',
  spectrumSection.join('\n'),
  oscilloscopeSection.join('\n'),
  vectorscopeSection.join('\n'),
  spectrogramSection.join('\n'),
  vumeterSection.join('\n'),
  lufsmeterSection.join('\n'),
  waveformSection.join('\n'),
  nowPlayingSection.join('\n'),
].join('\n\n')}
`
}

interface ResolvedAppTokens {
  accent: string
  success: string
  warning: string
  danger: string
  background: string
  surface: string
  surfaceAlt: string
  border: string
  text: string
  textMuted: string
  toolbarBg: string | null
  settingsBgTop: string | null
  settingsBgBottom: string | null
  bottomBarBg: string | null
}

interface ResolvedControlsTokens {
  surface: string
  surfaceHover: string
  surfaceActive: string
  border: string
  borderActive: string
  text: string
  inputSurface: string
  inputBorder: string
  menuSurface: string
  menuBorder: string
  slider: string
  flatControls: boolean
}

interface ResolvedScopesTokens {
  background: string
  guides: string
  guidesSecondary: string
  labels: string
  overlaySurface: string
  overlayText: string
  overlayBorder: string
  resizeHandle: string
}

function resolveAppTokens(tokens: ThemeAppTokens): ResolvedAppTokens {
  const accent = tokens.accent ?? DEFAULT_ACCENT
  const text = tokens.text ?? 'rgb(255, 255, 255)'
  const textMuted = tokens.textMuted ?? withAlpha(text, 0.42)
  const background = tokens.background ?? 'rgb(0, 0, 0)'
  const surface = tokens.surface ?? 'rgba(8, 11, 16, 0.92)'
  const surfaceAlt = tokens.surfaceAlt ?? 'rgba(4, 8, 12, 0.98)'
  const border = tokens.border ?? 'rgba(255, 255, 255, 0.09)'

  return {
    accent,
    success: tokens.success ?? DEFAULT_SUCCESS,
    warning: tokens.warning ?? DEFAULT_WARNING,
    danger: tokens.danger ?? DEFAULT_DANGER,
    background,
    surface,
    surfaceAlt,
    border,
    text,
    textMuted,
    toolbarBg: tokens.toolbarBg ?? null,
    settingsBgTop: tokens.settingsBgTop ?? null,
    settingsBgBottom: tokens.settingsBgBottom ?? null,
    bottomBarBg: tokens.bottomBarBg ?? null,
  }
}

function resolveControlsTokens(tokens: ThemeControlsTokens, app: ResolvedAppTokens): ResolvedControlsTokens {
  const surface = tokens.surface ?? 'rgba(255, 255, 255, 0.03)'
  return {
    surface,
    surfaceHover: tokens.surfaceHover ?? mixColors(surface, app.accent, 0.12),
    surfaceActive: tokens.surfaceActive ?? withAlpha(app.accent, 0.12),
    border: tokens.border ?? 'rgba(255, 255, 255, 0.08)',
    borderActive: tokens.borderActive ?? withAlpha(app.accent, 0.28),
    text: tokens.text ?? app.text,
    inputSurface: tokens.inputSurface ?? 'rgba(10, 14, 20, 0.96)',
    inputBorder: tokens.inputBorder ?? 'rgba(255, 255, 255, 0.09)',
    menuSurface: tokens.menuSurface ?? app.surface,
    menuBorder: tokens.menuBorder ?? 'rgba(255, 255, 255, 0.1)',
    slider: tokens.slider ?? withAlpha(app.accent, 0.82),
    flatControls: tokens.flatControls?.trim().toLowerCase() === 'true',
  }
}

function resolveScopesTokens(tokens: ThemeScopesTokens, app: ResolvedAppTokens): ResolvedScopesTokens {
  const guides = tokens.guides ?? DEFAULT_SCOPE_GUIDES
  return {
    background: tokens.background ?? app.background,
    guides,
    guidesSecondary: multiplyAlpha(guides, 0.5),
    labels: guides,
    overlaySurface: tokens.overlaySurface ?? DEFAULT_SCOPE_OVERLAY_BG,
    overlayText: tokens.overlayText ?? DEFAULT_SCOPE_OVERLAY_TEXT,
    overlayBorder: tokens.overlayBorder ?? DEFAULT_SCOPE_OVERLAY_BORDER,
    resizeHandle: tokens.resizeHandle ?? DEFAULT_SCOPE_RESIZE_HANDLE,
  }
}

function resolveInterfaceTheme(
  app: ResolvedAppTokens,
  controls: ResolvedControlsTokens,
  scopes: ResolvedScopesTokens,
): ResolvedInterfaceTheme {
  const bgParsed = parseCssColor(app.background)
  const colorScheme: 'light' | 'dark' = bgParsed && getPerceivedBrightness(bgParsed) >= 156 ? 'light' : 'dark'

  const glassHighlight = controls.flatControls ? 'transparent' : withAlpha(app.text, 0.05)
  const glassBg = controls.flatControls ? 'transparent' : withAlpha(app.surface, 0.18)

  return {
    primary: app.accent,
    secondary: app.surfaceAlt,
    border: app.border,
    text: app.text,
    background: app.background,
    accent: app.accent,
    accentHover: lighten(app.accent, 0.2),
    accentGlow: withAlpha(app.accent, 0.3),
    accentRgb: colorToRgbChannels(app.accent),
    colorScheme,
    bgPrimary: app.background,
    bgSecondary: darken(app.background, 0.04),
    bgTertiary: darken(app.background, 0.08),
    panelSurface: app.surface,
    panelSurfaceSoft: app.surfaceAlt,
    panelOutline: app.border,
    panelOutlineStrong: withAlpha(app.border, 0.9),
    glassBg,
    glassBorder: withAlpha(app.border, 0.85),
    glassHighlight,
    glassHighlightStrong: controls.flatControls ? 'transparent' : withAlpha(app.text, 0.14),
    textPrimary: app.text,
    textSecondary: blendText(app.text, app.textMuted, 0.45),
    textTertiary: blendText(app.text, app.textMuted, 0.7),
    textMuted: app.textMuted,
    toolbarBg: app.toolbarBg ?? withAlpha(app.surfaceAlt, 0.78),
    settingsBgTop: app.settingsBgTop ?? app.surface,
    settingsBgBottom: app.settingsBgBottom ?? app.surfaceAlt,
    bottomBarBg: app.bottomBarBg ?? withAlpha(app.surfaceAlt, 0.98),
    menuBg: controls.menuSurface,
    menuBorder: controls.menuBorder,
    controlBg: controls.surface,
    controlBgHover: controls.surfaceHover,
    controlBgActive: controls.surfaceActive,
    controlBorder: controls.border,
    controlBorderActive: controls.borderActive,
    controlText: controls.text,
    inputBg: controls.inputSurface,
    inputBgFocus: lighten(controls.inputSurface, 0.05),
    inputBorder: controls.inputBorder,
    inputBorderFocus: controls.borderActive,
    optionBg: controls.menuSurface,
    optionText: controls.text,
    sliderTrack: withAlpha(app.border, 0.6),
    sliderFill: controls.slider,
    sliderThumb: lighten(controls.slider, 0.18),
    divider: app.border,
    scopeBackground: scopes.background,
    scopeGuides: scopes.guides,
    scopeOverlayBg: scopes.overlaySurface,
    scopeOverlayText: scopes.overlayText,
    scopeOverlayBorder: scopes.overlayBorder,
    scopeResizeHandle: scopes.resizeHandle,
    success: app.success,
    warning: app.warning,
    danger: app.danger,
  }
}

function resolveSpectrumTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedSpectrumTheme {
  const section = theme.spectrum
  const line = section.line ?? app.accent
  const sideLine = section.sideLine ?? withAlpha(line, 0.5)
  const fill = section.fill ?? withAlpha(line, 0.34)
  const guides = section.guides ?? scopes.guides
  const background = section.background ?? scopes.background
  return {
    line,
    sideLine,
    guides,
    guidesSecondary: multiplyAlpha(guides, 0.5),
    labels: section.labels ?? guides,
    background,
    fill,
    fillGradient: [
      withAlpha(fill, 0),
      multiplyAlpha(fill, 0.72),
      fill,
    ],
    heatColors: [
      section.heatLow ?? DEFAULT_HEAT_LOW,
      section.heatMid ?? DEFAULT_HEAT_MID,
      section.heatHigh ?? DEFAULT_HEAT_HIGH,
    ],
    heatBase: section.heatBase ?? 'transparent',
  }
}

function resolveOscilloscopeTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedOscilloscopeTheme {
  const guides = theme.oscilloscope.guides ?? scopes.guides
  return {
    line: theme.oscilloscope.line ?? app.accent,
    guides,
    guidesSecondary: multiplyAlpha(guides, 0.5),
    background: theme.oscilloscope.background ?? scopes.background,
    fill: theme.oscilloscope.fill ?? 'rgba(245, 248, 252, 0.18)',
  }
}

function resolveVectorscopeTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedVectorscopeTheme {
  const guides = theme.vectorscope.guides ?? scopes.guides
  return {
    trace: theme.vectorscope.trace ?? app.accent,
    phaseRisk: theme.vectorscope.phaseRisk ?? app.warning,
    guides,
    guidesSecondary: multiplyAlpha(guides, 0.5),
    labels: theme.vectorscope.labels ?? guides,
    background: theme.vectorscope.background ?? scopes.background,
    bandLow: theme.vectorscope.bandLow ?? DEFAULT_BAND_LOW,
    bandMid: theme.vectorscope.bandMid ?? DEFAULT_BAND_MID,
    bandHigh: theme.vectorscope.bandHigh ?? DEFAULT_BAND_HIGH,
  }
}

function resolveSpectrogramTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedSpectrogramTheme {
  return {
    mono: theme.spectrogram.mono ?? app.accent,
    background: theme.spectrogram.background ?? scopes.background,
    guides: theme.spectrogram.guides ?? scopes.guides,
    labels: theme.spectrogram.labels ?? theme.spectrogram.guides ?? scopes.guides,
    heatColors: [
      theme.spectrogram.heatLow ?? DEFAULT_HEAT_LOW,
      theme.spectrogram.heatMid ?? DEFAULT_HEAT_MID,
      theme.spectrogram.heatHigh ?? DEFAULT_HEAT_HIGH,
    ],
  }
}

function resolveVUMeterTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedVUMeterTheme {
  const level = theme.vumeter.level ?? app.accent
  return {
    level,
    track: theme.vumeter.track ?? withAlpha(level, 0.08),
    peak: theme.vumeter.peak ?? 'rgb(255, 127, 0)',
    clip: theme.vumeter.clip ?? 'rgba(255, 120, 80, 0.9)',
    scale: theme.vumeter.scale ?? scopes.guides,
    labels: theme.vumeter.labels ?? blendText(app.text, app.textMuted, 0.35),
    needleLeft: theme.vumeter.needleLeft ?? level,
    needleRight: theme.vumeter.needleRight ?? theme.vumeter.peak ?? 'rgb(255, 127, 0)',
    needleCombined: theme.vumeter.needleCombined ?? level,
    background: theme.vumeter.background ?? scopes.background,
  }
}

function resolveLUFSMeterTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedLUFSMeterTheme {
  const level = theme.lufsmeter.level ?? app.accent
  return {
    level,
    track: theme.lufsmeter.track ?? withAlpha(level, 0.08),
    target: theme.lufsmeter.target ?? withAlpha(level, 0.25),
    scale: theme.lufsmeter.scale ?? scopes.guides,
    labels: theme.lufsmeter.labels ?? blendText(app.text, app.textMuted, 0.2),
    background: theme.lufsmeter.background ?? scopes.background,
  }
}

function resolveWaveformTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedWaveformTheme {
  const guides = theme.waveform.guides ?? scopes.guides
  return {
    line: theme.waveform.line ?? app.accent,
    guides,
    guidesSecondary: multiplyAlpha(guides, 0.5),
    background: theme.waveform.background ?? scopes.background,
    bandLow: theme.waveform.bandLow ?? DEFAULT_BAND_LOW,
    bandMid: theme.waveform.bandMid ?? DEFAULT_BAND_MID,
    bandHigh: theme.waveform.bandHigh ?? DEFAULT_BAND_HIGH,
  }
}

function resolveAstraTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  controls: ResolvedControlsTokens,
  scopes: ResolvedScopesTokens,
): ResolvedNowPlayingTheme {
  const accent = theme.nowPlaying.accent ?? app.accent
  const text = theme.nowPlaying.text ?? app.text
  const buttonBg = theme.nowPlaying.buttonSurface ?? controls.surface
  return {
    accent,
    text,
    subtext: withAlpha(text, 0.7),
    background: theme.nowPlaying.background ?? scopes.background,
    surface: theme.nowPlaying.surface ?? 'rgba(10, 16, 24, 0.92)',
    border: theme.nowPlaying.border ?? withAlpha(app.border, 0.9),
    progressTrack: theme.nowPlaying.progressTrack ?? withAlpha(text, 0.18),
    progressFill: theme.nowPlaying.progressFill ?? accent,
    buttonBg,
    buttonBgHover: withAlpha(mixColors(buttonBg, accent, 0.14), 0.94),
    buttonBgActive: withAlpha(accent, 0.16),
    buttonBorder: theme.nowPlaying.buttonBorder ?? controls.border,
    buttonText: text,
    statusOk: theme.nowPlaying.statusOk ?? app.success,
    statusError: theme.nowPlaying.statusError ?? app.danger,
  }
}

export function resolveTheme(theme: PrismTheme): PrismResolvedTheme {
  const normalized = normalizeTheme(theme, theme.name)
  const app = resolveAppTokens(normalized.app)
  const controls = resolveControlsTokens(normalized.controls, app)
  const scopes = resolveScopesTokens(normalized.scopes, app)

  return {
    name: normalized.name,
    credit: normalized.credit,
    website: normalized.website,
    description: normalized.description,
    interface: resolveInterfaceTheme(app, controls, scopes),
    spectrum: resolveSpectrumTheme(normalized, app, scopes),
    oscilloscope: resolveOscilloscopeTheme(normalized, app, scopes),
    vectorscope: resolveVectorscopeTheme(normalized, app, scopes),
    spectrogram: resolveSpectrogramTheme(normalized, app, scopes),
    vumeter: resolveVUMeterTheme(normalized, app, scopes),
    lufsmeter: resolveLUFSMeterTheme(normalized, app, scopes),
    waveform: resolveWaveformTheme(normalized, app, scopes),
    nowPlaying: resolveAstraTheme(normalized, app, controls, scopes),
  }
}

export function resolveNativeThemeSource(theme: PrismTheme | null | undefined): 'dark' | 'light' {
  const resolved = resolveTheme(theme ?? createDefaultTheme())
  const parsed = parseCssColor(resolved.interface.menuBg) ?? parseThemeChannelColor(resolved.interface.menuBg)
  if (!parsed) {
    return 'dark'
  }

  return getPerceivedBrightness(parsed) >= 156 ? 'light' : 'dark'
}

export function resolveLegacyThemeToPresetId(payload: LegacyThemeMigrationPayload): string | null {
  switch (payload.presetId) {
    case 'default':
      return DEFAULT_THEME_NAME
    case 'graphite':
      return 'Graphite'
    case 'midnight':
      return 'Midnight'
    case 'green':
      return 'Green'
    case 'purple':
      return 'Purple'
    case 'rose':
      return 'Rose'
    default:
      return null
  }
}

export function resolveLegacyThemeFileId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  switch (value.trim().toLowerCase()) {
    case 'default':
    case 'theme_default':
      return DEFAULT_THEME_NAME
    case 'graphite':
    case 'theme_graphite':
      return 'Graphite'
    case 'midnight':
    case 'theme_midnight':
      return 'Midnight'
    case 'green':
    case 'theme_green':
      return 'Green'
    case 'purple':
    case 'theme_purple':
      return 'Purple'
    case 'rose':
    case 'theme_rose':
      return 'Rose'
    default:
      return null
  }
}

export function createMigratedAccentTheme(accent: string): PrismTheme | null {
  const parsed = parseCssColor(accent)
  if (!parsed) return null

  const base = cloneTheme(createDefaultTheme())
  base.name = 'Migrated Accent'
  base.app.accent = toCssColor(parsed)
  base.controls.surfaceActive = withAlpha(base.app.accent, 0.12)
  base.controls.borderActive = withAlpha(base.app.accent, 0.28)
  base.controls.slider = withAlpha(base.app.accent, 0.82)
  base.spectrum.line = base.app.accent
  base.spectrum.sideLine = withAlpha(base.app.accent, 0.5)
  base.spectrum.fill = withAlpha(base.app.accent, 0.34)
  base.oscilloscope.line = base.app.accent
  base.vectorscope.trace = base.app.accent
  base.spectrogram.mono = base.app.accent
  base.vumeter.level = base.app.accent
  base.vumeter.track = withAlpha(base.app.accent, 0.08)
  base.vumeter.needleLeft = base.app.accent
  base.vumeter.needleCombined = base.app.accent
  base.lufsmeter.level = base.app.accent
  base.lufsmeter.track = withAlpha(base.app.accent, 0.08)
  base.lufsmeter.target = withAlpha(base.app.accent, 0.25)
  base.waveform.line = base.app.accent
  base.nowPlaying.accent = base.app.accent
  base.nowPlaying.progressFill = base.app.accent
  return normalizeTheme(base, base.name)
}

export function themeToCssVariables(theme: Pick<PrismResolvedTheme, 'interface'>): Record<string, string> {
  const ui = theme.interface
  return {
    '--bg-primary': ui.bgPrimary,
    '--bg-secondary': ui.bgSecondary,
    '--bg-tertiary': ui.bgTertiary,
    '--panel-surface': ui.panelSurface,
    '--panel-surface-soft': ui.panelSurfaceSoft,
    '--panel-outline': ui.panelOutline,
    '--panel-outline-strong': ui.panelOutlineStrong,
    '--glass-bg': ui.glassBg,
    '--glass-border': ui.glassBorder,
    '--glass-highlight': ui.glassHighlight,
    '--glass-highlight-strong': ui.glassHighlightStrong,
    '--text-primary': ui.textPrimary,
    '--text-secondary': ui.textSecondary,
    '--text-tertiary': ui.textTertiary,
    '--text-muted': ui.textMuted,
    '--danger': ui.danger,
    '--warning': ui.warning,
    '--success': ui.success,
    '--accent': ui.accent,
    '--accent-hover': ui.accentHover,
    '--accent-glow': ui.accentGlow,
    '--accent-rgb': ui.accentRgb,
    '--toolbar-bg': ui.toolbarBg,
    '--settings-bg-top': ui.settingsBgTop,
    '--settings-bg-bottom': ui.settingsBgBottom,
    '--bottom-bar-bg': ui.bottomBarBg,
    '--menu-bg': ui.menuBg,
    '--menu-border': ui.menuBorder,
    '--control-bg': ui.controlBg,
    '--control-bg-hover': ui.controlBgHover,
    '--control-bg-active': ui.controlBgActive,
    '--control-border': ui.controlBorder,
    '--control-border-active': ui.controlBorderActive,
    '--control-text': ui.controlText,
    '--input-bg': ui.inputBg,
    '--input-bg-focus': ui.inputBgFocus,
    '--input-border': ui.inputBorder,
    '--input-border-focus': ui.inputBorderFocus,
    '--option-bg': ui.optionBg,
    '--option-text': ui.optionText,
    '--slider-track': ui.sliderTrack,
    '--slider-fill': ui.sliderFill,
    '--slider-thumb': ui.sliderThumb,
    '--divider': ui.divider,
    '--scope-bg': ui.scopeBackground,
    '--scope-guides': ui.scopeGuides,
    '--scope-overlay-bg': ui.scopeOverlayBg,
    '--scope-overlay-text': ui.scopeOverlayText,
    '--scope-overlay-border': ui.scopeOverlayBorder,
    '--scope-resize-handle': ui.scopeResizeHandle,
  }
}

export function applyResolvedThemeToDocument(
  theme: Pick<PrismResolvedTheme, 'interface'>,
  root: Pick<CSSStyleDeclaration, 'setProperty'>,
): void {
  const variables = themeToCssVariables(theme)
  for (const [name, value] of Object.entries(variables)) {
    root.setProperty(name, value)
  }
  root.setProperty('color-scheme', theme.interface.colorScheme)
}

export function getDefaultThemeIdForLocalState(): string {
  return DEFAULT_THEME_NAME
}

export function getLegacyThemeMigrationVersion(): number {
  return LEGACY_THEME_MIGRATION_VERSION
}

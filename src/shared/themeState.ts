import {
  DEFAULT_THEME_ID,
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
  type ResolvedAstraTheme,
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
  type ThemeAstraTokens,
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
  line: 'line',
  side_line: 'sideLine',
  fill: 'fill',
  heat_low: 'heatLow',
  heat_mid: 'heatMid',
  heat_high: 'heatHigh',
} as const satisfies SectionSchema<ThemeSpectrumTokens>

const OSCILLOSCOPE_SCHEMA = {
  line: 'line',
  fill: 'fill',
} as const satisfies SectionSchema<ThemeOscilloscopeTokens>

const VECTORSCOPE_SCHEMA = {
  trace: 'trace',
  band_low: 'bandLow',
  band_mid: 'bandMid',
  band_high: 'bandHigh',
} as const satisfies SectionSchema<ThemeVectorscopeTokens>

const SPECTROGRAM_SCHEMA = {
  mono: 'mono',
  heat_low: 'heatLow',
  heat_mid: 'heatMid',
  heat_high: 'heatHigh',
} as const satisfies SectionSchema<ThemeSpectrogramTokens>

const VUMETER_SCHEMA = {
  level: 'level',
  track: 'track',
  peak: 'peak',
  clip: 'clip',
} as const satisfies SectionSchema<ThemeVUMeterTokens>

const LUFSMETER_SCHEMA = {
  level: 'level',
  track: 'track',
  target: 'target',
} as const satisfies SectionSchema<ThemeLUFSMeterTokens>

const WAVEFORM_SCHEMA = {
  line: 'line',
  band_low: 'bandLow',
  band_mid: 'bandMid',
  band_high: 'bandHigh',
} as const satisfies SectionSchema<ThemeWaveformTokens>

const ASTRA_SCHEMA = {
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
} as const satisfies SectionSchema<ThemeAstraTokens>

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
  astra: 'astra',
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
  astra: 'Astra',
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
  astra: ASTRA_SCHEMA,
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
    id: DEFAULT_THEME_ID,
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
    astra: {},
  }
}

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

    const parsedColor = parseCssColor(rawValue) ?? parseThemeChannelColor(rawValue)
    if (!parsedColor) continue
    next[key] = toCssColor(quantizeThemeColor(parsedColor)) as T[typeof key]
  }

  return next
}

export function createDefaultTheme(): PrismTheme {
  return normalizeTheme({
    id: DEFAULT_THEME_ID,
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
    astra: {
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
  }, DEFAULT_THEME_ID, DEFAULT_THEME_NAME)
}

function cloneTheme(theme: PrismTheme): PrismTheme {
  return JSON.parse(JSON.stringify(theme)) as PrismTheme
}

function createPresetTheme(id: string, name: string, accent: string): PrismTheme {
  const base = cloneTheme(createDefaultTheme())
  base.id = id
  base.name = name
  base.app.accent = accent
  base.controls.surfaceActive = withAlpha(accent, 0.12)
  base.controls.borderActive = withAlpha(accent, 0.28)
  base.controls.slider = withAlpha(accent, 0.82)
  base.spectrum.line = accent
  base.spectrum.sideLine = withAlpha(accent, 0.5)
  base.spectrum.fill = withAlpha(accent, 0.34)
  base.oscilloscope.line = accent
  base.vectorscope.trace = accent
  base.spectrogram.mono = accent
  base.vumeter.level = accent
  base.vumeter.track = withAlpha(accent, 0.08)
  base.lufsmeter.level = accent
  base.lufsmeter.track = withAlpha(accent, 0.08)
  base.lufsmeter.target = withAlpha(accent, 0.25)
  base.waveform.line = accent
  base.astra.accent = accent
  base.astra.progressFill = accent
  return normalizeTheme(base, id, name)
}

export function createBundledThemes(): PrismTheme[] {
  return [
    createDefaultTheme(),
    createPresetTheme('theme_graphite', 'Graphite', '#4fc3f7'),
    createPresetTheme('theme_midnight', 'Midnight', '#4f9bff'),
    createPresetTheme('theme_green', 'Green', '#4ade80'),
    createPresetTheme('theme_purple', 'Purple', '#a78bfa'),
    createPresetTheme('theme_rose', 'Rose', '#fb7185'),
  ]
}

export function normalizeTheme(
  raw: unknown,
  fallbackId = DEFAULT_THEME_ID,
  fallbackName = DEFAULT_THEME_NAME,
): PrismTheme {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PrismTheme>
    : {}

  const id = typeof parsed.id === 'string' && parsed.id.trim()
    ? parsed.id.trim()
    : fallbackId

  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim()
    : fallbackName

  const normalized = createEmptyTheme()
  normalized.id = id
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
  normalized.astra = normalizeSectionTokens(parsed.astra, ASTRA_SCHEMA)
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

function parseThemeContent(content: string, fallbackId: string, fallbackName: string): PrismTheme {
  const nextTheme = createEmptyTheme()
  nextTheme.id = fallbackId
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
        case 'id':
          nextTheme.id = value
          break
        case 'name':
          nextTheme.name = value
          break
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

    const parsedColor = parseCssColor(value) ?? parseThemeChannelColor(value)
    if (!parsedColor) continue
    getSectionTokenRecord(nextTheme, currentSection)[tokenKey] = toCssColor(quantizeThemeColor(parsedColor))
  }

  return normalizeTheme(nextTheme, fallbackId, fallbackName)
}

export function parseThemeFileContent(
  content: string,
  fallbackId: string,
  fallbackName = DEFAULT_THEME_NAME,
): PrismTheme {
  return parseThemeContent(content, fallbackId, fallbackName)
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
    lines.push(`${serializedKey} = ${toThemeChannels(value)}`)
  }

  return lines
}

export function serializeThemeFile(theme: PrismTheme): string {
  const normalized = normalizeTheme(theme, theme.id, theme.name)
  const sections: string[] = [
    '[Theme]',
    `format = ${THEME_FILE_FORMAT}`,
    `version = ${THEME_FILE_VERSION}`,
    `id = ${normalized.id}`,
    `name = ${normalized.name}`,
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
  const template = createDefaultTheme()
  template.id = 'theme_template'
  template.name = 'Template Theme'
  template.credit = 'Your Name'
  template.website = 'https://example.com'

  return `# Prism theme template
#
# Authoring rules:
# - Colors use R, G, B or R, G, B, A (0-255)
# - CSS colors like #hex, rgb(), and rgba() also work
# - [App] controls the overall chrome and text
# - [Controls] covers buttons, inputs, menus, and sliders
# - [Scopes] covers the shared analyzer background and guide system
# - Scope sections should only override visuals unique to that module
#
${serializeThemeFile(template)}`
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
    bgPrimary: app.background,
    bgSecondary: darken(app.background, 0.04),
    bgTertiary: darken(app.background, 0.08),
    panelSurface: app.surface,
    panelSurfaceSoft: app.surfaceAlt,
    panelOutline: app.border,
    panelOutlineStrong: withAlpha(app.border, 0.9),
    glassBg: withAlpha(app.surface, 0.18),
    glassBorder: withAlpha(app.border, 0.85),
    glassHighlight: withAlpha(app.text, 0.05),
    textPrimary: app.text,
    textSecondary: blendText(app.text, app.textMuted, 0.45),
    textTertiary: blendText(app.text, app.textMuted, 0.7),
    textMuted: app.textMuted,
    toolbarBg: withAlpha(app.surfaceAlt, 0.78),
    settingsBgTop: app.surface,
    settingsBgBottom: app.surfaceAlt,
    bottomBarBg: withAlpha(app.surfaceAlt, 0.98),
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
  return {
    line,
    sideLine,
    guides: scopes.guides,
    guidesSecondary: scopes.guidesSecondary,
    labels: scopes.labels,
    background: scopes.background,
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
  }
}

function resolveOscilloscopeTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedOscilloscopeTheme {
  return {
    line: theme.oscilloscope.line ?? app.accent,
    guides: scopes.guides,
    guidesSecondary: scopes.guidesSecondary,
    background: scopes.background,
    fill: theme.oscilloscope.fill ?? 'rgba(245, 248, 252, 0.18)',
  }
}

function resolveVectorscopeTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedVectorscopeTheme {
  return {
    trace: theme.vectorscope.trace ?? app.accent,
    guides: scopes.guides,
    guidesSecondary: scopes.guidesSecondary,
    labels: scopes.labels,
    background: scopes.background,
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
    background: scopes.background,
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
    scale: scopes.guides,
    labels: blendText(app.text, app.textMuted, 0.35),
    background: scopes.background,
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
    scale: scopes.guides,
    labels: blendText(app.text, app.textMuted, 0.2),
    background: scopes.background,
  }
}

function resolveWaveformTheme(
  theme: PrismTheme,
  app: ResolvedAppTokens,
  scopes: ResolvedScopesTokens,
): ResolvedWaveformTheme {
  return {
    line: theme.waveform.line ?? app.accent,
    guides: scopes.guides,
    guidesSecondary: scopes.guidesSecondary,
    background: scopes.background,
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
): ResolvedAstraTheme {
  const accent = theme.astra.accent ?? app.accent
  const text = theme.astra.text ?? app.text
  const buttonBg = theme.astra.buttonSurface ?? controls.surface
  return {
    accent,
    text,
    subtext: withAlpha(text, 0.7),
    background: theme.astra.background ?? scopes.background,
    surface: theme.astra.surface ?? 'rgba(10, 16, 24, 0.92)',
    border: theme.astra.border ?? withAlpha(app.border, 0.9),
    progressTrack: theme.astra.progressTrack ?? withAlpha(text, 0.18),
    progressFill: theme.astra.progressFill ?? accent,
    buttonBg,
    buttonBgHover: withAlpha(mixColors(buttonBg, accent, 0.14), 0.94),
    buttonBgActive: withAlpha(accent, 0.16),
    buttonBorder: theme.astra.buttonBorder ?? controls.border,
    buttonText: text,
    statusOk: theme.astra.statusOk ?? app.success,
    statusError: theme.astra.statusError ?? app.danger,
  }
}

export function resolveTheme(theme: PrismTheme): PrismResolvedTheme {
  const normalized = normalizeTheme(theme, theme.id, theme.name)
  const app = resolveAppTokens(normalized.app)
  const controls = resolveControlsTokens(normalized.controls, app)
  const scopes = resolveScopesTokens(normalized.scopes, app)

  return {
    id: normalized.id,
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
    astra: resolveAstraTheme(normalized, app, controls, scopes),
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
      return DEFAULT_THEME_ID
    case 'graphite':
      return 'theme_graphite'
    case 'midnight':
      return 'theme_midnight'
    case 'green':
      return 'theme_green'
    case 'purple':
      return 'theme_purple'
    case 'rose':
      return 'theme_rose'
    default:
      return null
  }
}

export function createMigratedAccentTheme(accent: string): PrismTheme | null {
  const parsed = parseCssColor(accent)
  if (!parsed) return null

  const base = cloneTheme(createDefaultTheme())
  base.id = 'theme_migrated_accent'
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
  base.lufsmeter.level = base.app.accent
  base.lufsmeter.track = withAlpha(base.app.accent, 0.08)
  base.lufsmeter.target = withAlpha(base.app.accent, 0.25)
  base.waveform.line = base.app.accent
  base.astra.accent = base.app.accent
  base.astra.progressFill = base.app.accent
  return normalizeTheme(base, base.id, base.name)
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
}

export function getDefaultThemeIdForLocalState(): string {
  return DEFAULT_THEME_ID
}

export function getLegacyThemeMigrationVersion(): number {
  return LEGACY_THEME_MIGRATION_VERSION
}

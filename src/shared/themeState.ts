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
  type ResolvedInterfaceTheme,
  type ResolvedLUFSMeterTheme,
  type ResolvedOscilloscopeTheme,
  type ResolvedSpectrogramTheme,
  type ResolvedSpectrumTheme,
  type ResolvedVectorscopeTheme,
  type ResolvedVUMeterTheme,
  type ResolvedWaveformTheme,
  type ThemeSectionName,
  type ThemeTokens,
} from '../types/theme'

const DEFAULT_BAND_LOW = '#ff4444'
const DEFAULT_BAND_MID = '#44dd44'
const DEFAULT_BAND_HIGH = '#4488ff'
const DEFAULT_WARNING = 'rgb(255, 191, 0)'
const DEFAULT_SUCCESS = '#22c55e'
const DEFAULT_DANGER = '#f87171'

const MODULE_SECTION_ORDER: ThemeSectionName[] = [
  'all',
  'interface',
  'spectrum',
  'oscilloscope',
  'vectorscope',
  'spectrogram',
  'vumeter',
  'lufsmeter',
  'waveform',
]

const COLOR_KEY_ORDER: Array<keyof ThemeTokens> = [
  'primary',
  'secondary',
  'guides',
  'text',
  'background',
  'lowBand',
  'midBand',
  'highBand',
  'fill',
  'peak',
  'clip',
  'target',
  'heatLow',
  'heatMid',
  'heatHigh',
  'success',
  'warning',
  'danger',
]

const SECTION_KEY_MAP: Record<string, ThemeSectionName> = {
  all: 'all',
  interface: 'interface',
  spectrum: 'spectrum',
  oscilloscope: 'oscilloscope',
  vectorscope: 'vectorscope',
  spectrogram: 'spectrogram',
  vumeter: 'vumeter',
  lufsmeter: 'lufsmeter',
  waveform: 'waveform',
}

const TOKEN_KEY_MAP: Record<string, keyof ThemeTokens> = {
  primary: 'primary',
  secondary: 'secondary',
  guides: 'guides',
  text: 'text',
  background: 'background',
  low_band: 'lowBand',
  mid_band: 'midBand',
  high_band: 'highBand',
  fill: 'fill',
  peak: 'peak',
  clip: 'clip',
  target: 'target',
  heat_low: 'heatLow',
  heat_mid: 'heatMid',
  heat_high: 'heatHigh',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

const TOKEN_PROPERTY_KEY_MAP: Record<string, keyof ThemeTokens> = {
  primary: 'primary',
  secondary: 'secondary',
  guides: 'guides',
  text: 'text',
  background: 'background',
  lowBand: 'lowBand',
  midBand: 'midBand',
  highBand: 'highBand',
  fill: 'fill',
  peak: 'peak',
  clip: 'clip',
  target: 'target',
  heatLow: 'heatLow',
  heatMid: 'heatMid',
  heatHigh: 'heatHigh',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

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

    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null
    }

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

function createEmptyThemeTokens(): ThemeTokens {
  return {}
}

function createEmptyTheme(): PrismTheme {
  return {
    id: DEFAULT_THEME_ID,
    name: DEFAULT_THEME_NAME,
    all: createEmptyThemeTokens(),
    interface: createEmptyThemeTokens(),
    spectrum: createEmptyThemeTokens(),
    oscilloscope: createEmptyThemeTokens(),
    vectorscope: createEmptyThemeTokens(),
    spectrogram: createEmptyThemeTokens(),
    vumeter: createEmptyThemeTokens(),
    lufsmeter: createEmptyThemeTokens(),
    waveform: createEmptyThemeTokens(),
  }
}

function mergeThemeTokens(base: ThemeTokens, overrides?: ThemeTokens): ThemeTokens {
  return {
    ...base,
    ...(overrides ?? {}),
  }
}

function normalizeTokens(raw: unknown): ThemeTokens {
  if (typeof raw !== 'object' || raw === null) {
    return createEmptyThemeTokens()
  }

  const parsed = raw as Record<string, unknown>
  const next: ThemeTokens = {}

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') continue
    const key = TOKEN_PROPERTY_KEY_MAP[rawKey] ?? TOKEN_KEY_MAP[normalizeKey(rawKey)]
    if (!key) continue
    const parsedColor = parseCssColor(rawValue) ?? parseThemeChannelColor(rawValue)
    if (!parsedColor) continue
    next[key] = toCssColor(quantizeThemeColor(parsedColor))
  }

  return next
}

export function createDefaultTheme(): PrismTheme {
  return normalizeTheme({
    id: DEFAULT_THEME_ID,
    name: DEFAULT_THEME_NAME,
    credit: 'Prism',
    all: {
      primary: '#38bdf8',
      secondary: 'rgb(172, 192, 222)',
      guides: 'rgba(255, 255, 255, 0.1)',
      text: 'rgb(255, 255, 255)',
      background: 'rgb(0, 0, 0)',
      lowBand: DEFAULT_BAND_LOW,
      midBand: DEFAULT_BAND_MID,
      highBand: DEFAULT_BAND_HIGH,
      success: DEFAULT_SUCCESS,
      warning: DEFAULT_WARNING,
      danger: DEFAULT_DANGER,
    },
    interface: {
      secondary: 'rgba(8, 11, 16, 0.92)',
      guides: 'rgba(255, 255, 255, 0.09)',
      background: 'rgb(0, 0, 0)',
    },
    spectrum: {
      secondary: 'rgba(56, 189, 248, 0.5)',
      heatLow: 'rgb(15, 7, 33)',
      heatMid: 'rgb(163, 26, 121)',
      heatHigh: 'rgb(255, 241, 209)',
    },
    oscilloscope: {
      fill: 'rgba(245, 248, 252, 0.18)',
    },
    spectrogram: {
      heatLow: 'rgb(15, 7, 33)',
      heatMid: 'rgb(163, 26, 121)',
      heatHigh: 'rgb(255, 241, 209)',
    },
    vumeter: {
      peak: 'rgb(255, 127, 0)',
      clip: 'rgba(255, 120, 80, 0.9)',
    },
    lufsmeter: {
      target: 'rgba(56, 189, 248, 0.25)',
    },
  }, DEFAULT_THEME_ID, DEFAULT_THEME_NAME)
}

function cloneTheme(theme: PrismTheme): PrismTheme {
  return JSON.parse(JSON.stringify(theme)) as PrismTheme
}

function createPresetTheme(id: string, name: string, primary: string): PrismTheme {
  const base = cloneTheme(createDefaultTheme())
  base.id = id
  base.name = name
  base.all.primary = primary
  base.spectrum.secondary = multiplyAlpha(primary, 0.6)
  base.lufsmeter.target = withAlpha(primary, 0.25)
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
  normalized.all = normalizeTokens(parsed.all)
  normalized.interface = normalizeTokens(parsed.interface)
  normalized.spectrum = normalizeTokens(parsed.spectrum)
  normalized.oscilloscope = normalizeTokens(parsed.oscilloscope)
  normalized.vectorscope = normalizeTokens(parsed.vectorscope)
  normalized.spectrogram = normalizeTokens(parsed.spectrogram)
  normalized.vumeter = normalizeTokens(parsed.vumeter)
  normalized.lufsmeter = normalizeTokens(parsed.lufsmeter)
  normalized.waveform = normalizeTokens(parsed.waveform)
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

function parseThemeContent(content: string, fallbackId: string, fallbackName: string): PrismTheme {
  const nextTheme = createEmptyTheme()
  nextTheme.id = fallbackId
  nextTheme.name = fallbackName

  let currentSection: ThemeSectionName | 'theme' | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }

    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      const sectionKey = normalizeKey(sectionMatch[1] ?? '')
      currentSection = sectionKey === 'theme'
        ? 'theme'
        : (SECTION_KEY_MAP[sectionKey] ?? null)
      continue
    }

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1 || !currentSection) {
      continue
    }

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

    const tokenKey = TOKEN_KEY_MAP[key]
    if (!tokenKey) continue

    const parsedColor = parseThemeChannelColor(value)
    if (!parsedColor) continue
    nextTheme[currentSection][tokenKey] = toCssColor(parsedColor)
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

function serializeSection(sectionName: string, tokens: ThemeTokens): string[] {
  const lines: string[] = [`[${sectionName}]`]

  for (const key of COLOR_KEY_ORDER) {
    const value = tokens[key]
    if (!value) continue
    const serializedKey = key
      .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
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

  for (const section of MODULE_SECTION_ORDER) {
    const tokens = normalized[section]
    if (!Object.values(tokens).some(Boolean)) continue
    const label = section === 'interface'
      ? 'Interface'
      : section === 'all'
        ? 'All'
        : section === 'vumeter'
          ? 'VUMeter'
          : section === 'lufsmeter'
            ? 'LUFSMeter'
            : `${section.charAt(0).toUpperCase()}${section.slice(1)}`
    output.push(serializeSection(label, tokens).join('\n'))
  }

  return `${output.join('\n\n')}\n`
}

export function createTemplateThemeFile(): string {
  return `# Prism theme template\n#\n# Authoring rules:\n# - Colors use R, G, B or R, G, B, A (0-255)\n# - Omit sections or keys you do not want to override\n# - [All] sets the defaults for everything else\n# - [Interface] overrides the app window, controls, and menus\n# - Module sections only need the colors that should differ from [All]\n\n[Theme]\nformat = ${THEME_FILE_FORMAT}\nversion = ${THEME_FILE_VERSION}\nid = theme_template\nname = Template Theme\ncredit = Your Name\nwebsite = https://example.com\n\n[All]\nprimary = 56, 189, 248\nsecondary = 172, 192, 222\nguides = 255, 255, 255, 26\ntext = 255, 255, 255\nbackground = 0, 0, 0\nlow_band = 255, 68, 68\nmid_band = 68, 221, 68\nhigh_band = 68, 136, 255\nsuccess = 34, 197, 94\nwarning = 255, 191, 0\ndanger = 248, 113, 113\n\n[Interface]\nsecondary = 8, 11, 16, 235\nguides = 255, 255, 255, 23\nbackground = 0, 0, 0\n\n[Spectrum]\nsecondary = 56, 189, 248, 127\nheat_low = 15, 7, 33\nheat_mid = 163, 26, 121\nheat_high = 255, 241, 209\n\n[Oscilloscope]\nfill = 245, 248, 252, 46\n\n[VUMeter]\npeak = 255, 127, 0\nclip = 255, 120, 80, 230\n\n[LUFSMeter]\ntarget = 56, 189, 248, 64\n`
}

function getThemeFallbackSection(base: ThemeTokens): Required<ThemeTokens> {
  const primary = base.primary ?? '#38bdf8'
  return {
    primary,
    secondary: base.secondary ?? lighten(primary, 0.22),
    guides: base.guides ?? 'rgba(255, 255, 255, 0.1)',
    text: base.text ?? 'rgb(255, 255, 255)',
    background: base.background ?? 'transparent',
    lowBand: base.lowBand ?? DEFAULT_BAND_LOW,
    midBand: base.midBand ?? DEFAULT_BAND_MID,
    highBand: base.highBand ?? DEFAULT_BAND_HIGH,
    fill: base.fill ?? withAlpha(primary, 0.18),
    peak: base.peak ?? 'rgb(255, 127, 0)',
    clip: base.clip ?? 'rgba(255, 120, 80, 0.9)',
    target: base.target ?? withAlpha(primary, 0.25),
    heatLow: base.heatLow ?? 'rgb(15, 7, 33)',
    heatMid: base.heatMid ?? 'rgb(163, 26, 121)',
    heatHigh: base.heatHigh ?? 'rgb(255, 241, 209)',
    success: base.success ?? DEFAULT_SUCCESS,
    warning: base.warning ?? DEFAULT_WARNING,
    danger: base.danger ?? DEFAULT_DANGER,
  }
}

function resolveInterfaceTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedInterfaceTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.interface))
  const background = section.background
  const surface = theme.interface.secondary ?? mixColors(background, section.text, 0.06)
  const guides = theme.interface.guides ?? all.guides
  const primary = section.primary
  const text = section.text

  return {
    primary,
    secondary: section.secondary,
    guides,
    text,
    background,
    accent: primary,
    accentHover: lighten(primary, 0.2),
    accentGlow: withAlpha(primary, 0.3),
    accentRgb: colorToRgbChannels(primary),
    bgPrimary: background,
    bgSecondary: darken(background, 0.04),
    bgTertiary: darken(background, 0.08),
    panelSurface: surface,
    panelSurfaceSoft: multiplyAlpha(surface, 0.92),
    panelOutline: withAlpha(guides, 0.5),
    panelOutlineStrong: withAlpha(guides, 0.9),
    glassBg: withAlpha(surface, 0.18),
    glassBorder: withAlpha(guides, 0.7),
    glassHighlight: withAlpha(text, 0.05),
    textPrimary: text,
    textSecondary: withAlpha(text, 0.62),
    textTertiary: withAlpha(text, 0.42),
    textMuted: withAlpha(text, 0.3),
    toolbarBg: withAlpha(background, 0.74),
    settingsBgTop: multiplyAlpha(surface, 0.98),
    settingsBgBottom: withAlpha(darken(background, 0.2), 0.98),
    bottomBarBg: withAlpha(darken(background, 0.08), 0.98),
    menuBg: withAlpha(surface, 0.96),
    menuBorder: withAlpha(guides, 0.75),
    controlBg: withAlpha(section.secondary, 0.08),
    controlBgHover: withAlpha(lighten(section.secondary, 0.08), 0.12),
    controlBgActive: withAlpha(primary, 0.12),
    controlBorder: withAlpha(guides, 0.7),
    controlBorderActive: withAlpha(primary, 0.34),
    inputBg: withAlpha(surface, 0.98),
    inputBgFocus: withAlpha(lighten(surface, 0.05), 0.98),
    inputBorder: withAlpha(guides, 0.8),
    inputBorderFocus: withAlpha(primary, 0.7),
    divider: withAlpha(guides, 0.55),
    success: all.success,
    warning: all.warning,
    danger: all.danger,
  }
}

function resolveSpectrumTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedSpectrumTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.spectrum))
  return {
    primary: section.primary,
    secondary: section.secondary,
    guides: section.guides,
    background: theme.spectrum.background ?? 'transparent',
    fillGradient: [
      withAlpha(section.primary, 0),
      withAlpha(section.primary, 0.3),
      withAlpha(section.secondary, 0.5),
    ],
    heatColors: [section.heatLow, section.heatMid, section.heatHigh],
  }
}

function resolveOscilloscopeTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedOscilloscopeTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.oscilloscope))
  return {
    primary: section.primary,
    guides: section.guides,
    background: theme.oscilloscope.background ?? 'transparent',
    fill: section.fill,
  }
}

function resolveVectorscopeTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedVectorscopeTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.vectorscope))
  return {
    primary: section.primary,
    guides: section.guides,
    background: theme.vectorscope.background ?? 'transparent',
    lowBand: section.lowBand,
    midBand: section.midBand,
    highBand: section.highBand,
  }
}

function resolveSpectrogramTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedSpectrogramTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.spectrogram))
  return {
    primary: section.primary,
    guides: section.guides,
    background: theme.spectrogram.background ?? 'transparent',
    heatColors: [section.heatLow, section.heatMid, section.heatHigh],
  }
}

function resolveVUMeterTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedVUMeterTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.vumeter))
  return {
    primary: section.primary,
    peak: section.peak,
    clip: section.clip,
    guides: section.guides,
    text: section.text,
    background: theme.vumeter.background ?? 'transparent',
  }
}

function resolveLUFSMeterTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedLUFSMeterTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.lufsmeter))
  return {
    primary: section.primary,
    target: section.target,
    guides: section.guides,
    text: section.text,
    background: theme.lufsmeter.background ?? 'transparent',
  }
}

function resolveWaveformTheme(theme: PrismTheme, all: Required<ThemeTokens>): ResolvedWaveformTheme {
  const section = getThemeFallbackSection(mergeThemeTokens(all, theme.waveform))
  return {
    primary: section.primary,
    guides: section.guides,
    background: theme.waveform.background ?? 'transparent',
    lowBand: section.lowBand,
    midBand: section.midBand,
    highBand: section.highBand,
  }
}

export function resolveTheme(theme: PrismTheme): PrismResolvedTheme {
  const normalized = normalizeTheme(theme, theme.id, theme.name)
  const baseAll = getThemeFallbackSection(mergeThemeTokens(createDefaultTheme().all, normalized.all))

  return {
    id: normalized.id,
    name: normalized.name,
    credit: normalized.credit,
    website: normalized.website,
    description: normalized.description,
    interface: resolveInterfaceTheme(normalized, baseAll),
    spectrum: resolveSpectrumTheme(normalized, baseAll),
    oscilloscope: resolveOscilloscopeTheme(normalized, baseAll),
    vectorscope: resolveVectorscopeTheme(normalized, baseAll),
    spectrogram: resolveSpectrogramTheme(normalized, baseAll),
    vumeter: resolveVUMeterTheme(normalized, baseAll),
    lufsmeter: resolveLUFSMeterTheme(normalized, baseAll),
    waveform: resolveWaveformTheme(normalized, baseAll),
  }
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
  base.all.primary = toCssColor(parsed)
  base.spectrum.secondary = withAlpha(base.all.primary, 0.5)
  base.lufsmeter.target = withAlpha(base.all.primary, 0.25)
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
    '--input-bg': ui.inputBg,
    '--input-bg-focus': ui.inputBgFocus,
    '--input-border': ui.inputBorder,
    '--input-border-focus': ui.inputBorderFocus,
    '--divider': ui.divider,
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

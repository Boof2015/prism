import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { FileBackedThemeLibrary } from '../src/main/themeLibrary'
import {
  createBundledThemes,
  createDefaultTheme,
  createTemplateThemeFile,
  createMigratedAccentTheme,
  parseThemeFileContent,
  resolveTheme,
  serializeThemeFile,
  themeToCssVariables,
} from '../src/shared/themeState'
import {
  DEFAULT_THEME_NAME,
} from '../src/types/theme'

const BUNDLED_THEME_FILE_NAMES = [
  'Alpha Centauri.iro',
  'Chroma Blue.iro',
  'Chroma Green.iro',
  'Default.iro',
  'Redshift.iro',
  'Stanky Leg.iro',
  '_TEMPLATE.iro',
].sort()

const OLD_GENERATED_THEME_FILE_NAMES = [
  'Graphite.iro',
  'Green.iro',
  'Midnight.iro',
  'Purple.iro',
  'Rose.iro',
]

async function createHarness(): Promise<{
  cleanup: () => Promise<void>
  library: FileBackedThemeLibrary
  localStatePath: string
  themesDir: string
  rootDir: string
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-theme-library-'))
  const themesDir = join(rootDir, 'Documents', 'Prism Themes')
  const localStatePath = join(rootDir, 'userData', 'theme-state.json')

  return {
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    library: new FileBackedThemeLibrary(themesDir, localStatePath),
    localStatePath,
    themesDir,
    rootDir,
  }
}

test('theme files round-trip and keep grouped sections intact', () => {
  const theme = createDefaultTheme()
  theme.app.accent = '#4ade80'
  theme.controls.menuSurface = 'rgb(12, 18, 32)'
  theme.controls.flatControls = 'true'
  theme.scopes.background = '#030712'
  theme.spectrum.heatMid = 'rgb(200, 50, 120)'
  theme.vectorscope.phaseRisk = 'rgb(240, 120, 40)'
  theme.vumeter.track = '#111827'
  theme.vumeter.needleLeft = 'rgb(70, 80, 90)'

  const serialized = serializeThemeFile(theme)
  const parsed = parseThemeFileContent(serialized, DEFAULT_THEME_NAME)

  assert.match(serialized, /\[Theme\]/)
  assert.match(serialized, /version = 2/)
  assert.match(serialized, /\[App\]/)
  assert.match(serialized, /\[Controls\]/)
  assert.match(serialized, /\[Scopes\]/)
  assert.match(serialized, /flat_controls = true/)
  assert.match(serialized, /needle_left = 70, 80, 90/)
  assert.match(serialized, /phase_risk = 240, 120, 40/)
  assert.doesNotMatch(serialized, /^id = /m)
  assert.doesNotMatch(serialized, /^name = /m)

  assert.equal(parsed.name, DEFAULT_THEME_NAME)
  assert.equal(parsed.app.accent, 'rgb(74, 222, 128)')
  assert.equal(parsed.controls.menuSurface, 'rgb(12, 18, 32)')
  assert.equal(parsed.controls.flatControls, 'true')
  assert.equal(parsed.scopes.background, 'rgb(3, 7, 18)')
  assert.equal(parsed.spectrum.heatMid, 'rgb(200, 50, 120)')
  assert.equal(parsed.vectorscope.phaseRisk, 'rgb(240, 120, 40)')
  assert.equal(parsed.vumeter.track, 'rgb(17, 24, 39)')
  assert.equal(parsed.vumeter.needleLeft, 'rgb(70, 80, 90)')
  assert.equal(parsed.nowPlaying.background, theme.nowPlaying.background)
})

test('theme files preserve optional credit, website, and description metadata', () => {
  const theme = createDefaultTheme()
  theme.credit = 'Night Shift'
  theme.website = 'https://themes.example/night-shift'
  theme.description = 'Soft neon palette for late sessions'

  const serialized = serializeThemeFile(theme)
  const parsed = parseThemeFileContent(serialized, DEFAULT_THEME_NAME)

  assert.match(serialized, /credit = Night Shift/)
  assert.match(serialized, /website = https:\/\/themes\.example\/night-shift/)
  assert.match(serialized, /description = Soft neon palette for late sessions/)
  assert.equal(parsed.credit, 'Night Shift')
  assert.equal(parsed.website, 'https://themes.example/night-shift')
  assert.equal(parsed.description, 'Soft neon palette for late sessions')
})

test('parseThemeFileContent maps legacy Astra sections into now playing tokens', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2

[Astra]
background = 12, 18, 24, 255
button_surface = 30, 40, 50, 230
`, 'Legacy Astra')

  assert.equal(parsed.nowPlaying.background, 'rgb(12, 18, 24)')
  assert.equal(parsed.nowPlaying.buttonSurface, 'rgba(30, 40, 50, 0.902)')
})

test('parseThemeFileContent preserves passthrough controls tokens from .iro files', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2

[Controls]
flat_controls = true
`, 'Flat')

  const resolved = resolveTheme(parsed)

  assert.equal(parsed.controls.flatControls, 'true')
  assert.equal(resolved.interface.glassBg, 'transparent')
  assert.equal(resolved.interface.glassHighlight, 'transparent')
  assert.equal(resolved.interface.glassHighlightStrong, 'transparent')
})

test('resolveTheme preserves alpha-bearing heat tokens and defaults spectrum heat base to transparent', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2

[Spectrum]
heat_low = 10, 20, 30, 0
heat_mid = 40, 50, 60, 64
heat_high = 70, 80, 90, 204
heat_base = 1, 2, 3, 32

[Spectrogram]
heat_low = 11, 21, 31, 16
heat_mid = 41, 51, 61, 96
heat_high = 71, 81, 91, 255
`, 'Alpha Heat')

  const resolved = resolveTheme(parsed)
  const defaultResolved = resolveTheme(createDefaultTheme())

  assert.deepEqual(resolved.spectrum.heatColors, [
    'rgba(10, 20, 30, 0)',
    'rgba(40, 50, 60, 0.251)',
    'rgba(70, 80, 90, 0.8)',
  ])
  assert.equal(resolved.spectrum.heatBase, 'rgba(1, 2, 3, 0.125)')
  assert.deepEqual(resolved.spectrogram.heatColors, [
    'rgba(11, 21, 31, 0.063)',
    'rgba(41, 51, 61, 0.376)',
    'rgb(71, 81, 91)',
  ])
  assert.equal(defaultResolved.spectrum.heatBase, 'transparent')
})

test('VUMeter needle color tokens parse and fall back to existing VU colors', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2

[VUMeter]
level = 10, 20, 30
peak = 40, 50, 60
needle_left = 70, 80, 90
needle_right = 100, 110, 120
needle_combined = 130, 140, 150
`, 'Needles')
  const fallback = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2

[VUMeter]
level = 10, 20, 30
peak = 40, 50, 60
`, 'Needle Fallback')

  assert.equal(parsed.vumeter.needleLeft, 'rgb(70, 80, 90)')
  assert.equal(parsed.vumeter.needleRight, 'rgb(100, 110, 120)')
  assert.equal(parsed.vumeter.needleCombined, 'rgb(130, 140, 150)')

  const resolved = resolveTheme(parsed)
  assert.equal(resolved.vumeter.needleLeft, 'rgb(70, 80, 90)')
  assert.equal(resolved.vumeter.needleRight, 'rgb(100, 110, 120)')
  assert.equal(resolved.vumeter.needleCombined, 'rgb(130, 140, 150)')

  const resolvedFallback = resolveTheme(fallback)
  assert.equal(resolvedFallback.vumeter.needleLeft, 'rgb(10, 20, 30)')
  assert.equal(resolvedFallback.vumeter.needleRight, 'rgb(40, 50, 60)')
  assert.equal(resolvedFallback.vumeter.needleCombined, 'rgb(10, 20, 30)')
})

test('parseThemeFileContent derives the theme name from the filename stem and ignores legacy header names', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2
id = theme_midnight
name = Legacy Midnight

[App]
accent = 79, 155, 255, 255
`, 'Midnight')

  assert.equal(parsed.name, 'Midnight')
  assert.equal(parsed.app.accent, 'rgb(79, 155, 255)')
})

test('resolveTheme maps grouped app, controls, and scopes tokens into UI and scope surfaces', () => {
  const theme = createDefaultTheme()
  theme.app.accent = 'rgb(255, 159, 67)'
  theme.app.background = 'rgb(5, 6, 7)'
  theme.app.surface = 'rgb(8, 9, 10)'
  theme.app.surfaceAlt = 'rgb(11, 12, 13)'
  theme.app.text = 'rgb(240, 244, 248)'
  theme.app.textMuted = 'rgba(220, 224, 228, 0.4)'
  theme.controls.text = 'rgb(225, 229, 233)'
  theme.controls.menuSurface = 'rgb(14, 15, 16)'
  theme.controls.menuBorder = 'rgb(17, 18, 19)'
  theme.controls.inputSurface = 'rgb(20, 21, 22)'
  theme.controls.inputBorder = 'rgb(23, 24, 25)'
  theme.controls.slider = 'rgb(26, 27, 28)'
  theme.scopes.background = 'rgb(29, 30, 31)'
  theme.scopes.guides = 'rgba(100, 110, 120, 0.2)'
  theme.scopes.overlaySurface = 'rgb(32, 33, 34)'
  theme.scopes.overlayText = 'rgb(235, 236, 237)'
  theme.scopes.overlayBorder = 'rgb(35, 36, 37)'
  theme.scopes.resizeHandle = 'rgb(38, 39, 40)'
  theme.vumeter.track = 'rgb(41, 42, 43)'
  theme.lufsmeter.track = 'rgb(44, 45, 46)'
  theme.nowPlaying = {}

  const resolved = resolveTheme(theme)
  assert.equal(resolved.interface.accent, 'rgb(255, 159, 67)')
  assert.equal(resolved.interface.menuBg, 'rgb(14, 15, 16)')
  assert.equal(resolved.interface.menuBorder, 'rgb(17, 18, 19)')
  assert.equal(resolved.interface.inputBg, 'rgb(20, 21, 22)')
  assert.equal(resolved.interface.inputBorder, 'rgb(23, 24, 25)')
  assert.equal(resolved.interface.controlText, 'rgb(225, 229, 233)')
  assert.equal(resolved.interface.optionBg, 'rgb(14, 15, 16)')
  assert.equal(resolved.interface.optionText, 'rgb(225, 229, 233)')
  assert.equal(resolved.interface.sliderFill, 'rgb(26, 27, 28)')
  assert.equal(resolved.interface.scopeBackground, 'rgb(29, 30, 31)')
  assert.equal(resolved.interface.scopeGuides, 'rgba(100, 110, 120, 0.2)')
  assert.equal(resolved.interface.scopeOverlayBg, 'rgb(32, 33, 34)')
  assert.equal(resolved.interface.scopeOverlayText, 'rgb(235, 236, 237)')
  assert.equal(resolved.interface.scopeOverlayBorder, 'rgb(35, 36, 37)')
  assert.equal(resolved.interface.scopeResizeHandle, 'rgb(38, 39, 40)')
  assert.equal(resolved.spectrogram.background, 'rgb(29, 30, 31)')
  assert.equal(resolved.waveform.guides, 'rgba(100, 110, 120, 0.2)')
  assert.equal(resolved.vumeter.track, 'rgb(41, 42, 43)')
  assert.equal(resolved.lufsmeter.track, 'rgb(44, 45, 46)')
  assert.equal(resolved.nowPlaying.accent, 'rgb(255, 159, 67)')
  assert.equal(resolved.nowPlaying.background, 'rgb(29, 30, 31)')
  assert.equal(resolved.nowPlaying.text, 'rgb(240, 244, 248)')
})

test('themeToCssVariables exposes grouped UI, control, and scope variables', () => {
  const theme = createDefaultTheme()
  theme.controls.menuSurface = 'rgb(11, 12, 13)'
  theme.controls.text = 'rgb(220, 221, 222)'
  theme.scopes.overlaySurface = 'rgb(14, 15, 16)'
  theme.scopes.overlayText = 'rgb(223, 224, 225)'
  theme.scopes.overlayBorder = 'rgb(17, 18, 19)'
  theme.scopes.resizeHandle = 'rgb(20, 21, 22)'

  const variables = themeToCssVariables(resolveTheme(theme))
  assert.equal(variables['--menu-bg'], 'rgb(11, 12, 13)')
  assert.equal(variables['--option-bg'], 'rgb(11, 12, 13)')
  assert.equal(variables['--option-text'], 'rgb(220, 221, 222)')
  assert.equal(variables['--slider-fill'], resolveTheme(theme).interface.sliderFill)
  assert.equal(variables['--scope-overlay-bg'], 'rgb(14, 15, 16)')
  assert.equal(variables['--scope-overlay-text'], 'rgb(223, 224, 225)')
  assert.equal(variables['--scope-overlay-border'], 'rgb(17, 18, 19)')
  assert.equal(variables['--scope-resize-handle'], 'rgb(20, 21, 22)')
})

test('createTemplateThemeFile presents a simplified recommended theme layout', () => {
  const template = createTemplateThemeFile()
  const parsed = parseThemeFileContent(template, 'Template Theme')

  assert.match(template, /# Start with \[App\]\./)
  assert.match(template, /# Everything else below is optional and starts commented out\./)
  assert.match(template, /# Uncomment the tokens you want to customize and leave the rest commented to inherit defaults\./)
  assert.match(template, /# \[Controls\] and \[Scopes\] are shared override groups\./)
  assert.match(template, /# Module sections show the full set of supported tokens for each module\./)
  assert.match(template, /# Spectrum and Spectrogram heat token alpha is honored directly\./)
  assert.match(template, /# Leave Spectrum heat_base commented unless you want an explicit underlay beneath the heatmap\./)
  assert.match(template, /# Comment out any optional token to let Prism inherit or derive it\./)
  assert.match(template, /# Leave an entire optional section commented if that area should use Prism's defaults\./)
  assert.match(template, /# Optional palette extras:/)
  assert.match(template, /# Optional shell overrides:/)
  assert.match(template, /^\[Controls\]$/m)
  assert.match(template, /^\[Scopes\]$/m)
  assert.match(template, /^\[Spectrum\]$/m)
  assert.match(template, /^# phase_risk = 255, 191, 0$/m)
  assert.match(template, /^# flat_controls = false$/m)
  assert.match(template, /^# toolbar_bg = 4, 8, 12, 199$/m)
  assert.equal(parsed.app.accent, 'rgb(56, 189, 248)')
  assert.equal(parsed.app.textMuted, undefined)
  assert.equal(parsed.controls.flatControls, undefined)
  assert.equal(parsed.spectrum.line, undefined)
  assert.equal(parsed.nowPlaying.background, undefined)
})

test('parsed template keeps module colors and backgrounds derived from starter app tokens', () => {
  const parsed = parseThemeFileContent(createTemplateThemeFile(), 'Template Theme')
  parsed.app.accent = 'rgb(74, 222, 128)'
  parsed.app.background = 'rgb(3, 7, 18)'

  const resolved = resolveTheme(parsed)

  assert.equal(resolved.spectrum.line, 'rgb(74, 222, 128)')
  assert.equal(resolved.oscilloscope.line, 'rgb(74, 222, 128)')
  assert.equal(resolved.vectorscope.trace, 'rgb(74, 222, 128)')
  assert.equal(resolved.vectorscope.phaseRisk, resolved.interface.warning)
  assert.equal(resolved.waveform.line, 'rgb(74, 222, 128)')
  assert.equal(resolved.interface.scopeBackground, 'rgb(3, 7, 18)')
  assert.equal(resolved.spectrum.background, 'rgb(3, 7, 18)')
  assert.equal(resolved.nowPlaying.background, 'rgb(3, 7, 18)')
})

test('resolveTheme exposes now playing button tokens and derived button states', () => {
  const theme = createDefaultTheme()
  theme.nowPlaying.accent = 'rgb(100, 150, 200)'
  theme.nowPlaying.text = 'rgb(240, 241, 242)'
  theme.nowPlaying.buttonSurface = 'rgba(20, 30, 40, 0.9)'
  theme.nowPlaying.buttonBorder = 'rgb(50, 60, 70)'

  const resolved = resolveTheme(theme)

  assert.equal(resolved.nowPlaying.buttonBg, 'rgba(20, 30, 40, 0.902)')
  assert.equal(resolved.nowPlaying.buttonBgHover, 'rgba(31, 47, 62, 0.94)')
  assert.equal(resolved.nowPlaying.buttonBgActive, 'rgba(100, 150, 200, 0.16)')
  assert.equal(resolved.nowPlaying.buttonBorder, 'rgb(50, 60, 70)')
  assert.equal(resolved.nowPlaying.buttonText, 'rgb(240, 241, 242)')
})

test('Astra renderer consumes Astra-specific button theme vars', async () => {
  const componentSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'AstraScopeModule.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')

  assert.match(componentSource, /'--astra-button-bg': theme\.buttonBg/)
  assert.match(componentSource, /'--astra-button-bg-hover': theme\.buttonBgHover/)
  assert.match(componentSource, /'--astra-button-bg-active': theme\.buttonBgActive/)
  assert.match(componentSource, /'--astra-button-border': theme\.buttonBorder/)
  assert.match(componentSource, /'--astra-button-text': theme\.buttonText/)
  assert.match(stylesSource, /\.astra-scope__control \{[\s\S]*background: var\(--astra-button-bg\);/)
  assert.match(stylesSource, /\.astra-scope__control \{[\s\S]*border: 1px solid var\(--astra-button-border\);/)
  assert.match(stylesSource, /\.astra-scope__control \{[\s\S]*color: var\(--astra-button-text\);/)
  assert.match(stylesSource, /\.astra-scope__control:hover:not\(:disabled\),[\s\S]*background: var\(--astra-button-bg-hover\);/)
  assert.match(stylesSource, /\.astra-scope__control:active:not\(:disabled\) \{[\s\S]*background: var\(--astra-button-bg-active\);/)
})

test('bundled tester themes preserve authored tokens and migrated accent themes recolor every accent-driven scope', () => {
  const bundledThemes = createBundledThemes()
  assert.deepEqual(bundledThemes.map((theme) => theme.name), [
    DEFAULT_THEME_NAME,
    'Alpha Centauri',
    'Chroma Blue',
    'Chroma Green',
    'Redshift',
    'Stanky Leg',
  ])

  const defaultTheme = bundledThemes.find((theme) => theme.name === DEFAULT_THEME_NAME)
  assert.ok(defaultTheme)
  assert.equal(defaultTheme.vumeter.needleLeft, 'rgb(199, 223, 255)')
  assert.equal(defaultTheme.vumeter.needleRight, 'rgb(255, 71, 126)')
  assert.equal(defaultTheme.vumeter.needleCombined, 'rgb(244, 248, 255)')

  const alphaCentauri = bundledThemes.find((theme) => theme.name === 'Alpha Centauri')
  assert.ok(alphaCentauri)
  assert.equal(alphaCentauri.credit, 'MxnGxzr')
  assert.equal(alphaCentauri.website, 'https://www.instagram.com/mxngxzr.jpeg/')
  assert.equal(alphaCentauri.description, 'It exists')
  assert.equal(alphaCentauri.app.accent, 'rgb(0, 50, 220)')
  assert.equal(alphaCentauri.spectrogram.background, 'rgba(255, 255, 255, 0)')
  assert.equal(alphaCentauri.vumeter.needleLeft, undefined)

  const chromaGreen = bundledThemes.find((theme) => theme.name === 'Chroma Green')
  assert.ok(chromaGreen)
  assert.equal(chromaGreen.controls.flatControls, 'true')
  assert.equal(chromaGreen.scopes.background, 'rgb(0, 255, 0)')

  const redshift = bundledThemes.find((theme) => theme.name === 'Redshift')
  assert.ok(redshift)
  assert.equal(redshift.oscilloscope.line, redshift.app.accent)
  assert.equal(redshift.vectorscope.trace, redshift.app.accent)

  const migrated = createMigratedAccentTheme('#4ade80')
  assert.ok(migrated)
  assert.equal(migrated.oscilloscope.line, migrated.app.accent)
  assert.equal(migrated.vectorscope.trace, migrated.app.accent)
  assert.equal(migrated.vumeter.needleLeft, migrated.app.accent)
  assert.equal(migrated.vumeter.needleCombined, migrated.app.accent)
})

test('library seeds default themes and template file', async () => {
  const harness = await createHarness()

  try {
    const snapshot = await harness.library.getSnapshot()
    assert.ok(snapshot.themes[DEFAULT_THEME_NAME])
    assert.equal(snapshot.activeThemeId, DEFAULT_THEME_NAME)

    const fileNames = (await readdir(harness.themesDir)).sort()
    assert.deepEqual(fileNames, BUNDLED_THEME_FILE_NAMES)
    for (const fileName of OLD_GENERATED_THEME_FILE_NAMES) {
      assert.equal(fileNames.includes(fileName), false)
    }

    const defaultThemeContent = await readFile(join(harness.themesDir, 'Default.iro'), 'utf8')
    const templateContent = await readFile(join(harness.themesDir, '_TEMPLATE.iro'), 'utf8')
    assert.match(defaultThemeContent, /version = 2/)
    assert.match(defaultThemeContent, /\[App\]/)
    assert.doesNotMatch(defaultThemeContent, /\[All\]/)
    assert.match(templateContent, /\[App\]/)
    assert.match(templateContent, /^\[Controls\]$/m)
    assert.match(templateContent, /^\[Scopes\]$/m)
    assert.match(templateContent, /^# flat_controls = false$/m)
  } finally {
    await harness.cleanup()
  }
})

test('re-importing the same filename stem replaces the managed theme', async () => {
  const harness = await createHarness()

  try {
    const theme = createDefaultTheme()
    theme.name = 'Shared'
    const externalPath = join(harness.rootDir, 'Shared.iro')
    await writeFile(externalPath, serializeThemeFile(theme), 'utf8')

    const firstSnapshot = await harness.library.importThemeFromPath(externalPath)
    assert.equal(firstSnapshot.activeThemeId, 'Shared')

    theme.app.accent = 'rgb(74, 222, 128)'
    await writeFile(externalPath, serializeThemeFile(theme), 'utf8')

    const secondSnapshot = await harness.library.importThemeFromPath(externalPath)
    assert.equal(secondSnapshot.activeThemeId, 'Shared')
    assert.equal(secondSnapshot.themes.Shared.name, 'Shared')
    assert.equal(secondSnapshot.themes.Shared.app.accent, 'rgb(74, 222, 128)')
  } finally {
    await harness.cleanup()
  }
})

test('library refreshes shipped bundled themes when their definitions change', async () => {
  const harness = await createHarness()

  try {
    await harness.library.getSnapshot()

    const staleRedshift = createDefaultTheme()
    staleRedshift.name = 'Redshift'
    staleRedshift.credit = 'Stale'
    staleRedshift.app.accent = 'rgb(1, 2, 3)'
    staleRedshift.oscilloscope.line = 'rgb(4, 5, 6)'
    staleRedshift.vectorscope.trace = 'rgb(7, 8, 9)'

    await writeFile(join(harness.themesDir, 'Redshift.iro'), serializeThemeFile(staleRedshift), 'utf8')

    const snapshot = await harness.library.reloadThemes()
    assert.equal(snapshot.themes.Redshift.credit, 'Boof2015')
    assert.equal(snapshot.themes.Redshift.oscilloscope.line, snapshot.themes.Redshift.app.accent)
    assert.equal(snapshot.themes.Redshift.vectorscope.trace, snapshot.themes.Redshift.app.accent)
  } finally {
    await harness.cleanup()
  }
})

test('library refreshes the managed template when its generated layout changes', async () => {
  const harness = await createHarness()

  try {
    await harness.library.getSnapshot()

    await writeFile(join(harness.themesDir, '_TEMPLATE.iro'), '# stale template\n', 'utf8')

    await harness.library.reloadThemes()

    const templateContent = await readFile(join(harness.themesDir, '_TEMPLATE.iro'), 'utf8')
    assert.match(templateContent, /# Start with \[App\]\./)
    assert.match(templateContent, /^\[Controls\]$/m)
    assert.match(templateContent, /^\[Spectrum\]$/m)
    assert.match(templateContent, /^# flat_controls = false$/m)
  } finally {
    await harness.cleanup()
  }
})

test('legacy migration can create an accent theme and make it active', async () => {
  const harness = await createHarness()

  try {
    const migration = await harness.library.migrateLegacyTheme({
      presetId: 'default',
      customAccent: '#4ade80',
    })

    assert.equal(migration.didMigrate, true)
    assert.equal(migration.snapshot.activeThemeId, 'Migrated Accent')
    assert.ok(migration.snapshot.themes['Migrated Accent'])

    const localState = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      activeThemeId: string | null
      migrationVersion: number
    }
    assert.equal(localState.activeThemeId, 'Migrated Accent')
    assert.equal(localState.migrationVersion, 1)
  } finally {
    await harness.cleanup()
  }
})

test('library falls back when legacy active theme ids target retired bundled themes', async () => {
  const harness = await createHarness()

  try {
    await mkdir(dirname(harness.localStatePath), { recursive: true })
    await writeFile(harness.localStatePath, JSON.stringify({
      format: 'prism-theme-local',
      version: 1,
      migrationVersion: 0,
      activeThemeId: 'theme_midnight',
    }, null, 2))

    const snapshot = await harness.library.getSnapshot()
    assert.equal(snapshot.activeThemeId, DEFAULT_THEME_NAME)

    const localState = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      activeThemeId: string | null
    }
    assert.equal(localState.activeThemeId, DEFAULT_THEME_NAME)
  } finally {
    await harness.cleanup()
  }
})

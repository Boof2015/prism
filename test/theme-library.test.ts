import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  DEFAULT_THEME_ID,
  DEFAULT_THEME_NAME,
} from '../src/types/theme'

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
  theme.vumeter.track = '#111827'

  const serialized = serializeThemeFile(theme)
  const parsed = parseThemeFileContent(serialized, DEFAULT_THEME_ID, DEFAULT_THEME_NAME)

  assert.match(serialized, /\[Theme\]/)
  assert.match(serialized, /version = 2/)
  assert.match(serialized, /\[App\]/)
  assert.match(serialized, /\[Controls\]/)
  assert.match(serialized, /\[Scopes\]/)
  assert.match(serialized, /flat_controls = true/)

  assert.equal(parsed.id, DEFAULT_THEME_ID)
  assert.equal(parsed.name, DEFAULT_THEME_NAME)
  assert.equal(parsed.app.accent, 'rgb(74, 222, 128)')
  assert.equal(parsed.controls.menuSurface, 'rgb(12, 18, 32)')
  assert.equal(parsed.controls.flatControls, 'true')
  assert.equal(parsed.scopes.background, 'rgb(3, 7, 18)')
  assert.equal(parsed.spectrum.heatMid, 'rgb(200, 50, 120)')
  assert.equal(parsed.vumeter.track, 'rgb(17, 24, 39)')
  assert.equal(parsed.astra.background, theme.astra.background)
})

test('parseThemeFileContent preserves passthrough controls tokens from .iro files', () => {
  const parsed = parseThemeFileContent(`
[Theme]
format = prism-theme
version = 2
id = theme_flat
name = Flat

[Controls]
flat_controls = true
`, 'theme_flat', 'Flat')

  const resolved = resolveTheme(parsed)

  assert.equal(parsed.controls.flatControls, 'true')
  assert.equal(resolved.interface.glassBg, 'transparent')
  assert.equal(resolved.interface.glassHighlight, 'transparent')
  assert.equal(resolved.interface.glassHighlightStrong, 'transparent')
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
  theme.astra = {}

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
  assert.equal(resolved.astra.accent, 'rgb(255, 159, 67)')
  assert.equal(resolved.astra.background, 'rgb(29, 30, 31)')
  assert.equal(resolved.astra.text, 'rgb(240, 244, 248)')
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
  const parsed = parseThemeFileContent(template, 'theme_template', 'Template Theme')

  assert.match(template, /# Core UI:/)
  assert.match(template, /# Shared scope defaults:/)
  assert.match(template, /# Module overrides:/)
  assert.match(template, /# Optional shell overrides:/)
  assert.match(template, /flat_controls = false/)
  assert.match(template, /# toolbar_bg =/)
  assert.doesNotMatch(template, /\[Spectrum\]\nbackground =/)
  assert.doesNotMatch(template, /\[Oscilloscope\]\nbackground =/)
  assert.doesNotMatch(template, /\[Waveform\]\nbackground =/)
  assert.equal(parsed.controls.flatControls, 'false')
})

test('resolveTheme exposes Astra-specific button tokens and derived button states', () => {
  const theme = createDefaultTheme()
  theme.astra.accent = 'rgb(100, 150, 200)'
  theme.astra.text = 'rgb(240, 241, 242)'
  theme.astra.buttonSurface = 'rgba(20, 30, 40, 0.9)'
  theme.astra.buttonBorder = 'rgb(50, 60, 70)'

  const resolved = resolveTheme(theme)

  assert.equal(resolved.astra.buttonBg, 'rgba(20, 30, 40, 0.902)')
  assert.equal(resolved.astra.buttonBgHover, 'rgba(31, 47, 62, 0.94)')
  assert.equal(resolved.astra.buttonBgActive, 'rgba(100, 150, 200, 0.16)')
  assert.equal(resolved.astra.buttonBorder, 'rgb(50, 60, 70)')
  assert.equal(resolved.astra.buttonText, 'rgb(240, 241, 242)')
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

test('bundled and migrated accent themes recolor every accent-driven scope', () => {
  const purple = createBundledThemes().find((theme) => theme.id === 'theme_purple')
  assert.ok(purple)
  assert.equal(purple.oscilloscope.line, purple.app.accent)
  assert.equal(purple.vectorscope.trace, purple.app.accent)

  const migrated = createMigratedAccentTheme('#4ade80')
  assert.ok(migrated)
  assert.equal(migrated.oscilloscope.line, migrated.app.accent)
  assert.equal(migrated.vectorscope.trace, migrated.app.accent)
})

test('library seeds default themes and template file', async () => {
  const harness = await createHarness()

  try {
    const snapshot = await harness.library.getSnapshot()
    assert.ok(snapshot.themes[DEFAULT_THEME_ID])
    assert.equal(snapshot.activeThemeId, DEFAULT_THEME_ID)

    const fileNames = (await readdir(harness.themesDir)).sort()
    assert.ok(fileNames.includes('Default.iro'))
    assert.ok(fileNames.includes('_TEMPLATE.iro'))

    const defaultThemeContent = await readFile(join(harness.themesDir, 'Default.iro'), 'utf8')
    const templateContent = await readFile(join(harness.themesDir, '_TEMPLATE.iro'), 'utf8')
    assert.match(defaultThemeContent, /version = 2/)
    assert.match(defaultThemeContent, /\[App\]/)
    assert.doesNotMatch(defaultThemeContent, /\[All\]/)
    assert.match(templateContent, /\[Controls\]/)
    assert.match(templateContent, /\[Scopes\]/)
  } finally {
    await harness.cleanup()
  }
})

test('importing the same embedded theme id replaces the managed theme', async () => {
  const harness = await createHarness()

  try {
    const theme = createDefaultTheme()
    theme.id = 'theme_shared'
    theme.name = 'Shared'
    const externalPath = join(harness.rootDir, 'shared.iro')
    await writeFile(externalPath, serializeThemeFile(theme), 'utf8')

    const firstSnapshot = await harness.library.importThemeFromPath(externalPath)
    assert.equal(firstSnapshot.activeThemeId, 'theme_shared')

    theme.name = 'Shared Updated'
    theme.app.accent = 'rgb(74, 222, 128)'
    const updatedPath = join(harness.rootDir, 'shared-updated.iro')
    await writeFile(updatedPath, serializeThemeFile(theme), 'utf8')

    const secondSnapshot = await harness.library.importThemeFromPath(updatedPath)
    assert.equal(secondSnapshot.activeThemeId, 'theme_shared')
    assert.equal(secondSnapshot.themes.theme_shared.name, 'Shared Updated')
    assert.equal(secondSnapshot.themes.theme_shared.app.accent, 'rgb(74, 222, 128)')
  } finally {
    await harness.cleanup()
  }
})

test('library refreshes shipped bundled themes when their definitions change', async () => {
  const harness = await createHarness()

  try {
    await harness.library.getSnapshot()

    const stalePurple = createDefaultTheme()
    stalePurple.id = 'theme_purple'
    stalePurple.name = 'Purple'
    stalePurple.app.accent = 'rgb(167, 139, 250)'
    stalePurple.oscilloscope.line = 'rgb(56, 189, 248)'
    stalePurple.vectorscope.trace = 'rgb(56, 189, 248)'

    await writeFile(join(harness.themesDir, 'Purple.iro'), serializeThemeFile(stalePurple), 'utf8')

    const snapshot = await harness.library.reloadThemes()
    assert.equal(snapshot.themes.theme_purple.oscilloscope.line, snapshot.themes.theme_purple.app.accent)
    assert.equal(snapshot.themes.theme_purple.vectorscope.trace, snapshot.themes.theme_purple.app.accent)
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
    assert.match(templateContent, /# Core UI:/)
    assert.match(templateContent, /flat_controls = false/)
    assert.doesNotMatch(templateContent, /\[Spectrum\]\nbackground =/)
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
    assert.equal(migration.snapshot.activeThemeId, 'theme_migrated_accent')
    assert.ok(migration.snapshot.themes.theme_migrated_accent)

    const localState = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      activeThemeId: string | null
      migrationVersion: number
    }
    assert.equal(localState.activeThemeId, 'theme_migrated_accent')
    assert.equal(localState.migrationVersion, 1)
  } finally {
    await harness.cleanup()
  }
})

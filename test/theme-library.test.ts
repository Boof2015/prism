import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileBackedThemeLibrary } from '../src/main/themeLibrary'
import {
  createDefaultTheme,
  parseThemeFileContent,
  serializeThemeFile,
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
  theme.spectrum.heatMid = 'rgb(200, 50, 120)'

  const serialized = serializeThemeFile(theme)
  const parsed = parseThemeFileContent(serialized, DEFAULT_THEME_ID, DEFAULT_THEME_NAME)

  assert.equal(parsed.id, DEFAULT_THEME_ID)
  assert.equal(parsed.name, DEFAULT_THEME_NAME)
  assert.equal(parsed.spectrum.heatMid, 'rgb(200, 50, 120)')
  assert.equal(parsed.interface.secondary, theme.interface.secondary)
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
    theme.all.primary = 'rgb(74, 222, 128)'
    const updatedPath = join(harness.rootDir, 'shared-updated.iro')
    await writeFile(updatedPath, serializeThemeFile(theme), 'utf8')

    const secondSnapshot = await harness.library.importThemeFromPath(updatedPath)
    assert.equal(secondSnapshot.activeThemeId, 'theme_shared')
    assert.equal(secondSnapshot.themes.theme_shared.name, 'Shared Updated')
    assert.equal(secondSnapshot.themes.theme_shared.all.primary, 'rgb(74, 222, 128)')
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

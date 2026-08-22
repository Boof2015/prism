import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileBackedProfileLibrary } from '../src/main/profileLibrary'
import {
  createDefaultProfile,
  extractLocalProfileMetadata,
  mergeScopeSettings,
  normalizeProfileFile,
  normalizeScopeOrder,
  profileFileToProfile,
  profileToFileData,
} from '../src/shared/profileState'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
  type Profile,
} from '../src/types/profile'

async function createHarness(): Promise<{
  cleanup: () => Promise<void>
  library: FileBackedProfileLibrary
  localStatePath: string
  profilesDir: string
  rootDir: string
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-profile-library-'))
  const profilesDir = join(rootDir, 'Documents', 'Prism Profiles')
  const localStatePath = join(rootDir, 'userData', 'profile-state.json')

  return {
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    library: new FileBackedProfileLibrary(profilesDir, localStatePath),
    localStatePath,
    profilesDir,
    rootDir,
  }
}

function createProfile(name: string): Profile {
  const profile = createDefaultProfile(name)
  profile.scopePopouts.spectrum = {
    poppedOut: true,
    windowBounds: { x: 120, y: 40, width: 420, height: 240 },
  }
  profile.windowBounds = { x: 10, y: 20, width: 840, height: 180 }
  profile.scopeSettings.spectrum.showSideLine = true
  profile.scopeSettings.spectrum.heatmapSmoothing = 0.67
  profile.scopeSettings.spectrum.scaleMode = 'mel'
  profile.scopeSettings.spectrum.frequencyRangeMode = 'audible'
  profile.scopeSettings.vectorscope.zoomDb = 6
  profile.scopeSettings.spectrogram.colorScheme = 'mono'
  profile.scopeSettings.spectrogram.clarityMode = 'focused'
  profile.scopeSettings.spectrogram.scaleMode = 'linear'
  profile.scopeSettings.spectrogram.frequencyRangeMode = 'extended'
  profile.scopeSettings.spectrogram.showGrid = true
  profile.scopeSettings.spectrogram.rotation = 90
  profile.scopeSettings.spectrogram.mirrorHorizontal = true
  profile.analysisSettings.linkedAnalysis = true
  return profile
}

test('profile file serialization excludes geometry and round-trips with local metadata', () => {
  const profile = createProfile('Shared')
  const file = profileToFileData('profile_shared', profile)

  assert.equal(file.format, PROFILE_FILE_FORMAT)
  assert.equal(file.version, PROFILE_FILE_VERSION)
  assert.equal('themeId' in file, false)
  assert.equal(JSON.stringify(file).includes('windowBounds'), false)
  assert.equal(JSON.stringify(file).includes('frameTarget'), false)
  assert.equal(JSON.stringify(file).includes('inputGainDb'), false)
  assert.deepEqual(file.scopePopouts.spectrum, { poppedOut: true })
  assert.equal(file.scopeSettings.spectrum.heatmapSmoothing, 0.67)
  assert.equal(file.scopeSettings.spectrum.scaleMode, 'mel')
  assert.equal(file.scopeSettings.spectrum.frequencyRangeMode, 'audible')
  assert.equal(file.scopeSettings.vectorscope.zoomDb, 6)
  assert.equal(file.scopeSettings.spectrogram.scaleMode, 'linear')
  assert.equal(file.scopeSettings.spectrogram.clarityMode, 'focused')
  assert.equal(file.scopeSettings.spectrogram.frequencyRangeMode, 'extended')
  assert.equal(file.scopeSettings.spectrogram.showGrid, true)
  assert.equal(file.scopeSettings.spectrogram.rotation, 90)
  assert.equal(file.scopeSettings.spectrogram.mirrorHorizontal, true)
  assert.equal('orientation' in file.scopeSettings.spectrogram, false)
  assert.equal(file.scopeOrder.includes('nowPlaying'), false)
  assert.equal(file.hiddenScopes.includes('nowPlaying'), true)
  assert.equal(file.widthWeights.nowPlaying, 1)
  assert.equal(file.analysisSettings.linkedAnalysis, true)

  const restored = profileFileToProfile(file, extractLocalProfileMetadata(profile))
  assert.deepEqual(restored.windowBounds, profile.windowBounds)
  assert.deepEqual(restored.scopePopouts.spectrum.windowBounds, profile.scopePopouts.spectrum.windowBounds)
  assert.equal(restored.scopeSettings.spectrum.showSideLine, true)
  assert.equal(restored.scopeSettings.spectrum.heatmapSmoothing, 0.67)
  assert.equal(restored.scopeSettings.spectrum.scaleMode, 'mel')
  assert.equal(restored.scopeSettings.spectrum.frequencyRangeMode, 'audible')
  assert.equal(restored.scopeSettings.vectorscope.zoomDb, 6)
  assert.equal(restored.scopeSettings.spectrogram.colorScheme, 'mono')
  assert.equal(restored.scopeSettings.spectrogram.clarityMode, 'focused')
  assert.equal(restored.scopeSettings.spectrogram.scaleMode, 'linear')
  assert.equal(restored.scopeSettings.spectrogram.frequencyRangeMode, 'extended')
  assert.equal(restored.scopeSettings.spectrogram.showGrid, true)
  assert.equal(restored.scopeSettings.spectrogram.rotation, 90)
  assert.equal(restored.scopeSettings.spectrogram.mirrorHorizontal, true)
  assert.equal(restored.scopeSettings.nowPlaying.showControls, true)
  assert.equal(restored.analysisSettings.linkedAnalysis, true)
})

test('profile file waveform speed migration preserves legacy scroll feel', () => {
  const base = profileToFileData('profile_speed', createDefaultProfile('Speed'))
  const withWaveformSpeed = (version: number, scrollSpeed: unknown) => normalizeProfileFile({
    ...base,
    version,
    scopeSettings: {
      ...base.scopeSettings,
      waveform: {
        ...base.scopeSettings.waveform,
        scrollSpeed,
      },
    },
  }, 'profile_speed')

  assert.equal(withWaveformSpeed(1, 8).scopeSettings.waveform.scrollSpeed, 4)
  assert.equal(withWaveformSpeed(2, 8).scopeSettings.waveform.scrollSpeed, 4)
  assert.equal(withWaveformSpeed(PROFILE_FILE_VERSION, 4).scopeSettings.waveform.scrollSpeed, 4)
  assert.equal(withWaveformSpeed(1, 'fast').scopeSettings.waveform.scrollSpeed, 1)

  const legacyMissingSpeed = normalizeProfileFile({
    ...base,
    version: 1,
    scopeSettings: {
      ...base.scopeSettings,
      waveform: {
        mode: 'mono',
      },
    },
  }, 'profile_speed')
  assert.equal(legacyMissingSpeed.scopeSettings.waveform.scrollSpeed, 1)
})

test('mergeScopeSettings migrates legacy spectrogram orientation and validates display transforms', () => {
  const vertical = mergeScopeSettings({
    spectrogram: {
      orientation: 'vertical',
    },
  })
  const horizontal = mergeScopeSettings({
    spectrogram: {
      orientation: 'horizontal',
    },
  })
  const explicit = mergeScopeSettings({
    spectrogram: {
      orientation: 'vertical',
      rotation: 270,
      mirrorHorizontal: true,
    },
    spectrum: {
      rotation: 180,
      mirrorHorizontal: true,
    },
  })
  const invalid = mergeScopeSettings({
    spectrogram: { rotation: 45, mirrorHorizontal: 'yes' },
    oscilloscope: { rotation: -90, mirrorHorizontal: 1 },
    waveform: { rotation: '90', mirrorHorizontal: null },
  })
  const missing = mergeScopeSettings({})

  assert.equal(vertical.spectrogram.rotation, 90)
  assert.equal(horizontal.spectrogram.rotation, 0)
  assert.equal(explicit.spectrogram.rotation, 270)
  assert.equal(explicit.spectrogram.mirrorHorizontal, true)
  assert.equal(explicit.spectrum.rotation, 180)
  assert.equal(explicit.spectrum.mirrorHorizontal, true)
  assert.equal(invalid.spectrogram.rotation, 0)
  assert.equal(invalid.spectrogram.mirrorHorizontal, false)
  assert.equal(invalid.oscilloscope.rotation, 0)
  assert.equal(invalid.waveform.rotation, 0)
  assert.equal(missing.spectrogram.rotation, 0)
  assert.equal(missing.spectrogram.mirrorHorizontal, false)
  assert.equal('orientation' in vertical.spectrogram, false)
})

test('mergeScopeSettings defaults missing or invalid VU needle channel settings to stereo', () => {
  const combined = mergeScopeSettings({
    vumeter: {
      mode: 'needle',
      orientation: 'horizontal',
      needleChannels: 'combined',
    },
  })
  const invalid = mergeScopeSettings({
    vumeter: {
      mode: 'needle',
      orientation: 'horizontal',
      needleChannels: 'mid',
    },
  })
  const missing = mergeScopeSettings({})

  assert.equal(combined.vumeter.needleChannels, 'combined')
  assert.equal(invalid.vumeter.needleChannels, 'stereo')
  assert.equal(missing.vumeter.needleChannels, 'stereo')
})

test('mergeScopeSettings normalizes vectorscope zoom without a profile migration', () => {
  assert.equal(mergeScopeSettings({ vectorscope: { zoomDb: 6.49 } }).vectorscope.zoomDb, 6)
  assert.equal(mergeScopeSettings({ vectorscope: { zoomDb: 6.5 } }).vectorscope.zoomDb, 7)
  assert.equal(mergeScopeSettings({ vectorscope: { zoomDb: -99 } }).vectorscope.zoomDb, -12)
  assert.equal(mergeScopeSettings({ vectorscope: { zoomDb: 99 } }).vectorscope.zoomDb, 24)
  assert.equal(mergeScopeSettings({ vectorscope: { zoomDb: 'loud' } }).vectorscope.zoomDb, 0)
  assert.equal(mergeScopeSettings({ vectorscope: {} }).vectorscope.zoomDb, 0)
  assert.equal(mergeScopeSettings({}).vectorscope.zoomDb, 0)
})

test('mergeScopeSettings normalizes frequency scales, ranges, clarity, and supported spectrogram speeds', () => {
  const valid = mergeScopeSettings({
    spectrum: { scaleMode: 'mel', frequencyRangeMode: 'extended' },
    spectrogram: {
      scaleMode: 'linear',
      frequencyRangeMode: 'audible',
      clarityMode: 'focused',
      showGrid: true,
      scrollSpeed: 8,
    },
  })
  const invalid = mergeScopeSettings({
    spectrum: { scaleMode: 'bark', frequencyRangeMode: 'full' },
    spectrogram: {
      scaleMode: 42,
      frequencyRangeMode: 12,
      clarityMode: 'etched',
      showGrid: 'yes',
      scrollSpeed: 99,
    },
  })
  const legacy = mergeScopeSettings({
    spectrogram: { scrollSpeed: 0.5 },
  })
  const missing = mergeScopeSettings({})

  assert.equal(valid.spectrum.scaleMode, 'mel')
  assert.equal(valid.spectrum.frequencyRangeMode, 'extended')
  assert.equal(valid.spectrogram.scaleMode, 'linear')
  assert.equal(valid.spectrogram.frequencyRangeMode, 'audible')
  assert.equal(valid.spectrogram.clarityMode, 'focused')
  assert.equal(valid.spectrogram.showGrid, true)
  assert.equal(valid.spectrogram.scrollSpeed, 8)
  assert.equal(invalid.spectrum.scaleMode, 'log')
  assert.equal(invalid.spectrum.frequencyRangeMode, 'extended')
  assert.equal(invalid.spectrogram.scaleMode, 'log')
  assert.equal(invalid.spectrogram.frequencyRangeMode, 'extended')
  assert.equal(invalid.spectrogram.clarityMode, 'sharper')
  assert.equal(invalid.spectrogram.showGrid, false)
  assert.equal(invalid.spectrogram.scrollSpeed, 8)
  assert.equal(legacy.spectrogram.scrollSpeed, 0.5)
  assert.equal(missing.spectrum.scaleMode, 'log')
  assert.equal(missing.spectrum.frequencyRangeMode, 'extended')
  assert.equal(missing.spectrogram.scaleMode, 'log')
  assert.equal(missing.spectrogram.frequencyRangeMode, 'extended')
  assert.equal(missing.spectrogram.clarityMode, 'sharper')
  assert.equal(missing.spectrogram.showGrid, false)

  const newProfile = createDefaultProfile('New')
  assert.equal(newProfile.scopeSettings.spectrum.frequencyRangeMode, 'extended')
  assert.equal(newProfile.scopeSettings.spectrogram.frequencyRangeMode, 'extended')
  assert.equal(newProfile.scopeSettings.spectrogram.showGrid, true)
})

test('library saves, renames, deletes, and resolves filename collisions', async () => {
  const harness = await createHarness()

  try {
    const firstSnapshot = await harness.library.saveNewProfile('Mix Bus', createProfile('First'))
    const firstId = Object.keys(firstSnapshot.profiles).find((id) => id !== DEFAULT_PROFILE_ID)
    assert.ok(firstId)
    assert.equal(firstSnapshot.activeProfileId, firstId)

    const secondSnapshot = await harness.library.saveNewProfile('Mix Bus', createProfile('Second'))
    const userProfileIds = Object.keys(secondSnapshot.profiles).filter((id) => id !== DEFAULT_PROFILE_ID)
    const secondId = userProfileIds.find((id) => id !== firstId)
    assert.ok(secondId)

    let fileNames = (await readdir(harness.profilesDir)).sort()
    assert.deepEqual(fileNames, ['Default.prsm', 'Mix Bus (2).prsm', 'Mix Bus.prsm'])

    const renamedSnapshot = await harness.library.renameProfile(secondId, 'Vocals')
    assert.equal(renamedSnapshot.profiles[secondId].name, 'Vocals')

    fileNames = (await readdir(harness.profilesDir)).sort()
    assert.deepEqual(fileNames, ['Default.prsm', 'Mix Bus.prsm', 'Vocals.prsm'])

    await assert.rejects(() => harness.library.deleteProfile(DEFAULT_PROFILE_ID))

    const deletedSnapshot = await harness.library.deleteProfile(secondId)
    assert.equal(deletedSnapshot.profiles[secondId], undefined)
    fileNames = (await readdir(harness.profilesDir)).sort()
    assert.deepEqual(fileNames, ['Default.prsm', 'Mix Bus.prsm'])
  } finally {
    await harness.cleanup()
  }
})

test('now playing stays opt-in for profile scope order normalization', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(profile.scopeOrder.includes('nowPlaying'), false)
  assert.equal(normalizeScopeOrder(undefined).includes('nowPlaying'), false)
  assert.equal(normalizeScopeOrder(['spectrum', 'nowPlaying']).includes('nowPlaying'), true)
  assert.equal(normalizeScopeOrder(['spectrum', 'astra']).includes('nowPlaying'), true)
})

test('default profile omits theme metadata from runtime state and saved files', async () => {
  const harness = await createHarness()

  try {
    const snapshot = await harness.library.getSnapshot()
    assert.equal('themeId' in snapshot.profiles[DEFAULT_PROFILE_ID]!, false)

    const defaultFile = JSON.parse(
      await readFile(join(harness.profilesDir, 'Default.prsm'), 'utf8'),
    ) as {
      themeId?: string | null
    }
    assert.equal('themeId' in defaultFile, false)
  } finally {
    await harness.cleanup()
  }
})

test('importing the same embedded id replaces the managed profile instead of duplicating it', async () => {
  const harness = await createHarness()

  try {
    const externalPath = join(harness.rootDir, 'shared.prsm')
    const initialImport = profileToFileData('profile_shared', createDefaultProfile('Shared'))
    await writeFile(externalPath, `${JSON.stringify(initialImport, null, 2)}\n`, 'utf8')

    const firstSnapshot = await harness.library.importProfileFromPath(externalPath)
    assert.equal(firstSnapshot.activeProfileId, 'profile_shared')
    assert.equal(Object.keys(firstSnapshot.profiles).length, 2)

    const updatedImport = {
      ...initialImport,
      name: 'Shared Updated',
      scopeSettings: {
        ...initialImport.scopeSettings,
        spectrogram: {
          ...initialImport.scopeSettings.spectrogram,
          colorScheme: 'mono' as const,
        },
      },
    }
    const updatedExternalPath = join(harness.rootDir, 'shared-updated.prsm')
    await writeFile(updatedExternalPath, `${JSON.stringify(updatedImport, null, 2)}\n`, 'utf8')

    const secondSnapshot = await harness.library.importProfileFromPath(updatedExternalPath)
    assert.equal(secondSnapshot.activeProfileId, 'profile_shared')
    assert.equal(Object.keys(secondSnapshot.profiles).length, 2)
    assert.equal(secondSnapshot.profiles.profile_shared.name, 'Shared Updated')
    assert.equal(secondSnapshot.profiles.profile_shared.scopeSettings.spectrogram.colorScheme, 'mono')

    const fileNames = (await readdir(harness.profilesDir)).sort()
    assert.deepEqual(fileNames, ['Default.prsm', 'Shared Updated.prsm'])
  } finally {
    await harness.cleanup()
  }
})

test('partial files normalize, unsupported versions fail, and import does not change active profile on failure', async () => {
  const harness = await createHarness()

  try {
    const initialSnapshot = await harness.library.saveNewProfile('Current', createProfile('Current'))
    const activeBeforeFailure = initialSnapshot.activeProfileId

    const partialPath = join(harness.rootDir, 'partial.prsm')
    await writeFile(partialPath, `${JSON.stringify({
      format: PROFILE_FILE_FORMAT,
      version: 1,
      id: 'profile_partial',
      name: 'Partial',
      scopeOrder: ['spectrogram'],
      scopeSettings: {
        waveform: {
          mode: 'stereo',
          scrollSpeed: 2,
          gainDb: 6,
          multiband: true,
        },
      },
      scopePopouts: { spectrogram: { poppedOut: true } },
    }, null, 2)}\n`, 'utf8')

    const partialSnapshot = await harness.library.importProfileFromPath(partialPath)
    assert.equal(partialSnapshot.activeProfileId, 'profile_partial')
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.spectrum.showSideLine, false)
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.spectrum.heatmapSmoothing, 0.5)
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.spectrogram.colorScheme, 'heat')
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.lufsmeter.readout, 'shortTerm')
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.waveform.mode, 'stereo')
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.waveform.scrollSpeed, 1)
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.waveform.multiband, true)
    assert.equal(Object.hasOwn(partialSnapshot.profiles.profile_partial.scopeSettings.waveform, 'gainDb'), false)
    assert.equal(partialSnapshot.profiles.profile_partial.scopePopouts.spectrogram.poppedOut, true)
    assert.equal(partialSnapshot.profiles.profile_partial.widthWeights.spectrum, 1)
    assert.equal(partialSnapshot.profiles.profile_partial.analysisSettings.linkedAnalysis, false)

    const badVersionPath = join(harness.rootDir, 'unsupported.prsm')
    await writeFile(badVersionPath, `${JSON.stringify({
      format: PROFILE_FILE_FORMAT,
      version: 99,
      id: 'profile_bad',
      name: 'Unsupported',
    }, null, 2)}\n`, 'utf8')

    await assert.rejects(() => harness.library.importProfileFromPath(badVersionPath))

    const snapshotAfterFailure = await harness.library.getSnapshot()
    assert.equal(snapshotAfterFailure.activeProfileId, 'profile_partial')
    assert.notEqual(snapshotAfterFailure.activeProfileId, activeBeforeFailure)
    assert.equal(snapshotAfterFailure.profiles.profile_bad, undefined)
  } finally {
    await harness.cleanup()
  }
})

test('legacy profile files with themeId import successfully and ignore embedded theme metadata', async () => {
  const harness = await createHarness()

  try {
    const legacyPath = join(harness.rootDir, 'legacy-theme.prsm')
    await writeFile(legacyPath, `${JSON.stringify({
      format: PROFILE_FILE_FORMAT,
      version: 2,
      id: 'profile_legacy_theme',
      name: 'Legacy Theme',
      themeId: 'theme_midnight',
      scopeOrder: ['spectrum', 'oscilloscope'],
      hiddenScopes: ['vectorscope', 'spectrogram', 'vumeter', 'lufsmeter', 'waveform', 'astra'],
      widthWeights: {
        spectrum: 1,
        oscilloscope: 1,
        vectorscope: 1,
        spectrogram: 1,
        vumeter: 0.5,
        lufsmeter: 0.5,
        waveform: 1,
        astra: 1,
      },
      scopeSettings: createDefaultProfile('Legacy Theme').scopeSettings,
      scopePopouts: {
        spectrum: { poppedOut: false },
        oscilloscope: { poppedOut: false },
        vectorscope: { poppedOut: false },
        spectrogram: { poppedOut: false },
        vumeter: { poppedOut: false },
        lufsmeter: { poppedOut: false },
        waveform: { poppedOut: false },
        astra: { poppedOut: false },
      },
    }, null, 2)}\n`, 'utf8')

    const snapshot = await harness.library.importProfileFromPath(legacyPath)
    const importedProfile = snapshot.profiles.profile_legacy_theme

    assert.ok(importedProfile)
    assert.equal(importedProfile.name, 'Legacy Theme')
    assert.equal('themeId' in importedProfile, false)
    assert.equal(importedProfile.hiddenScopes.includes('nowPlaying'), true)
    assert.equal(importedProfile.widthWeights.nowPlaying, 1)
    assert.equal(importedProfile.scopePopouts.nowPlaying.poppedOut, false)
  } finally {
    await harness.cleanup()
  }
})

test('version 3 profiles remain importable and migrate vertical spectrograms to 90 degrees', async () => {
  const harness = await createHarness()

  try {
    const base = profileToFileData('profile_v3', createDefaultProfile('Version 3'))
    const { rotation: _rotation, mirrorHorizontal: _mirrorHorizontal, ...legacySpectrogram } = base.scopeSettings.spectrogram
    const legacyPath = join(harness.rootDir, 'version-3.prsm')
    await writeFile(legacyPath, `${JSON.stringify({
      ...base,
      version: 3,
      scopeSettings: {
        ...base.scopeSettings,
        spectrogram: {
          ...legacySpectrogram,
          orientation: 'vertical',
        },
      },
    }, null, 2)}\n`, 'utf8')

    const snapshot = await harness.library.importProfileFromPath(legacyPath)
    const imported = snapshot.profiles.profile_v3
    assert.ok(imported)
    assert.equal(imported.scopeSettings.spectrogram.rotation, 90)
    assert.equal(imported.scopeSettings.spectrogram.mirrorHorizontal, false)
    assert.equal('orientation' in imported.scopeSettings.spectrogram, false)
  } finally {
    await harness.cleanup()
  }
})

test('version 4 profiles remain importable with linked analysis disabled', async () => {
  const harness = await createHarness()

  try {
    const base = profileToFileData('profile_v4', createDefaultProfile('Version 4'))
    const { analysisSettings: _analysisSettings, ...legacy } = base
    const legacyPath = join(harness.rootDir, 'version-4.prsm')
    await writeFile(legacyPath, `${JSON.stringify({ ...legacy, version: 4 }, null, 2)}\n`, 'utf8')

    const snapshot = await harness.library.importProfileFromPath(legacyPath)
    assert.equal(snapshot.profiles.profile_v4.analysisSettings.linkedAnalysis, false)
  } finally {
    await harness.cleanup()
  }
})

test('legacy migration writes managed files, preserves active profile, and stores local-only geometry', async () => {
  const harness = await createHarness()

  try {
    const legacyProfile = createProfile('Legacy Custom')
    const migration = await harness.library.migrateLegacyProfiles({
      activeProfileId: 'profile_custom',
      profiles: {
        [DEFAULT_PROFILE_ID]: createDefaultProfile(DEFAULT_PROFILE_NAME),
        profile_custom: legacyProfile,
      },
    })

    assert.equal(migration.didMigrate, true)
    assert.equal(migration.snapshot.activeProfileId, 'profile_custom')
    assert.equal(migration.snapshot.profiles.profile_custom.name, 'Legacy Custom')
    assert.deepEqual(migration.snapshot.profiles.profile_custom.windowBounds, legacyProfile.windowBounds)

    const localState = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      activeProfileId: string | null
      migrationVersion: number
      profiles: Record<string, { windowBounds?: unknown }>
    }
    assert.equal(localState.activeProfileId, 'profile_custom')
    assert.equal(localState.migrationVersion, 1)
    assert.deepEqual(localState.profiles.profile_custom.windowBounds, legacyProfile.windowBounds)

    const secondMigration = await harness.library.migrateLegacyProfiles({
      activeProfileId: null,
      profiles: {},
    })
    assert.equal(secondMigration.didMigrate, false)
  } finally {
    await harness.cleanup()
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileBackedProfileLibrary } from '../src/main/profileLibrary'
import {
  createDefaultProfile,
  extractLocalProfileMetadata,
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
  profile.scopeSettings.spectrogram.colorScheme = 'mono'
  return profile
}

test('profile file serialization excludes geometry and round-trips with local metadata', () => {
  const profile = createProfile('Shared')
  const file = profileToFileData('profile_shared', profile)

  assert.equal(file.format, PROFILE_FILE_FORMAT)
  assert.equal(file.version, PROFILE_FILE_VERSION)
  assert.equal(JSON.stringify(file).includes('windowBounds'), false)
  assert.deepEqual(file.scopePopouts.spectrum, { poppedOut: true })

  const restored = profileFileToProfile(file, extractLocalProfileMetadata(profile))
  assert.deepEqual(restored.windowBounds, profile.windowBounds)
  assert.deepEqual(restored.scopePopouts.spectrum.windowBounds, profile.scopePopouts.spectrum.windowBounds)
  assert.equal(restored.scopeSettings.spectrogram.colorScheme, 'mono')
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
      version: PROFILE_FILE_VERSION,
      id: 'profile_partial',
      name: 'Partial',
      scopeOrder: ['spectrogram'],
      scopePopouts: { spectrogram: { poppedOut: true } },
    }, null, 2)}\n`, 'utf8')

    const partialSnapshot = await harness.library.importProfileFromPath(partialPath)
    assert.equal(partialSnapshot.activeProfileId, 'profile_partial')
    assert.equal(partialSnapshot.profiles.profile_partial.scopeSettings.spectrogram.colorScheme, 'heat')
    assert.equal(partialSnapshot.profiles.profile_partial.scopePopouts.spectrogram.poppedOut, true)
    assert.equal(partialSnapshot.profiles.profile_partial.widthWeights.spectrum, 1)

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

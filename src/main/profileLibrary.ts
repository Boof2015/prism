import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  LEGACY_PROFILE_MIGRATION_VERSION,
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
  type LegacyProfileMigrationPayload,
  type Profile,
  type PrismProfileFile,
  type ProfileLibrarySnapshot,
  type PrismProfileLocalStateV1,
} from '../types/profile'
import type { ScopeKind } from '../types/scope'
import type { WindowBounds } from '../types/popout'
import {
  createDefaultProfile,
  createEmptyProfileLocalState,
  extractLocalProfileMetadata,
  normalizeProfile,
  normalizeProfileFile,
  normalizeProfileLocalState,
  normalizeProfileName,
  normalizeWindowBounds,
  profileFileToProfile,
  profileToFileData,
} from '../shared/profileState'

const PROFILE_EXTENSION = '.prsm'

interface ManagedProfileEntry {
  id: string
  path: string
  profile: Profile
}

export interface LegacyMigrationResult {
  didMigrate: boolean
  snapshot: ProfileLibrarySnapshot
}

export class FileBackedProfileLibrary {
  constructor(
    private readonly profilesDir: string,
    private readonly localStatePath: string,
  ) {}

  getProfilesDirectory(): string {
    return this.profilesDir
  }

  async getSnapshot(): Promise<ProfileLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    return this.buildSnapshot(entries, localState)
  }

  async saveNewProfile(name: string, profile: Profile): Promise<ProfileLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    const id = this.generateProfileId(entries)
    const normalized = normalizeProfile({ ...profile, name }, normalizeProfileName(name, 'Profile'))
    await this.writeManagedProfile(entries, id, normalized)
    localState.profiles[id] = extractLocalProfileMetadata(normalized)
    localState.activeProfileId = id
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async overwriteProfile(id: string, profile: Profile): Promise<ProfileLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    const entry = this.findEntry(entries, id)
    const normalized = normalizeProfile({ ...profile, name: entry.profile.name }, entry.profile.name)
    await this.writeManagedProfile(entries, id, normalized, entry.path)
    localState.profiles[id] = extractLocalProfileMetadata(normalized)
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async loadProfile(id: string): Promise<ProfileLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    this.findEntry(entries, id)
    localState.activeProfileId = id
    await this.writeLocalState(localState)
    return this.buildSnapshot(entries, localState)
  }

  async deleteProfile(id: string): Promise<ProfileLibrarySnapshot> {
    if (id === DEFAULT_PROFILE_ID) {
      throw new Error('The default profile cannot be deleted.')
    }

    const { entries, localState } = await this.loadLibrary()
    const entry = this.findEntry(entries, id)
    await unlink(entry.path)
    delete localState.profiles[id]
    if (localState.activeProfileId === id) {
      localState.activeProfileId = null
    }
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async renameProfile(id: string, name: string): Promise<ProfileLibrarySnapshot> {
    if (id === DEFAULT_PROFILE_ID) {
      throw new Error('The default profile cannot be renamed.')
    }

    const { entries, localState } = await this.loadLibrary()
    const entry = this.findEntry(entries, id)
    const normalized = normalizeProfile({ ...entry.profile, name }, normalizeProfileName(name, entry.profile.name))
    await this.writeManagedProfile(entries, id, normalized, entry.path)
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async importProfileFromPath(sourcePath: string): Promise<ProfileLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    const resolvedSourcePath = resolve(sourcePath)
    const file = await this.readProfileFile(resolvedSourcePath)
    const normalizedProfile = profileFileToProfile(file)
    const existingEntry = entries.find((entry) => entry.id === file.id) ?? null
    const insideManagedDirectory = this.isPathInsideDirectory(resolvedSourcePath, this.profilesDir)
    const currentPath = existingEntry?.path ?? (insideManagedDirectory ? resolvedSourcePath : undefined)
    const targetPath = await this.writeManagedProfile(entries, file.id, normalizedProfile, currentPath)

    if (insideManagedDirectory && resolvedSourcePath !== targetPath) {
      await this.unlinkIfExists(resolvedSourcePath)
    }

    if (!localState.profiles[file.id]) {
      localState.profiles[file.id] = {}
    }
    localState.activeProfileId = file.id
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async migrateLegacyProfiles(payload: LegacyProfileMigrationPayload): Promise<LegacyMigrationResult> {
    const { entries, localState } = await this.loadLibrary()
    if (localState.migrationVersion >= LEGACY_PROFILE_MIGRATION_VERSION) {
      return {
        didMigrate: false,
        snapshot: this.buildSnapshot(entries, localState),
      }
    }

    let didMigrate = false
    const hasManagedUserProfiles = entries.some((entry) => entry.id !== DEFAULT_PROFILE_ID)
    const normalizedPayload = this.normalizeLegacyPayload(payload)
    const legacyEntries = Object.entries(normalizedPayload.profiles)

    if (!hasManagedUserProfiles && legacyEntries.length > 0) {
      const nextEntries = [...entries]
      for (const [id, profile] of legacyEntries) {
        const existingEntry = nextEntries.find((entry) => entry.id === id)
        const normalizedProfile = normalizeProfile(profile, profile.name)
        const writtenPath = await this.writeManagedProfile(
          nextEntries,
          id,
          normalizedProfile,
          existingEntry?.path,
        )

        const nextEntryIndex = nextEntries.findIndex((entry) => entry.id === id)
        const nextEntry: ManagedProfileEntry = {
          id,
          path: writtenPath,
          profile: normalizedProfile,
        }

        if (nextEntryIndex === -1) {
          nextEntries.push(nextEntry)
        } else {
          nextEntries[nextEntryIndex] = nextEntry
        }

        localState.profiles[id] = extractLocalProfileMetadata(normalizedProfile)
      }

      if (
        normalizedPayload.activeProfileId
        && nextEntries.some((entry) => entry.id === normalizedPayload.activeProfileId)
      ) {
        localState.activeProfileId = normalizedPayload.activeProfileId
      }

      didMigrate = true
    }

    localState.migrationVersion = LEGACY_PROFILE_MIGRATION_VERSION
    await this.writeLocalState(localState)

    return {
      didMigrate,
      snapshot: await this.getSnapshot(),
    }
  }

  async updateActiveProfileWindowBounds(bounds: WindowBounds): Promise<void> {
    const { entries, localState } = await this.loadLibrary()
    const activeProfileId = localState.activeProfileId
    if (!activeProfileId || !entries.some((entry) => entry.id === activeProfileId)) return

    const normalizedBounds = normalizeWindowBounds(bounds)
    if (!normalizedBounds) return

    const metadata = localState.profiles[activeProfileId] ?? {}
    localState.profiles[activeProfileId] = {
      ...metadata,
      windowBounds: normalizedBounds,
    }
    await this.writeLocalState(localState)
  }

  async updateActiveProfilePopoutBounds(kind: ScopeKind, bounds?: WindowBounds): Promise<void> {
    const { entries, localState } = await this.loadLibrary()
    const activeProfileId = localState.activeProfileId
    if (!activeProfileId || !entries.some((entry) => entry.id === activeProfileId)) return

    const metadata = localState.profiles[activeProfileId] ?? {}
    const nextBounds = { ...(metadata.scopePopoutBounds ?? {}) }
    const normalizedBounds = normalizeWindowBounds(bounds)

    if (normalizedBounds) {
      nextBounds[kind] = normalizedBounds
    } else {
      delete nextBounds[kind]
    }

    localState.profiles[activeProfileId] = {
      ...metadata,
      scopePopoutBounds: Object.keys(nextBounds).length > 0 ? nextBounds : undefined,
    }
    await this.writeLocalState(localState)
  }

  private normalizeLegacyPayload(payload: LegacyProfileMigrationPayload): LegacyProfileMigrationPayload {
    if (typeof payload !== 'object' || payload === null) {
      return { profiles: {}, activeProfileId: null }
    }

    const rawProfiles = typeof payload.profiles === 'object' && payload.profiles !== null
      ? payload.profiles
      : {}

    const profiles = Object.entries(rawProfiles).reduce((acc, [id, profile]) => {
      if (!id.trim()) return acc
      acc[id] = normalizeProfile(
        profile,
        id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_NAME : 'Profile',
      )
      return acc
    }, {} as Record<string, Profile>)

    return {
      profiles,
      activeProfileId: typeof payload.activeProfileId === 'string'
        ? payload.activeProfileId
        : null,
    }
  }

  private async loadLibrary(): Promise<{
    entries: ManagedProfileEntry[]
    localState: PrismProfileLocalStateV1
  }> {
    await mkdir(this.profilesDir, { recursive: true })
    let localState = await this.readLocalState()
    let entries = await this.readManagedEntries(localState)

    if (!entries.some((entry) => entry.id === DEFAULT_PROFILE_ID)) {
      const defaultProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
      const defaultPath = await this.writeManagedProfile(entries, DEFAULT_PROFILE_ID, defaultProfile)
      entries = await this.readManagedEntries({
        ...localState,
        profiles: {
          ...localState.profiles,
          [DEFAULT_PROFILE_ID]: extractLocalProfileMetadata(defaultProfile),
        },
      })
      localState.profiles[DEFAULT_PROFILE_ID] = extractLocalProfileMetadata(defaultProfile)
      if (!entries.some((entry) => entry.path === defaultPath)) {
        entries.push({
          id: DEFAULT_PROFILE_ID,
          path: defaultPath,
          profile: defaultProfile,
        })
      }
      await this.writeLocalState(localState)
    }

    if (localState.activeProfileId && !entries.some((entry) => entry.id === localState.activeProfileId)) {
      localState = { ...localState, activeProfileId: null }
      await this.writeLocalState(localState)
    }

    return {
      entries: this.sortEntries(entries),
      localState,
    }
  }

  private async readManagedEntries(localState: PrismProfileLocalStateV1): Promise<ManagedProfileEntry[]> {
    const dirEntries = await readdir(this.profilesDir, { withFileTypes: true })
    const profilePaths = dirEntries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === PROFILE_EXTENSION)
      .map((entry) => resolve(join(this.profilesDir, entry.name)))
      .sort((left, right) => left.localeCompare(right))

    const entries: ManagedProfileEntry[] = []
    const seenIds = new Set<string>()

    for (const filePath of profilePaths) {
      try {
        const file = await this.readProfileFile(filePath)
        if (seenIds.has(file.id)) {
          console.warn(`Skipping duplicate profile id "${file.id}" in ${basename(filePath)}.`)
          continue
        }

        seenIds.add(file.id)
        entries.push({
          id: file.id,
          path: filePath,
          profile: profileFileToProfile(file, localState.profiles[file.id]),
        })
      } catch (error) {
        console.warn(`Skipping invalid profile file at ${filePath}:`, error)
      }
    }

    return entries
  }

  private async readProfileFile(filePath: string): Promise<PrismProfileFile> {
    let parsed: unknown

    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    } catch (error) {
      throw new Error(`Could not parse ${basename(filePath)} as JSON.`, { cause: error })
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Profile file ${basename(filePath)} must contain an object.`)
    }

    const candidate = parsed as Partial<PrismProfileFile>
    if (candidate.format !== PROFILE_FILE_FORMAT) {
      throw new Error(`Unsupported profile format in ${basename(filePath)}.`)
    }

    if (
      candidate.version !== 1
      && candidate.version !== 2
      && candidate.version !== 3
      && candidate.version !== 4
      && candidate.version !== 5
      && candidate.version !== PROFILE_FILE_VERSION
    ) {
      throw new Error(`Unsupported profile version in ${basename(filePath)}.`)
    }

    return normalizeProfileFile(
      parsed,
      this.buildFallbackProfileId(filePath),
      basename(filePath, PROFILE_EXTENSION),
    )
  }

  private async readLocalState(): Promise<PrismProfileLocalStateV1> {
    try {
      const raw = await readFile(this.localStatePath, 'utf8')
      return normalizeProfileLocalState(JSON.parse(raw) as unknown)
    } catch {
      return createEmptyProfileLocalState()
    }
  }

  private async writeLocalState(state: PrismProfileLocalStateV1): Promise<void> {
    await mkdir(dirname(this.localStatePath), { recursive: true })
    await this.writeJsonFile(this.localStatePath, state)
  }

  private async writeManagedProfile(
    entries: ManagedProfileEntry[],
    id: string,
    profile: Profile,
    currentPath?: string,
  ): Promise<string> {
    const normalizedProfile = normalizeProfile(profile, profile.name)
    const nextPath = await this.getManagedProfilePath(entries, id, normalizedProfile.name, currentPath)
    const existingPath = currentPath ? resolve(currentPath) : null

    await this.writeJsonFile(nextPath, profileToFileData(id, normalizedProfile))

    if (existingPath && existingPath !== nextPath) {
      await this.unlinkIfExists(existingPath)
    }

    return nextPath
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  private async getManagedProfilePath(
    entries: ManagedProfileEntry[],
    id: string,
    name: string,
    currentPath?: string,
  ): Promise<string> {
    if (id === DEFAULT_PROFILE_ID) {
      const defaultPath = resolve(join(this.profilesDir, `${DEFAULT_PROFILE_NAME}${PROFILE_EXTENSION}`))
      if (!currentPath || resolve(currentPath) === defaultPath) {
        return defaultPath
      }
      const occupiedByOtherEntry = entries.some((entry) => entry.id !== id && entry.path === defaultPath)
      return occupiedByOtherEntry ? resolve(currentPath) : defaultPath
    }

    const preferredCurrentPath = currentPath ? resolve(currentPath) : null
    const occupiedPaths = new Set(
      entries
        .filter((entry) => entry.id !== id)
        .map((entry) => entry.path),
    )
    const baseStem = this.sanitizeFileStem(name)

    let attempt = 0
    while (true) {
      const suffix = attempt === 0 ? '' : ` (${attempt + 1})`
      const candidatePath = resolve(join(this.profilesDir, `${baseStem}${suffix}${PROFILE_EXTENSION}`))
      if (preferredCurrentPath === candidatePath) {
        return candidatePath
      }
      if (occupiedPaths.has(candidatePath)) {
        attempt += 1
        continue
      }
      if (await this.pathExists(candidatePath)) {
        attempt += 1
        continue
      }
      return candidatePath
    }
  }

  private generateProfileId(entries: ManagedProfileEntry[]): string {
    const existingIds = new Set(entries.map((entry) => entry.id))
    let nextId = `profile_${randomUUID().replace(/-/g, '')}`
    while (existingIds.has(nextId)) {
      nextId = `profile_${randomUUID().replace(/-/g, '')}`
    }
    return nextId
  }

  private findEntry(entries: ManagedProfileEntry[], id: string): ManagedProfileEntry {
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) {
      throw new Error(`Profile "${id}" was not found.`)
    }
    return entry
  }

  private buildSnapshot(
    entries: ManagedProfileEntry[],
    localState: PrismProfileLocalStateV1,
  ): ProfileLibrarySnapshot {
    const profiles = this.sortEntries(entries).reduce((acc, entry) => {
      acc[entry.id] = entry.profile
      return acc
    }, {} as Record<string, Profile>)

    return {
      profiles,
      activeProfileId: localState.activeProfileId && profiles[localState.activeProfileId]
        ? localState.activeProfileId
        : null,
    }
  }

  private sortEntries(entries: ManagedProfileEntry[]): ManagedProfileEntry[] {
    return [...entries].sort((left, right) => {
      if (left.id === DEFAULT_PROFILE_ID) return -1
      if (right.id === DEFAULT_PROFILE_ID) return 1
      return left.profile.name.localeCompare(right.profile.name)
    })
  }

  private isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
    const relativePath = relative(resolve(directoryPath), resolve(candidatePath))
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  }

  private sanitizeFileStem(name: string): string {
    const sanitized = normalizeProfileName(name, 'Profile')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return sanitized || 'Profile'
  }

  private buildFallbackProfileId(filePath: string): string {
    const stem = basename(filePath, PROFILE_EXTENSION)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

    return stem ? `profile_${stem}` : `profile_${randomUUID().replace(/-/g, '')}`
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async unlinkIfExists(targetPath: string): Promise<void> {
    try {
      await unlink(targetPath)
    } catch {
      // Ignore missing files.
    }
  }
}

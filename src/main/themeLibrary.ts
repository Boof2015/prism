import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  DEFAULT_THEME_NAME,
  LEGACY_THEME_MIGRATION_VERSION,
  type LegacyThemeMigrationPayload,
  type LegacyThemeMigrationResult,
  type PrismTheme,
  type PrismThemeLocalStateV1,
  type ThemeLibrarySnapshot,
} from '../types/theme'
import {
  createBundledThemes,
  createDefaultTheme,
  createEmptyThemeLocalState,
  createMigratedAccentTheme,
  createTemplateThemeFile,
  extractLegacyThemeFileId,
  getDefaultThemeIdForLocalState,
  normalizeLegacyThemePayload,
  resolveLegacyThemeFileId,
  normalizeTheme,
  normalizeThemeLocalState,
  parseThemeFileContent,
  resolveLegacyThemeToPresetId,
  serializeThemeFile,
} from '../shared/themeState'

const THEME_EXTENSION = '.iro'
const TEMPLATE_THEME_FILE_NAME = '_TEMPLATE.iro'

interface ManagedThemeEntry {
  id: string
  path: string
  theme: PrismTheme
  legacyId: string | null
}

export class FileBackedThemeLibrary {
  constructor(
    private readonly themesDir: string,
    private readonly localStatePath: string,
  ) {}

  getThemesDirectory(): string {
    return this.themesDir
  }

  async getActiveThemeId(): Promise<string | null> {
    const { entries, localState } = await this.loadLibrary()
    return localState.activeThemeId && entries.some((entry) => entry.id === localState.activeThemeId)
      ? localState.activeThemeId
      : (entries[0]?.id ?? null)
  }

  async getSnapshot(): Promise<ThemeLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    return this.buildSnapshot(entries, localState)
  }

  async loadTheme(id: string): Promise<ThemeLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    this.findEntry(entries, id)
    localState.activeThemeId = id
    await this.writeLocalState(localState)
    return this.buildSnapshot(entries, localState)
  }

  async importThemeFromPath(sourcePath: string): Promise<ThemeLibrarySnapshot> {
    const { entries, localState } = await this.loadLibrary()
    const resolvedSourcePath = resolve(sourcePath)
    const { theme } = await this.readThemeFile(resolvedSourcePath)
    const existingEntry = entries.find((entry) => entry.id === theme.name) ?? null
    const insideManagedDirectory = this.isPathInsideDirectory(resolvedSourcePath, this.themesDir)
    const currentPath = existingEntry?.path ?? (insideManagedDirectory ? resolvedSourcePath : undefined)
    const targetPath = await this.writeManagedTheme(entries, theme.name, theme, currentPath)
    const targetKey = basename(targetPath, THEME_EXTENSION)

    if (insideManagedDirectory && resolvedSourcePath !== targetPath) {
      await this.unlinkIfExists(resolvedSourcePath)
    }

    localState.activeThemeId = targetKey
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async renameTheme(id: string, name: string): Promise<ThemeLibrarySnapshot> {
    if (id === DEFAULT_THEME_NAME) {
      throw new Error('The default theme cannot be renamed.')
    }

    const { entries, localState } = await this.loadLibrary()
    const entry = this.findEntry(entries, id)
    const normalized = {
      ...entry.theme,
      name: name.trim() || entry.theme.name,
    }
    const targetPath = await this.writeManagedTheme(entries, id, normalized, entry.path)
    const targetKey = basename(targetPath, THEME_EXTENSION)
    if (localState.activeThemeId === id) {
      localState.activeThemeId = targetKey
      await this.writeLocalState(localState)
    }
    return this.buildSnapshot(await this.readManagedEntries(), localState)
  }

  async deleteTheme(id: string): Promise<ThemeLibrarySnapshot> {
    if (id === DEFAULT_THEME_NAME) {
      throw new Error('The default theme cannot be deleted.')
    }

    const { entries, localState } = await this.loadLibrary()
    const entry = this.findEntry(entries, id)
    await unlink(entry.path)
    if (localState.activeThemeId === id) {
      localState.activeThemeId = DEFAULT_THEME_NAME
    }
    await this.writeLocalState(localState)
    return this.getSnapshot()
  }

  async reloadThemes(): Promise<ThemeLibrarySnapshot> {
    return this.getSnapshot()
  }

  async migrateLegacyTheme(payload: LegacyThemeMigrationPayload): Promise<LegacyThemeMigrationResult> {
    const { entries, localState } = await this.loadLibrary()
    if (localState.migrationVersion >= LEGACY_THEME_MIGRATION_VERSION) {
      return {
        didMigrate: false,
        snapshot: this.buildSnapshot(entries, localState),
      }
    }

    const normalizedPayload = normalizeLegacyThemePayload(payload)
    let nextActiveThemeId = resolveLegacyThemeToPresetId(normalizedPayload)
    let didMigrate = false

    if (normalizedPayload.customAccent) {
      const migratedTheme = createMigratedAccentTheme(normalizedPayload.customAccent)
      if (migratedTheme) {
        await this.writeManagedTheme(entries, migratedTheme.name, migratedTheme)
        nextActiveThemeId = migratedTheme.name
        didMigrate = true
      }
    } else if (nextActiveThemeId) {
      didMigrate = true
    }

    localState.migrationVersion = LEGACY_THEME_MIGRATION_VERSION
    localState.activeThemeId = nextActiveThemeId && (await this.themeExists(nextActiveThemeId))
      ? nextActiveThemeId
      : getDefaultThemeIdForLocalState()
    await this.writeLocalState(localState)

    return {
      didMigrate,
      snapshot: await this.getSnapshot(),
    }
  }

  private async loadLibrary(): Promise<{
    entries: ManagedThemeEntry[]
    localState: PrismThemeLocalStateV1
  }> {
    await mkdir(this.themesDir, { recursive: true })
    let localState = await this.readLocalState()
    let entries = await this.readManagedEntries()

    if (entries.length === 0) {
      for (const theme of createBundledThemes()) {
        await this.writeManagedTheme(entries, theme.name, theme)
      }
      entries = await this.readManagedEntries()
    }

    entries = await this.syncBundledThemes(entries)

    await this.ensureTemplateFile()

    if (localState.activeThemeId && !entries.some((entry) => entry.id === localState.activeThemeId)) {
      const presetName = resolveLegacyThemeFileId(localState.activeThemeId)
      const migratedEntry = entries.find((entry) => entry.legacyId === localState.activeThemeId)
        ?? (presetName ? entries.find((entry) => entry.id === presetName) ?? null : null)
      if (migratedEntry) {
        localState = {
          ...localState,
          activeThemeId: migratedEntry.id,
        }
        await this.writeLocalState(localState)
      }
    }

    if (!localState.activeThemeId || !entries.some((entry) => entry.id === localState.activeThemeId)) {
      localState = {
        ...localState,
        activeThemeId: entries.find((entry) => entry.id === DEFAULT_THEME_NAME)?.id ?? entries[0]?.id ?? null,
      }
      await this.writeLocalState(localState)
    }

    return {
      entries: this.sortEntries(entries),
      localState,
    }
  }

  private async syncBundledThemes(entries: ManagedThemeEntry[]): Promise<ManagedThemeEntry[]> {
    let nextEntries = entries

    for (const theme of createBundledThemes()) {
      const existingEntry = nextEntries.find((entry) => entry.id === theme.name) ?? null
      const shouldWrite = !existingEntry || serializeThemeFile(existingEntry.theme) !== serializeThemeFile(theme)
      if (!shouldWrite) continue

      await this.writeManagedTheme(nextEntries, theme.name, theme, existingEntry?.path)
      nextEntries = await this.readManagedEntries()
    }

    if (!nextEntries.some((entry) => entry.id === DEFAULT_THEME_NAME)) {
      await this.writeManagedTheme(nextEntries, DEFAULT_THEME_NAME, createDefaultTheme())
      nextEntries = await this.readManagedEntries()
    }

    return nextEntries
  }

  private async ensureTemplateFile(): Promise<void> {
    const targetPath = resolve(join(this.themesDir, TEMPLATE_THEME_FILE_NAME))
    const nextContent = createTemplateThemeFile()

    if (await this.pathExists(targetPath)) {
      const currentContent = await readFile(targetPath, 'utf8')
      if (currentContent === nextContent) {
        return
      }
    }

    await writeFile(targetPath, nextContent, 'utf8')
  }

  private async readManagedEntries(): Promise<ManagedThemeEntry[]> {
    const dirEntries = await readdir(this.themesDir, { withFileTypes: true })
    const themePaths = dirEntries
      .filter((entry) => {
        if (!entry.isFile()) return false
        if (entry.name.startsWith('_')) return false
        return extname(entry.name).toLowerCase() === THEME_EXTENSION
      })
      .map((entry) => resolve(join(this.themesDir, entry.name)))
      .sort((left, right) => left.localeCompare(right))

    const entries: ManagedThemeEntry[] = []
    const seenIds = new Set<string>()

    for (const filePath of themePaths) {
      try {
      const { theme, legacyId } = await this.readThemeFile(filePath)
      if (seenIds.has(theme.name)) {
        console.warn(`Skipping duplicate theme key "${theme.name}" in ${basename(filePath)}.`)
        continue
      }
      seenIds.add(theme.name)
      entries.push({
        id: theme.name,
        path: filePath,
        theme,
        legacyId,
      })
      } catch (error) {
        console.warn(`Skipping invalid theme file at ${filePath}:`, error)
      }
    }

    return entries
  }

  private async readThemeFile(filePath: string): Promise<{ theme: PrismTheme; legacyId: string | null }> {
    const content = await readFile(filePath, 'utf8')
    return {
      theme: parseThemeFileContent(content, basename(filePath, THEME_EXTENSION)),
      legacyId: extractLegacyThemeFileId(content),
    }
  }

  private async readLocalState(): Promise<PrismThemeLocalStateV1> {
    try {
      const raw = await readFile(this.localStatePath, 'utf8')
      return normalizeThemeLocalState(JSON.parse(raw) as unknown)
    } catch {
      return createEmptyThemeLocalState()
    }
  }

  private async writeLocalState(state: PrismThemeLocalStateV1): Promise<void> {
    await mkdir(dirname(this.localStatePath), { recursive: true })
    await writeFile(this.localStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  private async writeManagedTheme(
    entries: ManagedThemeEntry[],
    id: string,
    theme: PrismTheme,
    currentPath?: string,
  ): Promise<string> {
    const normalizedTheme = normalizeTheme(theme, theme.name)
    const nextPath = await this.getManagedThemePath(entries, id, normalizedTheme.name, currentPath)
    const existingPath = currentPath ? resolve(currentPath) : null

    await mkdir(dirname(nextPath), { recursive: true })
    await writeFile(nextPath, serializeThemeFile(normalizedTheme), 'utf8')

    if (existingPath && existingPath !== nextPath) {
      await this.unlinkIfExists(existingPath)
    }

    return nextPath
  }

  private async getManagedThemePath(
    entries: ManagedThemeEntry[],
    id: string,
    name: string,
    currentPath?: string,
  ): Promise<string> {
    if (id === DEFAULT_THEME_NAME) {
      const defaultPath = resolve(join(this.themesDir, `${DEFAULT_THEME_NAME}${THEME_EXTENSION}`))
      if (!currentPath || resolve(currentPath) === defaultPath) {
        return defaultPath
      }
      const occupiedByOtherEntry = entries.some((entry) => entry.id !== id && entry.path === defaultPath)
      return occupiedByOtherEntry ? resolve(currentPath) : defaultPath
    }

    const preferredCurrentPath = currentPath ? resolve(currentPath) : null
    const occupiedPaths = new Set(entries.filter((entry) => entry.id !== id).map((entry) => entry.path))
    const baseStem = this.sanitizeFileStem(name)

    let attempt = 0
    while (true) {
      const suffix = attempt === 0 ? '' : ` (${attempt + 1})`
      const candidatePath = resolve(join(this.themesDir, `${baseStem}${suffix}${THEME_EXTENSION}`))
      if (preferredCurrentPath === candidatePath) {
        return candidatePath
      }
      if (occupiedPaths.has(candidatePath) || await this.pathExists(candidatePath)) {
        attempt += 1
        continue
      }
      return candidatePath
    }
  }

  private sortEntries(entries: ManagedThemeEntry[]): ManagedThemeEntry[] {
    return [...entries].sort((left, right) => {
      if (left.id === DEFAULT_THEME_NAME) return -1
      if (right.id === DEFAULT_THEME_NAME) return 1
      return left.theme.name.localeCompare(right.theme.name)
    })
  }

  private buildSnapshot(entries: ManagedThemeEntry[], localState: PrismThemeLocalStateV1): ThemeLibrarySnapshot {
    const themes = this.sortEntries(entries).reduce((acc, entry) => {
      acc[entry.id] = entry.theme
      return acc
    }, {} as Record<string, PrismTheme>)

    return {
      themes,
      activeThemeId: localState.activeThemeId && themes[localState.activeThemeId]
        ? localState.activeThemeId
        : (themes[DEFAULT_THEME_NAME] ? DEFAULT_THEME_NAME : Object.keys(themes)[0] ?? null),
    }
  }

  private findEntry(entries: ManagedThemeEntry[], id: string): ManagedThemeEntry {
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) {
      throw new Error(`Theme "${id}" was not found.`)
    }
    return entry
  }

  private sanitizeFileStem(name: string): string {
    const sanitized = name
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return sanitized || 'Theme'
  }

  private isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
    const relativePath = relative(resolve(directoryPath), resolve(candidatePath))
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  }

  private async themeExists(id: string): Promise<boolean> {
    const entries = await this.readManagedEntries()
    return entries.some((entry) => entry.id === id)
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

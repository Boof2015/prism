import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, session, shell } from 'electron'
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions, OpenDialogOptions, WebContents } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { extname, join, resolve } from 'path'
import type { AppBuildInfo } from '../types/appBuildInfo'
import type { NowPlayingControlCommand, NowPlayingState } from '../types/nowPlaying'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
  WindowBounds,
} from '../types/popout'
import type { ProfileMenuRequest } from '../types/profileMenu'
import type { LegacyProfileMigrationPayload, Profile } from '../types/profile'
import { SCOPE_KINDS, SCOPE_LABELS, type ScopeKind } from '../types/scope'
import type {
  LegacyThemeMigrationPayload,
  ThemeLibrarySnapshot,
} from '../types/theme'
import { RESIZE_DIRECTIONS, type ResizeDirection } from '../types/windowResize'
import type { DialogOptions, DialogResult } from '../types/dialog'
import { normalizeProfile } from '../shared/profileState'
import { resolveNativeThemeSource } from '../shared/themeState'
import { resolveWindowCapabilities } from '../shared/windowCapabilities'
import {
  clampDraggedMainWindowBounds,
  clampRestoredWindowBounds,
  raiseWindowAboveNormalPopouts,
  resolveExpandedMainWindowBounds,
} from '../shared/windowGeometry'
import { calculateResizedWindowBounds } from '../shared/windowResize'
import { FileBackedProfileLibrary } from './profileLibrary'
import { loadNativeWindowsMediaApi } from './nativeWindowsMedia'
import { loadNativeWindowChromeApi } from './nativeWindowChrome'
import { NowPlayingManager } from './services/nowPlayingManager'
import { AstraIntegrationService } from './services/astraIntegration'
import { MacSpotifyProvider } from './services/macSpotifyProvider'
import { SecretVault } from './services/secretVault'
import { checkForUpdates, resolveSafeReleaseUrl } from './services/updates'
import { FileBackedThemeLibrary } from './themeLibrary'
import { normalizeWindowBackgroundState } from '../shared/windowState'
import { FileBackedWindowStateStore } from './windowStateStore'
import type { WindowBackgroundSnapshot, WindowBackgroundState } from '../types/windowState'
import type { NativeWindowsMediaAPI } from '../types/nativeWindowsMedia'
import type { NativeWindowChromeAPI } from '../types/nativeWindowChrome'

let mainWindow: BrowserWindow | null = null
let moveInterval: ReturnType<typeof setInterval> | null = null
let moveStartCursor: { x: number; y: number } | null = null
let moveStartBounds: WindowBounds | null = null
let resizeInterval: ReturnType<typeof setInterval> | null = null
let resizeWindow: BrowserWindow | null = null
let resizeStartCursor: { x: number; y: number } | null = null
let resizeStartBounds: WindowBounds | null = null
let resizeEdge: ResizeDirection | null = null
let mainWindowBoundsTimer: ReturnType<typeof setTimeout> | null = null
let mainRendererReady = false
let allowMainWindowClose = false
let mainWindowClosePending = false
let suppressMainWindowSyncUntil = 0
let mainWindowLogicalBounds: WindowBounds | null = null
let windowRecreationPending = false

const scopePopoutWindows = new Map<ScopeKind, BrowserWindow>()
const scopePopoutCloseAllowed = new Set<ScopeKind>()
const popoutBoundsTimers = new Map<ScopeKind, ReturnType<typeof setTimeout>>()
const suppressNextPopoutBoundsEvents = new Set<ScopeKind>()
let nowPlayingConfigWindow: BrowserWindow | null = null
let nowPlayingConfigBoundsTimer: ReturnType<typeof setTimeout> | null = null
const windowSettingsHeights = new Map<number, number>()
const windowSettingsBottomAnchors = new Map<number, number>()
const pendingProfileOpenPaths: string[] = []

let profileLibrary: FileBackedProfileLibrary | null = null
let themeLibrary: FileBackedThemeLibrary | null = null
let nowPlayingManager: NowPlayingManager | null = null
let windowStateStore: FileBackedWindowStateStore | null = null
let secretVault: SecretVault | null = null
let nativeWindowsMediaApi: NativeWindowsMediaAPI | null | undefined
let nativeWindowChromeApi: NativeWindowChromeAPI | null | undefined

const WINDOW_DEFAULTS = {
  width: 900,
  height: 180,
  minWidth: 400,
  minHeight: 100,
}

const POPOUT_DEFAULTS = {
  width: 360,
  height: 240,
  minWidth: 220,
  minHeight: 160,
}

const NOW_PLAYING_CONFIG_DEFAULTS = {
  width: 620,
  height: 640,
  minWidth: 520,
  minHeight: 520,
}

const STATIC_APP_ICON_FILENAME = 'icon.png'
const MAIN_WINDOW_SYNC_SUPPRESSION_MS = 180
const MAIN_WINDOW_VISIBLE_GRAB_MARGIN = 64
const RESTORED_WINDOW_VISIBLE_MARGIN = 64
const runtimeWindowCapabilities = resolveWindowCapabilities({
  platform: process.platform,
  argv: process.argv,
  env: process.env,
  osVersion: process.getSystemVersion(),
})

interface ResolvedBuildMetadata {
  commitHash: string | null
  isDirty: boolean
}

const DIRTY_ENV_TRUE_VALUES = new Set(['1', 'true', 'yes', 'dirty'])
const DIRTY_ENV_FALSE_VALUES = new Set(['0', 'false', 'no', 'clean'])
let cachedBuildMetadata: ResolvedBuildMetadata | null = null

function normalizeBuildCommitHash(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseDirtyEnvValue(value: unknown): boolean | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (DIRTY_ENV_TRUE_VALUES.has(normalized)) return true
  if (DIRTY_ENV_FALSE_VALUES.has(normalized)) return false
  return null
}

function tryReadBuildMetadataFile(filePath: string): ResolvedBuildMetadata | null {
  try {
    const payload = JSON.parse(readFileSync(filePath, 'utf8')) as { commitHash?: unknown; isDirty?: unknown }
    const commitHash = normalizeBuildCommitHash(payload.commitHash)
    const isDirty = payload.isDirty === true

    if (!commitHash) {
      return {
        commitHash: null,
        isDirty: false,
      }
    }

    return {
      commitHash,
      isDirty,
    }
  } catch {
    return null
  }
}

function tryResolveGitBuildMetadataFromDirectory(directory: string): ResolvedBuildMetadata | null {
  if (!existsSync(join(directory, '.git'))) {
    return null
  }

  try {
    const commitHash = normalizeBuildCommitHash(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }))

    if (!commitHash) {
      return null
    }

    const isDirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0

    return {
      commitHash,
      isDirty,
    }
  } catch {
    return null
  }
}

function resolveBuildMetadata(): ResolvedBuildMetadata {
  if (cachedBuildMetadata) {
    return cachedBuildMetadata
  }

  const envCommitHash = normalizeBuildCommitHash(
    process.env.PRISM_GIT_COMMIT ?? process.env.PRISM_BUILD_COMMIT_HASH,
  )
  const envDirty = parseDirtyEnvValue(
    process.env.PRISM_GIT_DIRTY ?? process.env.PRISM_BUILD_DIRTY,
  )

  if (envCommitHash) {
    cachedBuildMetadata = {
      commitHash: envCommitHash,
      isDirty: envDirty ?? false,
    }
    return cachedBuildMetadata
  }

  const metadataFileCandidates = Array.from(new Set([
    join(__dirname, '..', 'build-metadata.json'),
    join(process.cwd(), 'out', 'build-metadata.json'),
    join(app.getAppPath(), 'out', 'build-metadata.json'),
  ]))

  for (const candidate of metadataFileCandidates) {
    const metadata = tryReadBuildMetadataFile(candidate)
    if (metadata) {
      cachedBuildMetadata = {
        commitHash: metadata.commitHash,
        isDirty: envDirty ?? metadata.isDirty,
      }
      return cachedBuildMetadata
    }
  }

  const gitDirectoryCandidates = Array.from(new Set([
    process.cwd(),
    app.getAppPath(),
    join(__dirname, '../..'),
  ]))

  for (const candidate of gitDirectoryCandidates) {
    const metadata = tryResolveGitBuildMetadataFromDirectory(candidate)
    if (metadata) {
      cachedBuildMetadata = {
        commitHash: metadata.commitHash,
        isDirty: envDirty ?? metadata.isDirty,
      }
      return cachedBuildMetadata
    }
  }

  cachedBuildMetadata = {
    commitHash: null,
    isDirty: false,
  }
  return cachedBuildMetadata
}

function getAppBuildInfo(): AppBuildInfo {
  const buildMetadata = resolveBuildMetadata()
  const commitHash = buildMetadata.commitHash

  return {
    version: app.getVersion(),
    commitHash,
    shortCommitHash: commitHash ? commitHash.slice(0, 7) : null,
    isDirty: commitHash ? buildMetadata.isDirty : false,
  }
}

function getProfileLibrary(): FileBackedProfileLibrary {
  if (!profileLibrary) {
    profileLibrary = new FileBackedProfileLibrary(
      join(app.getPath('documents'), 'Prism Profiles'),
      join(app.getPath('userData'), 'profile-state.json'),
    )
  }

  return profileLibrary
}

function getThemeLibrary(): FileBackedThemeLibrary {
  if (!themeLibrary) {
    themeLibrary = new FileBackedThemeLibrary(
      join(app.getPath('documents'), 'Prism Themes'),
      join(app.getPath('userData'), 'theme-state.json'),
    )
  }

  return themeLibrary
}

function getWindowStateStore(): FileBackedWindowStateStore {
  if (!windowStateStore) {
    windowStateStore = new FileBackedWindowStateStore(
      join(app.getPath('userData'), 'window-state.json'),
    )
  }

  return windowStateStore
}

function getStaticAppIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, STATIC_APP_ICON_FILENAME)]
    : [
        join(process.cwd(), 'resources', STATIC_APP_ICON_FILENAME),
        join(__dirname, '../../resources', STATIC_APP_ICON_FILENAME),
      ]

  return candidates.find((candidate) => existsSync(candidate))
}

function getStaticWindowIconOptions(): Pick<BrowserWindowConstructorOptions, 'icon'> {
  if (process.platform === 'darwin') {
    return {}
  }

  const icon = getStaticAppIconPath()
  return icon ? { icon } : {}
}

function applyStaticDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged) {
    return
  }

  const iconPath = getStaticAppIconPath()
  if (!iconPath) return

  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return
  app.dock?.setIcon(icon)
}

function broadcastNowPlayingState(state: NowPlayingState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send('now-playing:state-changed', state)
  }
}

function getSecretVault(): SecretVault {
  if (!secretVault) {
    secretVault = new SecretVault({
      path: join(app.getPath('userData'), 'secret-vault.json'),
      platform: process.platform,
      safeStorage,
    })
  }

  return secretVault
}

function getNativeWindowsMediaApi(): NativeWindowsMediaAPI | null {
  if (nativeWindowsMediaApi !== undefined) {
    return nativeWindowsMediaApi
  }

  nativeWindowsMediaApi = loadNativeWindowsMediaApi()
  return nativeWindowsMediaApi
}

function getNativeWindowChromeApi(): NativeWindowChromeAPI | null {
  if (nativeWindowChromeApi !== undefined) {
    return nativeWindowChromeApi
  }

  nativeWindowChromeApi = loadNativeWindowChromeApi()
  return nativeWindowChromeApi
}

// Strips the visible native frame/shadow from a frameless WS_THICKFRAME window so
// it looks flat again, while keeping native Aero Snap and edge resize. Windows-only;
// a no-op on macOS/Linux.
function applyFlatFramelessChrome(window: BrowserWindow): void {
  if (process.platform !== 'win32') {
    return
  }

  const api = getNativeWindowChromeApi()
  if (!api) {
    return
  }

  try {
    api.applyFlatFrame(window.getNativeWindowHandle())
  } catch {
    // Frame styling is purely cosmetic; never block window creation on it.
  }
}

// Accent-policy acrylic for blurred windows. The DWM system backdrop
// (backgroundMaterial: 'acrylic') is unusable here: it greys out whenever the
// window loses focus and fights the flat frameless chrome. The accent blur
// stays active unfocused and renders on borderless transparent windows.
function applyAcrylicBlurBehind(window: BrowserWindow): void {
  if (process.platform !== 'win32') {
    return
  }

  const api = getNativeWindowChromeApi()
  if (!api || typeof api.setAcrylicBlurBehind !== 'function') {
    return
  }

  try {
    api.setAcrylicBlurBehind(window.getNativeWindowHandle(), true)
  } catch {
    // Blur is purely cosmetic; the window still works as a clear window.
  }
}

function getNowPlayingManager(): NowPlayingManager {
  if (!nowPlayingManager) {
    nowPlayingManager = new NowPlayingManager({
      localStatePath: join(app.getPath('userData'), 'now-playing-state.json'),
      providerServices: [
        new AstraIntegrationService({
          configPath: join(app.getPath('userData'), 'astra-integration.json'),
          secretVault: getSecretVault(),
        }),
        new MacSpotifyProvider({
          windowsMediaApi: getNativeWindowsMediaApi(),
        }),
      ],
    })
    nowPlayingManager.subscribe((state) => {
      broadcastNowPlayingState(state)
    })
  }

  return nowPlayingManager
}

function queueProfileOpenPath(filePath: string): void {
  if (extname(filePath).toLowerCase() !== '.prsm') return

  const resolvedPath = resolve(filePath)
  if (!pendingProfileOpenPaths.includes(resolvedPath)) {
    pendingProfileOpenPaths.push(resolvedPath)
  }
}

function queueProfileOpenPaths(paths: string[]): void {
  for (const filePath of paths) {
    queueProfileOpenPath(filePath)
  }
}

function extractProfilePathsFromArgv(argv: string[]): string[] {
  return argv
    .filter((value) => extname(value).toLowerCase() === '.prsm')
    .map((value) => resolve(value))
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
  raiseMainWindowAboveNormalPopouts()
}

function normalizeExternalHttpUrl(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null
  }

  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }

  return null
}

async function processPendingProfileOpenPaths(): Promise<void> {
  if (pendingProfileOpenPaths.length === 0) return
  if (!mainRendererReady || !mainWindow || mainWindow.isDestroyed()) return

  const paths = [...pendingProfileOpenPaths]
  pendingProfileOpenPaths.length = 0
  focusMainWindow()

  for (const filePath of paths) {
    mainWindow.webContents.send('profiles:open-requested', filePath)
  }
}

function applyNativeThemeSnapshot(snapshot: ThemeLibrarySnapshot): void {
  const activeTheme = snapshot.activeThemeId
    ? snapshot.themes[snapshot.activeThemeId] ?? null
    : null
  nativeTheme.themeSource = resolveNativeThemeSource(activeTheme)
}

async function syncNativeThemeAppearance(): Promise<void> {
  applyNativeThemeSnapshot(await getThemeLibrary().getSnapshot())
}

function clearPendingMainWindowBoundsSave(): void {
  if (!mainWindowBoundsTimer) return

  clearTimeout(mainWindowBoundsTimer)
  mainWindowBoundsTimer = null
}

function sendMainWindowBoundsChanged(window: BrowserWindow): void {
  if (!isMainRendererWindow(window) || !mainRendererReady || !supportsGeometryPersistence()) return
  if (window.isDestroyed() || window.webContents.isDestroyed()) return

  window.webContents.send('window:bounds-changed', toLogicalBounds(window))
}

function scheduleMainWindowBoundsSave(window: BrowserWindow): void {
  if (!isMainRendererWindow(window) || !mainRendererReady || !supportsGeometryPersistence()) return

  clearPendingMainWindowBoundsSave()

  mainWindowBoundsTimer = setTimeout(() => {
    mainWindowBoundsTimer = null
    if (isMainWindowSyncSuppressed()) {
      return
    }
    sendMainWindowBoundsChanged(window)
  }, 80)
}

function flushMainWindowBoundsChanged(window: BrowserWindow): void {
  clearPendingMainWindowBoundsSave()
  sendMainWindowBoundsChanged(window)
}

function normalizeIncomingProfile(raw: unknown, fallbackName = 'Profile'): Profile {
  return normalizeProfile(raw, fallbackName)
}

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && SCOPE_KINDS.includes(value as ScopeKind)
}

function getWindowFromSender(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
}

function isMainRendererWindow(window: BrowserWindow | null): boolean {
  return window !== null && window === mainWindow
}

function getScopeKindForWindow(window: BrowserWindow | null): ScopeKind | null {
  if (!window) return null

  for (const [kind, popoutWindow] of scopePopoutWindows) {
    if (popoutWindow === window) {
      return kind
    }
  }

  return null
}

function describeWindow(window: BrowserWindow): string {
  if (isMainRendererWindow(window)) {
    return 'main window'
  }

  const kind = getScopeKindForWindow(window)
  return kind ? `${kind} popout` : `window ${window.id}`
}

function getBaseMinHeight(window: BrowserWindow): number {
  return isMainRendererWindow(window) ? WINDOW_DEFAULTS.minHeight : POPOUT_DEFAULTS.minHeight
}

function normalizeMainWindowBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(WINDOW_DEFAULTS.minWidth, Math.round(bounds.width)),
    height: Math.max(WINDOW_DEFAULTS.minHeight, Math.round(bounds.height)),
  }
}

function getDisplayWorkAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => ({
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
  }))
}

function supportsProgrammaticReposition(): boolean {
  return runtimeWindowCapabilities.supportsProgrammaticReposition
}

function supportsGeometryPersistence(): boolean {
  return runtimeWindowCapabilities.supportsGeometryPersistence
}

function suppressMainWindowSync(durationMs = MAIN_WINDOW_SYNC_SUPPRESSION_MS): void {
  suppressMainWindowSyncUntil = Math.max(suppressMainWindowSyncUntil, Date.now() + durationMs)
}

function isMainWindowSyncSuppressed(): boolean {
  return suppressMainWindowSyncUntil > Date.now()
}

function getSettingsHeight(window: BrowserWindow | null): number {
  if (!window) return 0
  return windowSettingsHeights.get(window.id) ?? 0
}

function setSettingsHeightForWindow(window: BrowserWindow, height: number): void {
  const nextHeight = Math.max(0, Math.round(height))
  if (nextHeight === 0) {
    windowSettingsHeights.delete(window.id)
    windowSettingsBottomAnchors.delete(window.id)
    return
  }

  windowSettingsHeights.set(window.id, nextHeight)
}

function toLogicalBounds(window: BrowserWindow, bounds = window.getBounds()): WindowBounds {
  if (isMainRendererWindow(window) && mainWindowLogicalBounds) {
    return { ...mainWindowLogicalBounds }
  }

  return {
    ...bounds,
    height: Math.max(getBaseMinHeight(window), bounds.height - getSettingsHeight(window)),
  }
}

function syncMainWindowLogicalBounds(window: BrowserWindow, bounds = window.getBounds()): void {
  if (!isMainRendererWindow(window)) {
    return
  }

  const x = supportsGeometryPersistence()
    ? bounds.x
    : mainWindowLogicalBounds?.x ?? 0
  const y = supportsGeometryPersistence()
    ? bounds.y
    : mainWindowLogicalBounds?.y ?? 0

  mainWindowLogicalBounds = normalizeMainWindowBounds({
    x,
    y,
    width: bounds.width,
    height: Math.max(WINDOW_DEFAULTS.minHeight, bounds.height - getSettingsHeight(window)),
  })
}

function applyMainWindowLogicalBounds(window: BrowserWindow, bounds: WindowBounds): void {
  const logicalBounds = clampRestoredWindowBounds(
    normalizeMainWindowBounds(bounds),
    getDisplayWorkAreas(),
    RESTORED_WINDOW_VISIBLE_MARGIN,
  )
  mainWindowLogicalBounds = logicalBounds
  suppressMainWindowSync()
  const expandedBounds = resolveExpandedMainWindowBounds(logicalBounds, getSettingsHeight(window), getDisplayWorkAreas())
  if (!supportsGeometryPersistence()) {
    window.setSize(expandedBounds.width, expandedBounds.height)
    return
  }
  window.setBounds(expandedBounds)
}

function applyLogicalBounds(window: BrowserWindow, bounds: WindowBounds): void {
  if (isMainRendererWindow(window)) {
    applyMainWindowLogicalBounds(window, bounds)
    return
  }

  const nextHeight = bounds.height + getSettingsHeight(window)
  if (!supportsGeometryPersistence()) {
    window.setSize(bounds.width, nextHeight)
    return
  }

  const nextBounds = clampRestoredWindowBounds({
    ...bounds,
    height: nextHeight,
  }, getDisplayWorkAreas(), RESTORED_WINDOW_VISIBLE_MARGIN)

  window.setBounds(nextBounds)
}

function setWindowHeight(window: BrowserWindow, bounds: WindowBounds, height: number, y = bounds.y): void {
  if (!supportsGeometryPersistence()) {
    window.setSize(bounds.width, height)
    return
  }

  window.setBounds({
    x: bounds.x,
    y,
    width: bounds.width,
    height,
  })
}

function applySettingsHeight(window: BrowserWindow, rawNextHeight: number): void {
  const currentSettingsHeight = getSettingsHeight(window)
  const nextSettingsHeight = Math.max(0, Math.round(rawNextHeight))
  const baseMinHeight = getBaseMinHeight(window)
  const [minW] = window.getMinimumSize()

  window.setMinimumSize(minW, baseMinHeight + nextSettingsHeight)

  if (currentSettingsHeight === nextSettingsHeight) {
    return
  }

  if (isMainRendererWindow(window)) {
    if (!mainWindowLogicalBounds) {
      syncMainWindowLogicalBounds(window)
    }
    setSettingsHeightForWindow(window, nextSettingsHeight)
    applyMainWindowLogicalBounds(window, toLogicalBounds(window))
    if (currentSettingsHeight === 0 && nextSettingsHeight > 0) {
      raiseMainWindowAboveNormalPopouts()
    }
    return
  }

  const delta = nextSettingsHeight - currentSettingsHeight
  if (delta !== 0) {
    const bounds = window.getBounds()
    const newHeight = Math.max(baseMinHeight + nextSettingsHeight, bounds.height + delta)
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const workAreaBottom = workArea.y + workArea.height
    const bottomEdge = bounds.y + newHeight

    if (delta > 0 && bottomEdge > workAreaBottom) {
      if (!windowSettingsBottomAnchors.has(window.id)) {
        windowSettingsBottomAnchors.set(window.id, bounds.y + bounds.height)
      }
      const newY = Math.max(workArea.y, workAreaBottom - newHeight)
      setWindowHeight(window, bounds, newHeight, newY)
    } else if (delta < 0) {
      const anchoredBottom = windowSettingsBottomAnchors.get(window.id)
      if (anchoredBottom !== undefined) {
        const targetY = Math.max(workArea.y, Math.min(anchoredBottom - newHeight, workAreaBottom - newHeight))
        setWindowHeight(window, bounds, newHeight, targetY)
      } else {
        const baseHeight = newHeight - nextSettingsHeight
        const naturalBottom = bounds.y + baseHeight
        if (naturalBottom < workAreaBottom) {
          const maxY = workAreaBottom - newHeight
          if (bounds.y < maxY) {
            setWindowHeight(window, bounds, newHeight)
          } else {
            setWindowHeight(window, bounds, newHeight, maxY)
          }
        } else {
          setWindowHeight(window, bounds, newHeight)
        }
      }
    } else {
      setWindowHeight(window, bounds, newHeight)
    }
  }

  setSettingsHeightForWindow(window, nextSettingsHeight)
}

function raiseMainWindowAboveNormalPopouts(): void {
  if (!supportsProgrammaticReposition()) {
    return
  }

  raiseWindowAboveNormalPopouts(mainWindow, scopePopoutWindows.values())
}

function sendToRenderer(sender: WebContents, channel: string, ...args: unknown[]): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, ...args)
  }
}

function isResizeDirection(value: unknown): value is ResizeDirection {
  return typeof value === 'string' && RESIZE_DIRECTIONS.includes(value as ResizeDirection)
}

function stopWindowMoveController(): void {
  if (moveInterval) {
    clearInterval(moveInterval)
    moveInterval = null
  }
  moveStartCursor = null
  moveStartBounds = null
}

function stopWindowResizeController(): void {
  if (resizeInterval) {
    clearInterval(resizeInterval)
    resizeInterval = null
  }
  resizeWindow = null
  resizeStartCursor = null
  resizeStartBounds = null
  resizeEdge = null
}

function isCursorInsideWindow(window: BrowserWindow): boolean {
  const cursor = screen.getCursorScreenPoint()
  const bounds = window.getBounds()

  return cursor.x > bounds.x
    && cursor.x < bounds.x + bounds.width
    && cursor.y > bounds.y
    && cursor.y < bounds.y + bounds.height
}

const SOLID_WINDOW_BACKGROUND: WindowBackgroundState = { mode: 'solid', transparency: 0 }

function getEffectiveWindowBackground(): WindowBackgroundState {
  const stored = getWindowStateStore().getWindowBackground()
  if (stored.mode === 'blurred' && !runtimeWindowCapabilities.supportsBlurredBackground) {
    return { ...stored, mode: 'solid' }
  }
  return stored
}

function getWindowBackgroundSnapshot(): WindowBackgroundSnapshot {
  return {
    stored: getWindowStateStore().getWindowBackground(),
    effective: getEffectiveWindowBackground(),
  }
}

// Solid windows keep WS_THICKFRAME, so native Aero Snap and edge resize stay
// intact. On Windows, blurred and clear windows must be created `transparent`
// (blurred composites accent-policy acrylic behind the alpha pixels), which is
// mutually exclusive with the thick frame — those windows fall back to the JS
// move/resize controllers. On macOS, blurred uses vibrancy and keeps the
// native frame semantics.
function getFramelessWindowOptions(
  background: WindowBackgroundState = SOLID_WINDOW_BACKGROUND,
): BrowserWindowConstructorOptions {
  const transparentOnWindows = process.platform === 'win32' && background.mode !== 'solid'
  return {
    frame: false,
    transparent: background.mode === 'clear' || transparentOnWindows,
    backgroundColor: background.mode === 'solid' ? '#000000' : '#00000000',
    roundedCorners: false,
    hasShadow: false,
    ...(process.platform === 'win32'
      ? {
          thickFrame: background.mode === 'solid',
          backgroundMaterial: 'none' as const,
        }
      : {}),
    ...(process.platform === 'darwin' && background.mode === 'blurred'
      ? {
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
        }
      : {}),
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    minimizable: true,
    skipTaskbar: false,
  }
}

function getBackgroundCapableWindows(): BrowserWindow[] {
  const windows: BrowserWindow[] = []
  if (mainWindow && !mainWindow.isDestroyed()) {
    windows.push(mainWindow)
  }
  for (const window of scopePopoutWindows.values()) {
    if (!window.isDestroyed()) {
      windows.push(window)
    }
  }
  return windows
}

function broadcastWindowBackgroundChanged(snapshot: WindowBackgroundSnapshot): void {
  for (const window of getBackgroundCapableWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('window:background-changed', snapshot)
    }
  }
}

function getWindowBackgroundQuery(background: WindowBackgroundState): Record<string, string> {
  return {
    bg: background.mode,
    bgt: String(background.transparency),
  }
}

// Every mode switch recreates the main window: `transparent` (clear) is a
// creation-time flag, and the flat-chrome DWM tweaks applied to solid windows
// (DWMWA_NCRENDERING_POLICY disabled) are sticky on the HWND and fight the
// acrylic backdrop — DWM flickers between composited states, worst at screen
// edges. A fresh window gets exactly the right chrome for its mode. Popouts
// are destroyed alongside it and re-opened by the fresh renderer from
// persisted profile state.
function recreateWindowsForBackgroundChange(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }

  const restoreBounds = toLogicalBounds(mainWindow)
  const wasMaximized = mainWindow.isMaximized()

  windowRecreationPending = true
  allowMainWindowClose = true
  mainWindow.once('closed', () => {
    try {
      createMainWindow(restoreBounds)
      if (wasMaximized) {
        mainWindow?.maximize()
      }
    } finally {
      windowRecreationPending = false
    }
  })
  mainWindow.close()
}

function normalizeProfileMenuRequest(raw: unknown): ProfileMenuRequest | null {
  if (typeof raw !== 'object' || raw === null) return null

  const candidate = raw as Partial<ProfileMenuRequest>
  if (
    typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
    || !Array.isArray(candidate.profiles)
  ) {
    return null
  }

  const profiles = candidate.profiles
    .filter((profile): profile is ProfileMenuRequest['profiles'][number] => {
      return typeof profile?.id === 'string'
        && typeof profile?.name === 'string'
        && typeof profile?.isDefault === 'boolean'
    })
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      isDefault: profile.isDefault,
    }))

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    profiles,
    activeProfileId: typeof candidate.activeProfileId === 'string' ? candidate.activeProfileId : null,
  }
}

function buildProfileMenuTemplate(
  request: ProfileMenuRequest,
  sender: WebContents,
): MenuItemConstructorOptions[] {
  const activeProfile = request.activeProfileId
    ? request.profiles.find((profile) => profile.id === request.activeProfileId) ?? null
    : null

  const template: MenuItemConstructorOptions[] = [
    { label: 'Profiles', enabled: false },
    ...request.profiles.map((profile) => ({
      type: 'checkbox' as const,
      checked: profile.id === request.activeProfileId,
      label: profile.name,
      click: () => sendToRenderer(sender, 'profile-menu:load', profile.id),
    })),
    { type: 'separator' },
    {
      label: 'Save as New Profile',
      click: () => sendToRenderer(sender, 'profile-menu:save-new'),
    },
  ]

  if (activeProfile) {
    template.push({
      label: `Save to "${activeProfile.name}"`,
      click: () => sendToRenderer(sender, 'profile-menu:save-overwrite'),
    })
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Import .prsm...',
      click: () => sendToRenderer(sender, 'profile-menu:import'),
    },
    {
      label: 'Show Profiles Folder',
      click: () => sendToRenderer(sender, 'profile-menu:show-folder'),
    },
  )

  if (activeProfile && !activeProfile.isDefault) {
    template.push(
      { type: 'separator' },
      {
        label: `Rename "${activeProfile.name}"...`,
        click: () => sendToRenderer(sender, 'profile-menu:rename-active', activeProfile.id),
      },
      {
        label: `Delete "${activeProfile.name}"`,
        click: () => sendToRenderer(sender, 'profile-menu:delete-active', activeProfile.id),
      },
    )
  }

  return template
}

function normalizeBounds(raw: unknown, fallback: WindowBounds): WindowBounds {
  if (typeof raw !== 'object' || raw === null) return fallback

  const candidate = raw as Partial<WindowBounds>
  if (
    typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
    || typeof candidate.width !== 'number'
    || typeof candidate.height !== 'number'
  ) {
    return fallback
  }

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(POPOUT_DEFAULTS.minWidth, Math.round(candidate.width)),
    height: Math.max(POPOUT_DEFAULTS.minHeight, Math.round(candidate.height)),
  }
}

function emitAlwaysOnTopChanged(window: BrowserWindow, next: boolean): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }

  window.webContents.send('window:always-on-top-changed', next)
}

async function persistAlwaysOnTopPreference(window: BrowserWindow, next: boolean): Promise<void> {
  if (isMainRendererWindow(window)) {
    await getWindowStateStore().setMainAlwaysOnTop(next)
    return
  }

  const kind = getScopeKindForWindow(window)
  if (kind) {
    await getWindowStateStore().setPopoutAlwaysOnTop(kind, next)
  }
}

function setWindowAlwaysOnTop(window: BrowserWindow, next: boolean): void {
  if (window.isDestroyed()) {
    return
  }

  window.setAlwaysOnTop(next)
  emitAlwaysOnTopChanged(window, next)
  void persistAlwaysOnTopPreference(window, next).catch((error) => {
    console.warn(`Could not persist always-on-top state for ${describeWindow(window)}:`, error)
  })
}

function loadRendererTarget(window: BrowserWindow, query: Record<string, string>): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    void window.loadURL(url.toString())
    return
  }

  void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

async function showCustomDialog(options: DialogOptions): Promise<DialogResult> {
  return new Promise((resolve) => {
    const height = options.type === 'prompt' ? 200 : 160
    const win = new BrowserWindow({
      width: 380,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      alwaysOnTop: true,
      hasShadow: false,
      skipTaskbar: true,
      show: false,
      ...getStaticWindowIconOptions(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.center()
    loadRendererTarget(win, { mode: 'dialog' })

    const onResult = (_event: Electron.IpcMainEvent, result: DialogResult) => {
      if (_event.sender !== win.webContents) return
      resolve(result)
      win.destroy()
    }

    ipcMain.on('dialog:result', onResult)

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('dialog:config', options)
      win.show()
    })

    win.once('closed', () => {
      ipcMain.removeListener('dialog:result', onResult)
      resolve({ buttonIndex: options.cancelId ?? options.buttons.length - 1 })
    })
  })
}

function createMainWindow(restoreBounds?: WindowBounds): void {
  const background = getEffectiveWindowBackground()
  const initialBounds = restoreBounds
    ? clampRestoredWindowBounds(restoreBounds, getDisplayWorkAreas(), RESTORED_WINDOW_VISIBLE_MARGIN)
    : null

  mainWindow = new BrowserWindow({
    ...WINDOW_DEFAULTS,
    ...(initialBounds ?? {}),
    ...getFramelessWindowOptions(background),
    alwaysOnTop: getWindowStateStore().getMainAlwaysOnTop(),
    autoHideMenuBar: true,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'Prism',
    ...getStaticWindowIconOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  if (background.mode === 'solid') {
    applyFlatFramelessChrome(mainWindow)
  } else if (background.mode === 'blurred') {
    applyAcrylicBlurBehind(mainWindow)
  }
  syncMainWindowLogicalBounds(mainWindow)

  mainWindow.on('close', (event) => {
    if (allowMainWindowClose || !mainRendererReady || mainWindow?.webContents.isDestroyed()) {
      allowMainWindowClose = false
      mainWindowClosePending = false
      return
    }

    event.preventDefault()
    if (mainWindowClosePending) {
      return
    }

    mainWindowClosePending = true
    mainWindow?.webContents.send('window:close-requested')
  })

  mainWindow.on('closed', () => {
    if (resizeWindow === mainWindow) {
      stopWindowResizeController()
    }
    stopWindowMoveController()
    if (mainWindowBoundsTimer) {
      clearTimeout(mainWindowBoundsTimer)
      mainWindowBoundsTimer = null
    }
    if (mainWindow) {
      windowSettingsHeights.delete(mainWindow.id)
      windowSettingsBottomAnchors.delete(mainWindow.id)
    }
    mainWindowLogicalBounds = null
    suppressMainWindowSyncUntil = 0
    mainRendererReady = false
    allowMainWindowClose = false
    mainWindowClosePending = false
    mainWindow = null

    for (const kind of SCOPE_KINDS) {
      destroyScopePopoutWindow(kind)
    }
    if (nowPlayingConfigWindow && !nowPlayingConfigWindow.isDestroyed()) {
      nowPlayingConfigWindow.close()
    }
  })

  mainWindow.on('move', () => {
    if (!mainWindow) return
    if (!isMainWindowSyncSuppressed()) {
      syncMainWindowLogicalBounds(mainWindow)
    }
    scheduleMainWindowBoundsSave(mainWindow)
  })
  mainWindow.on('resize', () => {
    if (!mainWindow) return
    if (!isMainWindowSyncSuppressed()) {
      syncMainWindowLogicalBounds(mainWindow)
    }
    scheduleMainWindowBoundsSave(mainWindow)
  })
  mainWindow.on('focus', () => {
    raiseMainWindowAboveNormalPopouts()
  })

  loadRendererTarget(mainWindow, { window: 'main', ...getWindowBackgroundQuery(background) })
}

function sendScopePopoutBoundsChanged(kind: ScopeKind, window: BrowserWindow): void {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || window.isDestroyed()
    || !mainRendererReady
    || !supportsGeometryPersistence()
  ) return

  mainWindow.webContents.send('scope-popout:bounds-changed', kind, toLogicalBounds(window))
}

function emitPopoutBoundsChanged(kind: ScopeKind, window: BrowserWindow): void {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || window.isDestroyed()
    || !mainRendererReady
    || !supportsGeometryPersistence()
  ) return

  const existingTimer = popoutBoundsTimers.get(kind)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    popoutBoundsTimers.delete(kind)

    if (!mainWindow || mainWindow.isDestroyed() || window.isDestroyed()) return
    if (suppressNextPopoutBoundsEvents.has(kind)) {
      suppressNextPopoutBoundsEvents.delete(kind)
      return
    }
    sendScopePopoutBoundsChanged(kind, window)
  }, 80)

  popoutBoundsTimers.set(kind, timer)
}

function flushScopePopoutBoundsChanged(kind: ScopeKind, window: BrowserWindow): void {
  const existingTimer = popoutBoundsTimers.get(kind)
  if (existingTimer) {
    clearTimeout(existingTimer)
    popoutBoundsTimers.delete(kind)
  }

  suppressNextPopoutBoundsEvents.delete(kind)
  sendScopePopoutBoundsChanged(kind, window)
}

function flushRepositionedWindowBounds(window: BrowserWindow): void {
  if (isMainRendererWindow(window)) {
    flushMainWindowBoundsChanged(window)
    return
  }

  const kind = getScopeKindForWindow(window)
  if (kind) {
    flushScopePopoutBoundsChanged(kind, window)
  }
}

function destroyScopePopoutWindow(kind: ScopeKind): void {
  const window = scopePopoutWindows.get(kind)
  if (!window) return

  const pendingTimer = popoutBoundsTimers.get(kind)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    popoutBoundsTimers.delete(kind)
  }

  suppressNextPopoutBoundsEvents.delete(kind)
  scopePopoutCloseAllowed.add(kind)
  scopePopoutWindows.delete(kind)

  if (!window.isDestroyed()) {
    window.close()
    return
  }

  scopePopoutCloseAllowed.delete(kind)
}

function createScopePopoutWindow(kind: ScopeKind, rawBounds?: WindowBounds): BrowserWindow | null {
  if (!mainWindow) return null

  const existing = scopePopoutWindows.get(kind)
  if (existing && !existing.isDestroyed()) {
    return existing
  }

  const shouldRestoreGeometry = supportsGeometryPersistence()
  const mainBounds = shouldRestoreGeometry ? mainWindow.getBounds() : null
  const fallbackBounds: WindowBounds = mainBounds
    ? {
        x: mainBounds.x + 40,
        y: mainBounds.y + 40,
        width: POPOUT_DEFAULTS.width,
        height: POPOUT_DEFAULTS.height,
      }
    : {
        x: Math.round(screen.getPrimaryDisplay().workArea.x + 48),
        y: Math.round(screen.getPrimaryDisplay().workArea.y + 48),
        width: POPOUT_DEFAULTS.width,
        height: POPOUT_DEFAULTS.height,
      }
  const normalizedBounds = shouldRestoreGeometry
    ? normalizeBounds(rawBounds, fallbackBounds)
    : fallbackBounds
  const bounds = shouldRestoreGeometry
    ? clampRestoredWindowBounds(normalizedBounds, getDisplayWorkAreas(), RESTORED_WINDOW_VISIBLE_MARGIN)
    : normalizedBounds
  suppressNextPopoutBoundsEvents.add(kind)

  const background = getEffectiveWindowBackground()
  const options: BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: POPOUT_DEFAULTS.minWidth,
    minHeight: POPOUT_DEFAULTS.minHeight,
    ...getFramelessWindowOptions(background),
    autoHideMenuBar: true,
    title: `Prism ${SCOPE_LABELS[kind]}`,
    alwaysOnTop: getWindowStateStore().getPopoutAlwaysOnTop(kind),
    show: false,
    ...getStaticWindowIconOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }

  if (shouldRestoreGeometry) {
    options.x = bounds.x
    options.y = bounds.y
  }

  const popoutWindow = new BrowserWindow(options)
  if (background.mode === 'solid') {
    applyFlatFramelessChrome(popoutWindow)
  } else if (background.mode === 'blurred') {
    applyAcrylicBlurBehind(popoutWindow)
  }
  setSettingsHeightForWindow(popoutWindow, 0)
  scopePopoutWindows.set(kind, popoutWindow)

  popoutWindow.once('ready-to-show', () => {
    if (!popoutWindow.isDestroyed()) {
      popoutWindow.show()
      raiseMainWindowAboveNormalPopouts()
    }
  })

  popoutWindow.on('close', (event) => {
    if (scopePopoutCloseAllowed.has(kind) || !mainWindow || mainWindow.isDestroyed()) {
      return
    }

    event.preventDefault()
    mainWindow.webContents.send('scope-popout:close-requested', kind)
  })

  popoutWindow.on('closed', () => {
    if (resizeWindow === popoutWindow) {
      stopWindowResizeController()
    }
    windowSettingsHeights.delete(popoutWindow.id)
    windowSettingsBottomAnchors.delete(popoutWindow.id)
    scopePopoutWindows.delete(kind)
    scopePopoutCloseAllowed.delete(kind)

    const pendingTimer = popoutBoundsTimers.get(kind)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      popoutBoundsTimers.delete(kind)
    }
  })

  popoutWindow.on('move', () => emitPopoutBoundsChanged(kind, popoutWindow))
  popoutWindow.on('resize', () => emitPopoutBoundsChanged(kind, popoutWindow))

  loadRendererTarget(popoutWindow, { window: 'scope-popout', scope: kind, ...getWindowBackgroundQuery(background) })
  return popoutWindow
}

function syncScopePopouts(nextState: ScopePopoutSyncStateMap): void {
  for (const kind of SCOPE_KINDS) {
    const desired = nextState[kind]
    if (!desired?.shouldBeOpen) {
      destroyScopePopoutWindow(kind)
      continue
    }

    const popoutWindow = createScopePopoutWindow(kind, desired.bounds)
    if (!popoutWindow || popoutWindow.isDestroyed()) continue

    if (supportsGeometryPersistence() && desired.bounds) {
      const currentBounds = popoutWindow.getBounds()
      const nextBounds = clampRestoredWindowBounds(
        normalizeBounds(desired.bounds, currentBounds),
        getDisplayWorkAreas(),
        RESTORED_WINDOW_VISIBLE_MARGIN,
      )
      const hasBoundsDelta =
        currentBounds.x !== nextBounds.x
        || currentBounds.y !== nextBounds.y
        || currentBounds.width !== nextBounds.width
        || currentBounds.height !== nextBounds.height

      if (hasBoundsDelta) {
        suppressNextPopoutBoundsEvents.add(kind)
        applyLogicalBounds(popoutWindow, nextBounds)
      }
    }
  }
}

function normalizeNowPlayingConfigBounds(raw: unknown, fallback: WindowBounds): WindowBounds {
  if (typeof raw !== 'object' || raw === null) {
    return fallback
  }

  const candidate = raw as Partial<WindowBounds>
  if (
    typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
    || typeof candidate.width !== 'number'
    || typeof candidate.height !== 'number'
  ) {
    return fallback
  }

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(NOW_PLAYING_CONFIG_DEFAULTS.minWidth, Math.round(candidate.width)),
    height: Math.max(NOW_PLAYING_CONFIG_DEFAULTS.minHeight, Math.round(candidate.height)),
  }
}

function scheduleNowPlayingConfigBoundsSave(window: BrowserWindow): void {
  if (!supportsGeometryPersistence()) {
    return
  }

  if (nowPlayingConfigBoundsTimer) {
    clearTimeout(nowPlayingConfigBoundsTimer)
  }

  nowPlayingConfigBoundsTimer = setTimeout(() => {
    nowPlayingConfigBoundsTimer = null
    if (window.isDestroyed()) return
    void getWindowStateStore().setNowPlayingConfigWindowBounds(window.getBounds()).catch((error) => {
      console.warn('Could not persist now-playing config window bounds:', error)
    })
  }, 80)
}

function createNowPlayingConfigWindow(): BrowserWindow {
  if (nowPlayingConfigWindow && !nowPlayingConfigWindow.isDestroyed()) {
    return nowPlayingConfigWindow
  }

  const shouldRestoreGeometry = supportsGeometryPersistence()
  const anchorBounds = shouldRestoreGeometry ? mainWindow?.getBounds() ?? null : null
  const fallbackBounds: WindowBounds = anchorBounds
    ? {
        x: anchorBounds.x + 40,
        y: anchorBounds.y + 40,
        width: NOW_PLAYING_CONFIG_DEFAULTS.width,
        height: NOW_PLAYING_CONFIG_DEFAULTS.height,
      }
    : {
        x: Math.round(screen.getPrimaryDisplay().workArea.x + 48),
        y: Math.round(screen.getPrimaryDisplay().workArea.y + 48),
        width: NOW_PLAYING_CONFIG_DEFAULTS.width,
        height: NOW_PLAYING_CONFIG_DEFAULTS.height,
      }
  const bounds = shouldRestoreGeometry
    ? normalizeNowPlayingConfigBounds(
        getWindowStateStore().getNowPlayingConfigWindowBounds(),
        fallbackBounds,
      )
    : fallbackBounds

  const options: BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: NOW_PLAYING_CONFIG_DEFAULTS.minWidth,
    minHeight: NOW_PLAYING_CONFIG_DEFAULTS.minHeight,
    // The config window is a form UI; it always keeps a solid background.
    ...getFramelessWindowOptions(),
    autoHideMenuBar: true,
    title: 'Prism Now Playing',
    show: false,
    ...getStaticWindowIconOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }

  if (shouldRestoreGeometry) {
    options.x = bounds.x
    options.y = bounds.y
  }

  nowPlayingConfigWindow = new BrowserWindow(options)
  applyFlatFramelessChrome(nowPlayingConfigWindow)

  const configWindow = nowPlayingConfigWindow

  configWindow.once('ready-to-show', () => {
    if (!configWindow.isDestroyed()) {
      configWindow.show()
      configWindow.focus()
    }
  })

  configWindow.on('move', () => {
    scheduleNowPlayingConfigBoundsSave(configWindow)
  })
  configWindow.on('resize', () => {
    scheduleNowPlayingConfigBoundsSave(configWindow)
  })
  configWindow.on('closed', () => {
    if (resizeWindow === configWindow) {
      stopWindowResizeController()
    }
    if (nowPlayingConfigBoundsTimer) {
      clearTimeout(nowPlayingConfigBoundsTimer)
      nowPlayingConfigBoundsTimer = null
    }
    windowSettingsHeights.delete(configWindow.id)
    windowSettingsBottomAnchors.delete(configWindow.id)
    nowPlayingConfigWindow = null
  })

  loadRendererTarget(configWindow, { window: 'now-playing-config' })
  return configWindow
}

function openNowPlayingConfigWindow(): void {
  const configWindow = createNowPlayingConfigWindow()
  if (configWindow.isMinimized()) {
    configWindow.restore()
  }
  configWindow.show()
  configWindow.focus()
}

function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(false)
    }
  })
}

function setupIPC(): void {
  ipcMain.on('window:minimize', (event) => {
    getWindowFromSender(event.sender)?.minimize()
  })

  ipcMain.on('window:start-move', (event) => {
    if (!supportsProgrammaticReposition()) {
      return
    }

    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    stopWindowResizeController()
    stopWindowMoveController()
    const cursor = screen.getCursorScreenPoint()
    moveStartCursor = { x: cursor.x, y: cursor.y }
    moveStartBounds = targetWindow.getBounds()

    moveInterval = setInterval(() => {
      if (!targetWindow || targetWindow.isDestroyed() || !moveStartCursor || !moveStartBounds) return
      const current = screen.getCursorScreenPoint()
      const dx = current.x - moveStartCursor.x
      const dy = current.y - moveStartCursor.y

      if (isMainRendererWindow(targetWindow)) {
        const nextBounds = clampDraggedMainWindowBounds({
          x: moveStartBounds.x + dx,
          y: moveStartBounds.y + dy,
          width: moveStartBounds.width,
          height: moveStartBounds.height,
        }, getDisplayWorkAreas(), MAIN_WINDOW_VISIBLE_GRAB_MARGIN)
        targetWindow.setPosition(nextBounds.x, nextBounds.y)
        return
      }

      targetWindow.setPosition(moveStartBounds.x + dx, moveStartBounds.y + dy)
    }, 16)
  })

  ipcMain.on('window:stop-move', () => {
    stopWindowMoveController()
  })

  ipcMain.on('window:start-resize', (event, rawEdge: unknown) => {
    if (process.platform !== 'win32' || !isResizeDirection(rawEdge)) return

    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow || targetWindow.isDestroyed()) return

    stopWindowMoveController()
    stopWindowResizeController()

    resizeWindow = targetWindow
    resizeEdge = rawEdge
    resizeStartCursor = screen.getCursorScreenPoint()
    resizeStartBounds = targetWindow.getBounds()

    resizeInterval = setInterval(() => {
      if (
        !resizeWindow
        || resizeWindow.isDestroyed()
        || !resizeStartCursor
        || !resizeStartBounds
        || !resizeEdge
      ) {
        stopWindowResizeController()
        return
      }

      const currentCursor = screen.getCursorScreenPoint()
      const [minWidth, minHeight] = resizeWindow.getMinimumSize()
      const nextBounds = calculateResizedWindowBounds({
        edge: resizeEdge,
        startBounds: resizeStartBounds,
        startCursor: resizeStartCursor,
        cursor: currentCursor,
        minWidth,
        minHeight,
      })

      resizeWindow.setBounds(nextBounds)
    }, 16)
  })

  ipcMain.on('window:stop-resize', () => {
    stopWindowResizeController()
  })

  ipcMain.on('window:close', (event) => {
    getWindowFromSender(event.sender)?.close()
  })

  ipcMain.on('window:close-response', (event, shouldClose: boolean) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow || !isMainRendererWindow(targetWindow)) return

    mainWindowClosePending = false
    if (!shouldClose) {
      return
    }

    allowMainWindowClose = true
    targetWindow.close()
  })

  ipcMain.on('window:toggle-always-on-top', (event) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    setWindowAlwaysOnTop(targetWindow, !targetWindow.isAlwaysOnTop())
  })

  ipcMain.handle('window:is-always-on-top', (event) => {
    return getWindowFromSender(event.sender)?.isAlwaysOnTop() ?? false
  })

  ipcMain.handle('window:get-background', () => {
    return getWindowBackgroundSnapshot()
  })

  ipcMain.handle('window:set-background', async (_event, raw: unknown) => {
    const next = normalizeWindowBackgroundState(raw)
    const previousEffective = getEffectiveWindowBackground()
    await getWindowStateStore().setWindowBackground(next)
    const nextEffective = getEffectiveWindowBackground()

    if (previousEffective.mode !== nextEffective.mode) {
      recreateWindowsForBackgroundChange()
    } else {
      // Transparency-only changes are pure CSS in the renderers.
      broadcastWindowBackgroundChanged(getWindowBackgroundSnapshot())
    }

    return getWindowBackgroundSnapshot()
  })

  ipcMain.handle('window:is-cursor-inside', (event) => {
    const targetWindow = getWindowFromSender(event.sender)
    return targetWindow ? isCursorInsideWindow(targetWindow) : false
  })

  ipcMain.handle('app:get-build-info', () => {
    return getAppBuildInfo()
  })

  ipcMain.handle('updates:check', async () => {
    return checkForUpdates(app.getVersion())
  })

  ipcMain.handle('updates:open-releases-page', async (_event, releaseUrl: unknown) => {
    await shell.openExternal(resolveSafeReleaseUrl(releaseUrl))
  })

  ipcMain.handle('now-playing:get-state', async () => {
    return getNowPlayingManager().getState()
  })

  ipcMain.handle('now-playing:set-active', async (event, active: boolean) => {
    return getNowPlayingManager().setConsumerActive(event.sender.id, Boolean(active))
  })

  ipcMain.handle('now-playing:save-provider-config', async (_event, providerId: string, rawConfig: unknown) => {
    if (providerId !== 'astra' && providerId !== 'spotify' && providerId !== 'tidal') {
      throw new Error('Invalid now-playing provider.')
    }
    return getNowPlayingManager().saveProviderConfig(providerId, rawConfig)
  })

  ipcMain.handle('now-playing:set-provider-priority', async (_event, providerPriority: string[]) => {
    return getNowPlayingManager().setProviderPriority(providerPriority)
  })

  ipcMain.handle('now-playing:retry-provider', async (_event, providerId: string) => {
    if (providerId !== 'astra' && providerId !== 'spotify' && providerId !== 'tidal') {
      throw new Error('Invalid now-playing provider.')
    }
    return getNowPlayingManager().retryProvider(providerId)
  })

  ipcMain.handle('now-playing:send-control', async (_event, command: NowPlayingControlCommand) => {
    return getNowPlayingManager().sendControl(command)
  })

  ipcMain.handle('now-playing:open-config-window', async () => {
    openNowPlayingConfigWindow()
  })

  ipcMain.handle('profiles:get-snapshot', async () => {
    return getProfileLibrary().getSnapshot()
  })

  ipcMain.handle('profiles:save-new', async (_event, name: string, rawProfile: unknown) => {
    return getProfileLibrary().saveNewProfile(name, normalizeIncomingProfile(rawProfile, name))
  })

  ipcMain.handle('profiles:overwrite', async (_event, id: string, rawProfile: unknown) => {
    return getProfileLibrary().overwriteProfile(id, normalizeIncomingProfile(rawProfile))
  })

  ipcMain.handle('profiles:load', async (_event, id: string) => {
    return getProfileLibrary().loadProfile(id)
  })

  ipcMain.handle('profiles:delete', async (_event, id: string) => {
    return getProfileLibrary().deleteProfile(id)
  })

  ipcMain.handle('profiles:rename', async (_event, id: string, name: string) => {
    return getProfileLibrary().renameProfile(id, name)
  })

  ipcMain.handle('profiles:import-dialog', async () => {
    const targetWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Prism Profiles',
          extensions: ['prsm'],
        },
      ],
    }
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return getProfileLibrary().importProfileFromPath(result.filePaths[0])
  })

  ipcMain.handle('profiles:import-path', async (_event, path: string) => {
    return getProfileLibrary().importProfileFromPath(path)
  })

  ipcMain.handle('profiles:prompt-unsaved', async (_event, profileName: string | null) => {
    const result = await showCustomDialog({
      type: 'confirm',
      title: 'Unsaved Profile Changes',
      message: profileName
        ? `Save changes to "${profileName}"?`
        : 'Save unsaved profile changes?',
      detail: 'Your profile changes will be lost if you continue without saving.',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })

    if (result.buttonIndex === 0) return 'save'
    if (result.buttonIndex === 1) return 'discard'
    return 'cancel'
  })

  ipcMain.handle('dialog:show', async (_event, options: DialogOptions) => {
    return showCustomDialog(options)
  })

  ipcMain.handle('profiles:reveal-folder', async () => {
    const folderPath = getProfileLibrary().getProfilesDirectory()
    const openResult = await shell.openPath(folderPath)
    if (openResult) {
      throw new Error(openResult)
    }
  })

  ipcMain.handle('profiles:migrate-legacy', async (_event, payload: LegacyProfileMigrationPayload) => {
    return getProfileLibrary().migrateLegacyProfiles(payload)
  })

  ipcMain.handle('themes:get-snapshot', async () => {
    const snapshot = await getThemeLibrary().getSnapshot()
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:load', async (_event, id: string) => {
    const snapshot = await getThemeLibrary().loadTheme(id)
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:rename', async (_event, id: string, name: string) => {
    const snapshot = await getThemeLibrary().renameTheme(id, name)
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:delete', async (_event, id: string) => {
    const snapshot = await getThemeLibrary().deleteTheme(id)
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:reload', async () => {
    const snapshot = await getThemeLibrary().reloadThemes()
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:import-dialog', async () => {
    const targetWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Prism Themes',
          extensions: ['iro'],
        },
      ],
    }
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const snapshot = await getThemeLibrary().importThemeFromPath(result.filePaths[0])
    applyNativeThemeSnapshot(snapshot)
    return snapshot
  })

  ipcMain.handle('themes:reveal-folder', async () => {
    const folderPath = getThemeLibrary().getThemesDirectory()
    const openResult = await shell.openPath(folderPath)
    if (openResult) {
      throw new Error(openResult)
    }
  })

  ipcMain.handle('themes:migrate-legacy', async (_event, payload: LegacyThemeMigrationPayload) => {
    const migration = await getThemeLibrary().migrateLegacyTheme(payload)
    applyNativeThemeSnapshot(migration.snapshot)
    return migration
  })

  ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
    const url = normalizeExternalHttpUrl(rawUrl)
    if (!url) {
      throw new Error('Invalid external URL.')
    }

    await shell.openExternal(url)
  })

  ipcMain.on('profile-menu:open', (event, rawRequest: unknown) => {
    const request = normalizeProfileMenuRequest(rawRequest)
    if (!request) return

    const targetWindow = getWindowFromSender(event.sender)
    const menu = Menu.buildFromTemplate(buildProfileMenuTemplate(request, event.sender))
    menu.popup({
      window: targetWindow ?? undefined,
      x: request.x,
      y: request.y,
      callback: () => sendToRenderer(event.sender, 'profile-menu:closed'),
    })
  })

  ipcMain.on('window:set-bounds', (event, bounds: WindowBounds) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    applyLogicalBounds(targetWindow, bounds)
  })

  ipcMain.handle('window:get-bounds', (event) => {
    if (!supportsGeometryPersistence()) {
      return null
    }

    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return null

    return toLogicalBounds(targetWindow)
  })

  ipcMain.on('window:reposition', (event, position: 'top' | 'bottom') => {
    if (!supportsProgrammaticReposition()) {
      return
    }

    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    const display = screen.getDisplayMatching(targetWindow.getBounds())
    const workArea = display.workArea

    if (isMainRendererWindow(targetWindow)) {
      const logicalBounds = toLogicalBounds(targetWindow)
      applyLogicalBounds(targetWindow, {
        x: workArea.x,
        y: position === 'top'
          ? workArea.y
          : workArea.y + workArea.height - logicalBounds.height,
        width: workArea.width,
        height: logicalBounds.height,
      })
      flushRepositionedWindowBounds(targetWindow)
      return
    }

    const [, height] = targetWindow.getSize()

    if (position === 'top') {
      targetWindow.setPosition(workArea.x, workArea.y)
    } else {
      targetWindow.setPosition(workArea.x, workArea.y + workArea.height - height)
    }
    targetWindow.setSize(workArea.width, height)
    flushRepositionedWindowBounds(targetWindow)
  })

  ipcMain.on('window:expand-settings', (event, panelHeight: number) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    applySettingsHeight(targetWindow, getSettingsHeight(targetWindow) + panelHeight)
  })

  ipcMain.on('window:collapse-settings', (event, panelHeight: number) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    applySettingsHeight(targetWindow, getSettingsHeight(targetWindow) - panelHeight)
  })

  ipcMain.on('window:set-settings-height', (event, panelHeight: number) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    applySettingsHeight(targetWindow, panelHeight)
  })

  ipcMain.on('renderer:ready', (event) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!isMainRendererWindow(targetWindow)) return

    mainRendererReady = true
    void processPendingProfileOpenPaths()
  })

  ipcMain.on('scope-popout:sync', (event, state: ScopePopoutSyncStateMap) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!isMainRendererWindow(targetWindow)) return
    syncScopePopouts(state)
  })

  ipcMain.on('scope-popout:snapshot', (event, snapshot: ScopePopoutSnapshot) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!isMainRendererWindow(targetWindow) || !isScopeKind(snapshot?.kind)) return

    const popoutWindow = scopePopoutWindows.get(snapshot.kind)
    if (!popoutWindow || popoutWindow.isDestroyed()) return
    popoutWindow.webContents.send('scope-popout:snapshot', snapshot)
  })

  ipcMain.on('scope-popout:audio', (event, kind: ScopeKind, batch: ScopePopoutAudioBatch) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!isMainRendererWindow(targetWindow) || !isScopeKind(kind)) return

    const popoutWindow = scopePopoutWindows.get(kind)
    if (!popoutWindow || popoutWindow.isDestroyed()) return
    popoutWindow.webContents.send('scope-popout:audio', kind, batch)
  })

  ipcMain.on('scope-popout:session', (event, kind: ScopeKind, sessionState: ScopePopoutSessionState) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!isMainRendererWindow(targetWindow) || !isScopeKind(kind)) return

    const popoutWindow = scopePopoutWindows.get(kind)
    if (!popoutWindow || popoutWindow.isDestroyed()) return
    popoutWindow.webContents.send('scope-popout:session', kind, sessionState)
  })

  ipcMain.on('scope-popout:ready', (event, kind: ScopeKind) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow || isMainRendererWindow(targetWindow) || !isScopeKind(kind)) return
    mainWindow?.webContents.send('scope-popout:ready', kind)
  })

  ipcMain.on('scope-popout:request-pop-in', (event, kind: ScopeKind) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow || isMainRendererWindow(targetWindow) || !isScopeKind(kind)) return
    mainWindow?.webContents.send('scope-popout:close-requested', kind)
  })

  ipcMain.on('scope-popout:settings-update', (event, kind: ScopeKind, partial: unknown) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow || isMainRendererWindow(targetWindow) || !isScopeKind(kind)) return
    mainWindow?.webContents.send('scope-popout:settings-update', kind, partial)
  })
}

app.commandLine.appendSwitch('enable-features', 'Metal')

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    setupPermissions()
    void getNowPlayingManager().initialize()
    setupIPC()
    await getWindowStateStore().initialize()
    await syncNativeThemeAppearance()
    applyStaticDockIcon()
    createMainWindow()
    queueProfileOpenPaths(extractProfilePathsFromArgv(process.argv))
    void processPendingProfileOpenPaths()
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueProfileOpenPath(filePath)
    if (app.isReady()) {
      void processPendingProfileOpenPaths()
    }
  })

  app.on('second-instance', (_event, argv) => {
    queueProfileOpenPaths(extractProfilePathsFromArgv(argv))
    if (app.isReady()) {
      focusMainWindow()
      void processPendingProfileOpenPaths()
    }
  })
}

app.on('window-all-closed', () => {
  if (windowRecreationPending) {
    return
  }

  void nowPlayingManager?.dispose()
  app.quit()
})

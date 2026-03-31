import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions, OpenDialogOptions, WebContents } from 'electron'
import { extname, join, resolve } from 'path'
import type {
  AstraControlCommand,
  AstraIntegrationConfig,
  AstraIntegrationState,
} from '../types/astra'
import type { CaptureBackendSupport, CaptureBackendSupportEntry } from '../types/capture'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
  WindowBounds,
} from '../types/popout'
import type { ProfileMenuRequest } from '../types/profileMenu'
import type { LegacyProfileMigrationPayload, Profile } from '../types/profile'
import { SCOPE_KINDS, type ScopeKind } from '../types/scope'
import type {
  LegacyThemeMigrationPayload,
  ThemeLibrarySnapshot,
} from '../types/theme'
import { RESIZE_DIRECTIONS, type ResizeDirection } from '../types/windowResize'
import { normalizeProfile } from '../shared/profileState'
import { calculateResizedWindowBounds } from '../shared/windowResize'
import { FileBackedProfileLibrary } from './profileLibrary'
import { AstraIntegrationService } from './services/astraIntegration'
import { FileBackedThemeLibrary } from './themeLibrary'

let mainWindow: BrowserWindow | null = null
let moveInterval: ReturnType<typeof setInterval> | null = null
let moveStartCursor: { x: number; y: number } | null = null
let moveStartPosition: number[] | null = null
let resizeInterval: ReturnType<typeof setInterval> | null = null
let resizeWindow: BrowserWindow | null = null
let resizeStartCursor: { x: number; y: number } | null = null
let resizeStartBounds: WindowBounds | null = null
let resizeEdge: ResizeDirection | null = null
let mainWindowBoundsTimer: ReturnType<typeof setTimeout> | null = null
let mainRendererReady = false
let allowMainWindowClose = false
let mainWindowClosePending = false
let suppressNextMainWindowBoundsEvent = false

const scopePopoutWindows = new Map<ScopeKind, BrowserWindow>()
const scopePopoutCloseAllowed = new Set<ScopeKind>()
const popoutBoundsTimers = new Map<ScopeKind, ReturnType<typeof setTimeout>>()
const suppressNextPopoutBoundsEvents = new Set<ScopeKind>()
const windowSettingsHeights = new Map<number, number>()
const windowSettingsBottomAnchors = new Map<number, number>()
const pendingProfileOpenPaths: string[] = []
const pendingThemeOpenPaths: string[] = []

let profileLibrary: FileBackedProfileLibrary | null = null
let themeLibrary: FileBackedThemeLibrary | null = null
let astraIntegrationService: AstraIntegrationService | null = null

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

function getProfileLibrary(): FileBackedProfileLibrary {
  if (!profileLibrary) {
    profileLibrary = new FileBackedProfileLibrary(
      join(app.getPath('documents'), 'Prism Profiles'),
      join(app.getPath('userData'), 'profile-state.json'),
      async () => getThemeLibrary().getActiveThemeId(),
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

function broadcastAstraState(state: AstraIntegrationState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send('astra:state-changed', state)
  }
}

function getAstraIntegrationService(): AstraIntegrationService {
  if (!astraIntegrationService) {
    astraIntegrationService = new AstraIntegrationService({
      configPath: join(app.getPath('userData'), 'astra-integration.json'),
    })
    astraIntegrationService.subscribe((state) => {
      broadcastAstraState(state)
    })
  }

  return astraIntegrationService
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

function queueThemeOpenPath(filePath: string): void {
  if (extname(filePath).toLowerCase() !== '.iro') return

  const resolvedPath = resolve(filePath)
  if (!pendingThemeOpenPaths.includes(resolvedPath)) {
    pendingThemeOpenPaths.push(resolvedPath)
  }
}

function queueThemeOpenPaths(paths: string[]): void {
  for (const filePath of paths) {
    queueThemeOpenPath(filePath)
  }
}

function extractProfilePathsFromArgv(argv: string[]): string[] {
  return argv
    .filter((value) => extname(value).toLowerCase() === '.prsm')
    .map((value) => resolve(value))
}

function extractThemePathsFromArgv(argv: string[]): string[] {
  return argv
    .filter((value) => extname(value).toLowerCase() === '.iro')
    .map((value) => resolve(value))
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
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

async function processPendingThemeOpenPaths(): Promise<void> {
  if (pendingThemeOpenPaths.length === 0) return

  const paths = [...pendingThemeOpenPaths]
  pendingThemeOpenPaths.length = 0

  let latestSnapshot: ThemeLibrarySnapshot | null = null

  for (const filePath of paths) {
    try {
      latestSnapshot = await getThemeLibrary().importThemeFromPath(filePath)
    } catch (error) {
      dialog.showErrorBox(
        'Could Not Open Theme',
        getErrorMessage(error, `Prism could not open ${filePath}.`),
      )
    }
  }

  if (!latestSnapshot || !mainWindow || mainWindow.isDestroyed()) return

  focusMainWindow()
  mainWindow.webContents.send('themes:external-activated', latestSnapshot)
}

function scheduleMainWindowBoundsSave(window: BrowserWindow): void {
  if (!isMainRendererWindow(window) || !mainRendererReady) return

  if (mainWindowBoundsTimer) {
    clearTimeout(mainWindowBoundsTimer)
  }

  mainWindowBoundsTimer = setTimeout(() => {
    mainWindowBoundsTimer = null
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    if (suppressNextMainWindowBoundsEvent) {
      suppressNextMainWindowBoundsEvent = false
      return
    }
    window.webContents.send('window:bounds-changed', toLogicalBounds(window))
  }, 80)
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

function getBaseMinHeight(window: BrowserWindow): number {
  return isMainRendererWindow(window) ? WINDOW_DEFAULTS.minHeight : POPOUT_DEFAULTS.minHeight
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
  return {
    ...bounds,
    height: Math.max(getBaseMinHeight(window), bounds.height - getSettingsHeight(window)),
  }
}

function applyLogicalBounds(window: BrowserWindow, bounds: WindowBounds): void {
  window.setBounds({
    ...bounds,
    height: bounds.height + getSettingsHeight(window),
  })
}

function setWindowHeight(window: BrowserWindow, bounds: WindowBounds, height: number, y = bounds.y): void {
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
  const delta = nextSettingsHeight - currentSettingsHeight
  const baseMinHeight = getBaseMinHeight(window)
  const [minW] = window.getMinimumSize()

  window.setMinimumSize(minW, baseMinHeight + nextSettingsHeight)

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
  moveStartPosition = null
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

function getFramelessWindowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'transparent' | 'backgroundColor' | 'roundedCorners' | 'hasShadow' | 'thickFrame' | 'backgroundMaterial'
> {
  return {
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    roundedCorners: false,
    hasShadow: false,
    ...(process.platform === 'win32'
      ? {
          thickFrame: false,
          backgroundMaterial: 'none',
        }
      : {}),
  }
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

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    ...WINDOW_DEFAULTS,
    ...getFramelessWindowChromeOptions(),
    alwaysOnTop: true,
    autoHideMenuBar: true,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'Prism',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

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
    mainRendererReady = false
    allowMainWindowClose = false
    mainWindowClosePending = false
    mainWindow = null

    for (const kind of SCOPE_KINDS) {
      destroyScopePopoutWindow(kind)
    }
  })

  mainWindow.on('move', () => {
    if (!mainWindow) return
    scheduleMainWindowBoundsSave(mainWindow)
  })
  mainWindow.on('resize', () => {
    if (!mainWindow) return
    scheduleMainWindowBoundsSave(mainWindow)
  })

  loadRendererTarget(mainWindow, { window: 'main' })
}

function setAllWindowsAlwaysOnTop(next: boolean): void {
  mainWindow?.setAlwaysOnTop(next)
  for (const window of scopePopoutWindows.values()) {
    window.setAlwaysOnTop(next)
  }
}

function emitPopoutBoundsChanged(kind: ScopeKind, window: BrowserWindow): void {
  if (!mainWindow || mainWindow.isDestroyed() || window.isDestroyed() || !mainRendererReady) return

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
    const bounds = toLogicalBounds(window)
    mainWindow.webContents.send('scope-popout:bounds-changed', kind, bounds)
  }, 80)

  popoutBoundsTimers.set(kind, timer)
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

  const mainBounds = mainWindow.getBounds()
  const fallbackBounds: WindowBounds = {
    x: mainBounds.x + 40,
    y: mainBounds.y + 40,
    width: POPOUT_DEFAULTS.width,
    height: POPOUT_DEFAULTS.height,
  }
  const bounds = normalizeBounds(rawBounds, fallbackBounds)
  suppressNextPopoutBoundsEvents.add(kind)

  const options: BrowserWindowConstructorOptions = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: POPOUT_DEFAULTS.minWidth,
    minHeight: POPOUT_DEFAULTS.minHeight,
    ...getFramelessWindowChromeOptions(),
    resizable: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: `Prism ${kind}`,
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }

  const popoutWindow = new BrowserWindow(options)
  setSettingsHeightForWindow(popoutWindow, 0)
  scopePopoutWindows.set(kind, popoutWindow)

  popoutWindow.once('ready-to-show', () => {
    if (!popoutWindow.isDestroyed()) {
      popoutWindow.show()
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

  loadRendererTarget(popoutWindow, { window: 'scope-popout', scope: kind })
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

    const currentBounds = popoutWindow.getBounds()
    const nextBounds = normalizeBounds(desired.bounds, currentBounds)
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

function getNativeCaptureSupportEntry(): CaptureBackendSupportEntry {
  if (process.platform === 'darwin') {
    return {
      kind: 'native-macos',
      available: false,
      reason: 'Native macOS system audio capture is not implemented in this build.',
    }
  }

  if (process.platform === 'win32') {
    return {
      kind: 'native-windows',
      available: false,
      reason: 'Native Windows WASAPI loopback capture is not implemented in this build.',
    }
  }

  return {
    kind: 'native-linux',
    available: false,
    reason: 'Native Linux monitor capture is not implemented in this build.',
  }
}

function getCaptureBackendSupport(): CaptureBackendSupport {
  return {
    policyOptions: ['auto', 'native', 'electron'],
    nativeBackend: getNativeCaptureSupportEntry(),
    electronSystem: {
      kind: 'electron-system',
      available: true,
      reason: null,
    },
    electronDevice: {
      kind: 'electron-device',
      available: true,
      reason: null,
    },
  }
}

function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
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
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    stopWindowResizeController()
    stopWindowMoveController()
    const cursor = screen.getCursorScreenPoint()
    moveStartCursor = { x: cursor.x, y: cursor.y }
    moveStartPosition = targetWindow.getPosition()

    moveInterval = setInterval(() => {
      if (!targetWindow || targetWindow.isDestroyed() || !moveStartCursor || !moveStartPosition) return
      const current = screen.getCursorScreenPoint()
      const dx = current.x - moveStartCursor.x
      const dy = current.y - moveStartCursor.y
      targetWindow.setPosition(moveStartPosition[0] + dx, moveStartPosition[1] + dy)
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

    const current = targetWindow.isAlwaysOnTop()
    const next = !current
    if (mainWindow && targetWindow === mainWindow) {
      setAllWindowsAlwaysOnTop(next)
      mainWindow?.webContents.send('window:always-on-top-changed', next)
      return
    }

    targetWindow.setAlwaysOnTop(next)
  })

  ipcMain.handle('window:is-always-on-top', (event) => {
    return getWindowFromSender(event.sender)?.isAlwaysOnTop() ?? true
  })

  ipcMain.handle('audio:get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources.map((s) => ({ id: s.id, name: s.name }))
  })

  ipcMain.handle('capture:get-backend-support', () => {
    return getCaptureBackendSupport()
  })

  ipcMain.handle('astra:get-config', async () => {
    return getAstraIntegrationService().getConfig()
  })

  ipcMain.handle('astra:save-config', async (_event, rawConfig: AstraIntegrationConfig) => {
    return getAstraIntegrationService().saveConfig(rawConfig)
  })

  ipcMain.handle('astra:get-state', async () => {
    return getAstraIntegrationService().getState()
  })

  ipcMain.handle('astra:set-active', async (event, active: boolean) => {
    return getAstraIntegrationService().setConsumerActive(event.sender.id, Boolean(active))
  })

  ipcMain.handle('astra:send-control', async (_event, command: AstraControlCommand) => {
    await getAstraIntegrationService().sendControl(command)
    return getAstraIntegrationService().getState()
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

  ipcMain.handle('profiles:prompt-unsaved', async (event, profileName: string | null) => {
    const targetWindow = getWindowFromSender(event.sender) ?? mainWindow ?? undefined
    const { response } = targetWindow
      ? await dialog.showMessageBox(targetWindow, {
        type: 'warning',
        title: 'Unsaved Profile Changes',
        message: profileName
          ? `Save changes to "${profileName}"?`
          : 'Save unsaved profile changes?',
        detail: 'Your profile changes will be lost if you continue without saving.',
        buttons: ['Save', 'Discard', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      : await dialog.showMessageBox({
        type: 'warning',
        title: 'Unsaved Profile Changes',
        message: profileName
          ? `Save changes to "${profileName}"?`
          : 'Save unsaved profile changes?',
        detail: 'Your profile changes will be lost if you continue without saving.',
        buttons: ['Save', 'Discard', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })

    if (response === 0) {
      return 'save'
    }

    if (response === 1) {
      return 'discard'
    }

    return 'cancel'
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
    return getThemeLibrary().getSnapshot()
  })

  ipcMain.handle('themes:load', async (_event, id: string) => {
    return getThemeLibrary().loadTheme(id)
  })

  ipcMain.handle('themes:rename', async (_event, id: string, name: string) => {
    return getThemeLibrary().renameTheme(id, name)
  })

  ipcMain.handle('themes:delete', async (_event, id: string) => {
    return getThemeLibrary().deleteTheme(id)
  })

  ipcMain.handle('themes:reload', async () => {
    return getThemeLibrary().reloadThemes()
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

    return getThemeLibrary().importThemeFromPath(result.filePaths[0])
  })

  ipcMain.handle('themes:reveal-folder', async () => {
    const folderPath = getThemeLibrary().getThemesDirectory()
    const openResult = await shell.openPath(folderPath)
    if (openResult) {
      throw new Error(openResult)
    }
  })

  ipcMain.handle('themes:migrate-legacy', async (_event, payload: LegacyThemeMigrationPayload) => {
    return getThemeLibrary().migrateLegacyTheme(payload)
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

    if (isMainRendererWindow(targetWindow)) {
      suppressNextMainWindowBoundsEvent = true
    }
    applyLogicalBounds(targetWindow, bounds)
  })

  ipcMain.handle('window:get-bounds', (event) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return null

    return toLogicalBounds(targetWindow)
  })

  ipcMain.on('window:reposition', (event, position: 'top' | 'bottom') => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    const display = screen.getDisplayMatching(targetWindow.getBounds())
    const workArea = display.workArea
    const [, height] = targetWindow.getSize()

    if (position === 'top') {
      targetWindow.setPosition(workArea.x, workArea.y)
    } else {
      targetWindow.setPosition(workArea.x, workArea.y + workArea.height - height)
    }
    targetWindow.setSize(workArea.width, height)
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

function setupShortcuts(): void {
  if (!mainWindow) return

  const shortcutWindow = mainWindow
  const scopeKeys = new Map([
    ['1', 0],
    ['2', 1],
    ['3', 2],
    ['4', 3],
    ['5', 4],
    ['6', 5],
    ['7', 6],
    ['8', 7],
  ])
  const beforeInputHandler = (_event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown') {
      return
    }

    if (!input.alt && !input.control && !input.meta && !input.shift) {
      const scopeIndex = scopeKeys.get(input.key)
      if (scopeIndex !== undefined) {
        shortcutWindow.webContents.send('shortcut:toggle-scope', scopeIndex)
        return
      }

      if (input.key === 't') {
        const next = !shortcutWindow.isAlwaysOnTop()
        setAllWindowsAlwaysOnTop(next)
        shortcutWindow.webContents.send('window:always-on-top-changed', next)
        return
      }

      if (input.key === ' ') {
        shortcutWindow.webContents.send('shortcut:toggle-capture')
        return
      }
    }

    if (input.key === ',' && input.meta && !input.alt && !input.control && !input.shift) {
      shortcutWindow.webContents.send('shortcut:toggle-settings')
    }
  }

  shortcutWindow.webContents.on('before-input-event', beforeInputHandler)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    setupPermissions()
    void getAstraIntegrationService().initialize()
    setupIPC()
    createMainWindow()
    setupShortcuts()
    queueProfileOpenPaths(extractProfilePathsFromArgv(process.argv))
    queueThemeOpenPaths(extractThemePathsFromArgv(process.argv))
    void processPendingProfileOpenPaths()
    void processPendingThemeOpenPaths()
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueProfileOpenPath(filePath)
    queueThemeOpenPath(filePath)
    if (app.isReady()) {
      void processPendingProfileOpenPaths()
      void processPendingThemeOpenPaths()
    }
  })

  app.on('second-instance', (_event, argv) => {
    queueProfileOpenPaths(extractProfilePathsFromArgv(argv))
    queueThemeOpenPaths(extractThemePathsFromArgv(argv))
    if (app.isReady()) {
      focusMainWindow()
      void processPendingProfileOpenPaths()
      void processPendingThemeOpenPaths()
    }
  })
}

app.on('window-all-closed', () => {
  void astraIntegrationService?.dispose()
  app.quit()
})

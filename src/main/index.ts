import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions, OpenDialogOptions, WebContents } from 'electron'
import { extname, join, resolve } from 'path'
import type { CaptureBackendSupport, CaptureBackendSupportEntry } from '../types/capture'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
  WindowBounds,
} from '../types/popout'
import type { ProfileMenuRequest } from '../types/profileMenu'
import type { LegacyProfileMigrationPayload, Profile, ProfileLibrarySnapshot } from '../types/profile'
import { SCOPE_KINDS, type ScopeKind } from '../types/scope'
import { normalizeProfile } from '../shared/profileState'
import { FileBackedProfileLibrary } from './profileLibrary'

let mainWindow: BrowserWindow | null = null
let moveInterval: ReturnType<typeof setInterval> | null = null
let moveStartCursor: { x: number; y: number } | null = null
let moveStartPosition: number[] | null = null
let mainWindowBoundsTimer: ReturnType<typeof setTimeout> | null = null

const scopePopoutWindows = new Map<ScopeKind, BrowserWindow>()
const scopePopoutCloseAllowed = new Set<ScopeKind>()
const popoutBoundsTimers = new Map<ScopeKind, ReturnType<typeof setTimeout>>()
const windowSettingsHeights = new Map<number, number>()
const windowSettingsBottomAnchors = new Map<number, number>()
const pendingProfileOpenPaths: string[] = []

let profileLibrary: FileBackedProfileLibrary | null = null

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
    )
  }

  return profileLibrary
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
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

async function processPendingProfileOpenPaths(): Promise<void> {
  if (pendingProfileOpenPaths.length === 0) return

  const paths = [...pendingProfileOpenPaths]
  pendingProfileOpenPaths.length = 0

  let latestSnapshot: ProfileLibrarySnapshot | null = null

  for (const filePath of paths) {
    try {
      latestSnapshot = await getProfileLibrary().importProfileFromPath(filePath)
    } catch (error) {
      dialog.showErrorBox(
        'Could Not Open Profile',
        getErrorMessage(error, `Prism could not open ${filePath}.`),
      )
    }
  }

  if (!latestSnapshot || !mainWindow || mainWindow.isDestroyed()) return

  focusMainWindow()
  mainWindow.webContents.send('profiles:external-activated', latestSnapshot)
}

function scheduleMainWindowBoundsSave(window: BrowserWindow): void {
  if (!isMainRendererWindow(window)) return

  if (mainWindowBoundsTimer) {
    clearTimeout(mainWindowBoundsTimer)
  }

  mainWindowBoundsTimer = setTimeout(() => {
    mainWindowBoundsTimer = null
    if (window.isDestroyed()) return
    void getProfileLibrary().updateActiveProfileWindowBounds(toLogicalBounds(window))
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
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    roundedCorners: false,
    hasShadow: false,
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

  mainWindow.on('closed', () => {
    if (mainWindowBoundsTimer) {
      clearTimeout(mainWindowBoundsTimer)
      mainWindowBoundsTimer = null
    }
    if (mainWindow) {
      windowSettingsHeights.delete(mainWindow.id)
      windowSettingsBottomAnchors.delete(mainWindow.id)
    }
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
  if (!mainWindow || mainWindow.isDestroyed() || window.isDestroyed()) return

  const existingTimer = popoutBoundsTimers.get(kind)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    popoutBoundsTimers.delete(kind)

    if (!mainWindow || mainWindow.isDestroyed() || window.isDestroyed()) return
    const bounds = toLogicalBounds(window)
    void getProfileLibrary().updateActiveProfilePopoutBounds(kind, bounds)
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

  scopePopoutCloseAllowed.add(kind)
  scopePopoutWindows.delete(kind)

  if (!window.isDestroyed()) {
    window.close()
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

  const options: BrowserWindowConstructorOptions = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: POPOUT_DEFAULTS.minWidth,
    minHeight: POPOUT_DEFAULTS.minHeight,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    roundedCorners: false,
    hasShadow: false,
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

    const cursor = screen.getCursorScreenPoint()
    moveStartCursor = { x: cursor.x, y: cursor.y }
    moveStartPosition = targetWindow.getPosition()

    if (moveInterval) clearInterval(moveInterval)
    moveInterval = setInterval(() => {
      if (!targetWindow || targetWindow.isDestroyed() || !moveStartCursor || !moveStartPosition) return
      const current = screen.getCursorScreenPoint()
      const dx = current.x - moveStartCursor.x
      const dy = current.y - moveStartCursor.y
      targetWindow.setPosition(moveStartPosition[0] + dx, moveStartPosition[1] + dy)
    }, 16)
  })

  ipcMain.on('window:stop-move', () => {
    if (moveInterval) {
      clearInterval(moveInterval)
      moveInterval = null
    }
    moveStartCursor = null
    moveStartPosition = null
  })

  ipcMain.on('window:close', (event) => {
    getWindowFromSender(event.sender)?.close()
  })

  ipcMain.on('window:toggle-always-on-top', (event) => {
    const targetWindow = getWindowFromSender(event.sender)
    if (!targetWindow) return

    const current = targetWindow.isAlwaysOnTop()
    const next = !current
    if (isMainRendererWindow(targetWindow)) {
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

  const scopeKeys = ['1', '2', '3', '4', '5', '6', '7']
  scopeKeys.forEach((key) => {
    mainWindow!.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === key && !input.alt && !input.control && !input.meta && !input.shift) {
        mainWindow?.webContents.send('shortcut:toggle-scope', parseInt(key) - 1)
      }
    })
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 't' && !input.alt && !input.control && !input.meta && !input.shift) {
      const current = mainWindow!.isAlwaysOnTop()
      const next = !current
      setAllWindowsAlwaysOnTop(next)
      mainWindow!.webContents.send('window:always-on-top-changed', next)
    }
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === ' ' && !input.alt && !input.control && !input.meta && !input.shift) {
      mainWindow?.webContents.send('shortcut:toggle-capture')
    }
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === ',' && input.meta && !input.alt && !input.control && !input.shift) {
      mainWindow?.webContents.send('shortcut:toggle-settings')
    }
  })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    setupPermissions()
    setupIPC()
    createMainWindow()
    setupShortcuts()
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
  app.quit()
})

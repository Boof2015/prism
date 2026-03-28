import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import { join } from 'path'
import type { CaptureBackendSupport, CaptureBackendSupportEntry } from '../types/capture'

let mainWindow: BrowserWindow | null = null
let currentSettingsHeight = 0
let moveInterval: ReturnType<typeof setInterval> | null = null
let moveStartCursor: { x: number; y: number } | null = null
let moveStartPosition: number[] | null = null

const WINDOW_DEFAULTS = {
  width: 900,
  height: 180,
  minWidth: 400,
  minHeight: 100,
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...WINDOW_DEFAULTS,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
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
    mainWindow = null
    currentSettingsHeight = 0
  })

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

// Auto-grant media (microphone) permission for audio capture
function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true)
    } else {
      callback(false)
    }
  })
}

// IPC handlers
function setupIPC(): void {
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('window:start-move', () => {
    if (!mainWindow) return
    const cursor = screen.getCursorScreenPoint()
    moveStartCursor = { x: cursor.x, y: cursor.y }
    moveStartPosition = mainWindow.getPosition()

    if (moveInterval) clearInterval(moveInterval)
    moveInterval = setInterval(() => {
      if (!mainWindow || !moveStartCursor || !moveStartPosition) return
      const current = screen.getCursorScreenPoint()
      const dx = current.x - moveStartCursor.x
      const dy = current.y - moveStartCursor.y
      mainWindow.setPosition(moveStartPosition[0] + dx, moveStartPosition[1] + dy)
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

  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.on('window:toggle-always-on-top', () => {
    if (!mainWindow) return
    const current = mainWindow.isAlwaysOnTop()
    mainWindow.setAlwaysOnTop(!current)
    mainWindow.webContents.send('window:always-on-top-changed', !current)
  })

  ipcMain.handle('window:is-always-on-top', () => {
    return mainWindow?.isAlwaysOnTop() ?? true
  })

  ipcMain.handle('audio:get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources.map((s) => ({ id: s.id, name: s.name }))
  })

  ipcMain.handle('capture:get-backend-support', () => {
    return getCaptureBackendSupport()
  })

  ipcMain.on('window:set-bounds', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!mainWindow) return
    // Saved bounds are base (without settings). Add back current settings height so scopes stay the same size.
    mainWindow.setBounds({
      ...bounds,
      height: bounds.height + currentSettingsHeight,
    })
  })

  ipcMain.handle('window:get-bounds', () => {
    if (!mainWindow) return null
    const bounds = mainWindow.getBounds()
    // Strip settings height so we always save base bounds
    return {
      ...bounds,
      height: bounds.height - currentSettingsHeight,
    }
  })

  ipcMain.on('window:reposition', (_event, position: 'top' | 'bottom') => {
    if (!mainWindow) return
    const display = screen.getDisplayMatching(mainWindow.getBounds())
    const workArea = display.workArea
    const [, height] = mainWindow.getSize()

    if (position === 'top') {
      mainWindow.setPosition(workArea.x, workArea.y)
    } else {
      mainWindow.setPosition(workArea.x, workArea.y + workArea.height - height)
    }
    mainWindow.setSize(workArea.width, height)
  })

  ipcMain.on('window:expand-settings', (_event, panelHeight: number) => {
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    const [minW] = mainWindow.getMinimumSize()
    const newHeight = bounds.height + panelHeight
    mainWindow.setMinimumSize(minW, WINDOW_DEFAULTS.minHeight + panelHeight)

    // Check if expanding would push window off screen bottom
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const bottomEdge = bounds.y + newHeight
    if (bottomEdge > workArea.y + workArea.height) {
      const newY = Math.max(workArea.y, workArea.y + workArea.height - newHeight)
      mainWindow.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newHeight })
    } else {
      mainWindow.setSize(bounds.width, newHeight, true)
    }
    currentSettingsHeight = Math.max(0, currentSettingsHeight + Math.round(panelHeight))
  })

  ipcMain.on('window:collapse-settings', (_event, panelHeight: number) => {
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    const [minW] = mainWindow.getMinimumSize()
    const newHeight = Math.max(WINDOW_DEFAULTS.minHeight, bounds.height - panelHeight)
    mainWindow.setMinimumSize(minW, WINDOW_DEFAULTS.minHeight)

    // If window was pushed up when expanding, push it back down
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const wasAtBottom = bounds.y + bounds.height >= workArea.y + workArea.height - 10
    if (wasAtBottom) {
      const newY = Math.min(bounds.y + panelHeight, workArea.y + workArea.height - newHeight)
      mainWindow.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newHeight })
    } else {
      mainWindow.setSize(bounds.width, newHeight, true)
    }
    currentSettingsHeight = Math.max(0, currentSettingsHeight - Math.round(panelHeight))
  })

  ipcMain.on('window:set-settings-height', (_event, panelHeight: number) => {
    if (!mainWindow) return

    const nextHeight = Math.max(0, Math.round(panelHeight))
    const delta = nextHeight - currentSettingsHeight
    const [width, height] = mainWindow.getSize()
    const [minW] = mainWindow.getMinimumSize()

    mainWindow.setMinimumSize(minW, WINDOW_DEFAULTS.minHeight + nextHeight)
    if (delta !== 0) {
      const newHeight = Math.max(WINDOW_DEFAULTS.minHeight, height + delta)
      // If expanding near the bottom of the screen, move the window up so it doesn't go off-screen
      const bounds = mainWindow.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const workArea = display.workArea
      const bottomEdge = bounds.y + newHeight
      if (delta > 0 && bottomEdge > workArea.y + workArea.height) {
        const newY = Math.max(workArea.y, workArea.y + workArea.height - newHeight)
        mainWindow.setBounds({ x: bounds.x, y: newY, width, height: newHeight })
      } else if (delta < 0) {
        // Collapsing: if we moved the window up previously, move it back down
        const baseHeight = newHeight - nextHeight
        const naturalBottom = bounds.y + baseHeight
        if (naturalBottom < workArea.y + workArea.height) {
          // Push window down so it stays near the bottom
          const maxY = workArea.y + workArea.height - newHeight
          if (bounds.y < maxY) {
            mainWindow.setSize(width, newHeight, true)
          } else {
            mainWindow.setBounds({ x: bounds.x, y: maxY, width, height: newHeight })
          }
        } else {
          mainWindow.setSize(width, newHeight, true)
        }
      } else {
        mainWindow.setSize(width, newHeight, true)
      }
    }

    currentSettingsHeight = nextHeight
  })
}

function setupShortcuts(): void {
  if (!mainWindow) return

  // Scope toggles 1-7
  const scopeKeys = ['1', '2', '3', '4', '5', '6', '7']
  scopeKeys.forEach((key) => {
    mainWindow!.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === key && !input.alt && !input.control && !input.meta && !input.shift) {
        mainWindow?.webContents.send('shortcut:toggle-scope', parseInt(key) - 1)
      }
    })
  })

  // T = toggle always-on-top
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 't' && !input.alt && !input.control && !input.meta && !input.shift) {
      const current = mainWindow!.isAlwaysOnTop()
      mainWindow!.setAlwaysOnTop(!current)
      mainWindow!.webContents.send('window:always-on-top-changed', !current)
    }
  })

  // Space = toggle capture
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === ' ' && !input.alt && !input.control && !input.meta && !input.shift) {
      mainWindow?.webContents.send('shortcut:toggle-capture')
    }
  })

  // Comma (Cmd+,) = toggle settings
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === ',' && input.meta && !input.alt && !input.control && !input.shift) {
      mainWindow?.webContents.send('shortcut:toggle-settings')
    }
  })
}

app.whenReady().then(() => {
  setupPermissions()
  setupIPC()
  createWindow()
  setupShortcuts()
})

app.on('window-all-closed', () => {
  app.quit()
})

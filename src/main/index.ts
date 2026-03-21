import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null

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
    maximizable: false,
    fullscreenable: false,
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
  })

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

  ipcMain.on('window:expand-settings', (_event, panelHeight: number) => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    const [minW] = mainWindow.getMinimumSize()
    mainWindow.setMinimumSize(minW, WINDOW_DEFAULTS.minHeight + panelHeight)
    mainWindow.setSize(width, height + panelHeight, true)
  })

  ipcMain.on('window:collapse-settings', (_event, panelHeight: number) => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    const [minW] = mainWindow.getMinimumSize()
    mainWindow.setMinimumSize(minW, WINDOW_DEFAULTS.minHeight)
    mainWindow.setSize(width, Math.max(WINDOW_DEFAULTS.minHeight, height - panelHeight), true)
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

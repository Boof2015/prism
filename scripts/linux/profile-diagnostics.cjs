// Opt-in, development-only hook. It can instrument an existing checkout without edits:
// NODE_OPTIONS='--require=/absolute/path/profile-diagnostics.cjs' npm run dev
if (process.versions.electron && process.type === 'browser') {
  // NODE_OPTIONS runs before Electron registers its built-in module. Instrument
  // the first normal import, then immediately restore Node's loader.
  const Module = require('node:module')
  const originalLoad = Module._load
  Module._load = function (...args) {
    const result = originalLoad.apply(this, args)
    if (args[0] === 'electron' && result.app && result.ipcMain) {
      Module._load = originalLoad
      install(result)
    }
    return result
  }
}

function install({ app, ipcMain, Menu }) {
  const { statSync, accessSync, constants } = require('node:fs')
  const { join } = require('node:path')
  const trace = (stage, details = {}) => console.error('[profile-trace]', JSON.stringify({ time: new Date().toISOString(), stage, ...details }))
  trace('installed', { electron: process.versions.electron, platform: process.platform })

  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => originalHandle(channel, /^(profiles|dialog):/.test(channel)
    ? async (event, ...args) => {
      trace('invoke', { channel, sender: event.sender.id })
      try {
        const result = await listener(event, ...args)
        trace('resolved', { channel })
        return result
      } catch (error) {
        trace('rejected', { channel, error: String(error), stack: error?.stack })
        throw error
      }
    } : listener)

  const originalTemplate = Menu.buildFromTemplate.bind(Menu)
  Menu.buildFromTemplate = (template) => {
    const isProfileMenu = template.some((item) => item.label === 'Profiles')
    if (!isProfileMenu) return originalTemplate(template)
    trace('menu-built', { items: template.map((item) => item.label).filter(Boolean) })
    // Do not retain Menu instances: that could mask a native menu lifetime bug.
    return originalTemplate(template.map((item) => {
      if (!item.click) return item
      const click = item.click
      return { ...item, click: (...args) => { trace('menu-click', { label: item.label }); return click(...args) } }
    }))
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (event) => {
      const details = event
      if (details && typeof details.message === 'string') {
        trace('renderer-console', { sender: contents.id, level: details.level, message: details.message, source: details.sourceId, line: details.lineNumber })
      }
    })
    contents.on('preload-error', (_event, preloadPath, error) => trace('preload-error', { preloadPath, error: String(error) }))
    contents.on('render-process-gone', (_event, details) => trace('renderer-gone', details))
    contents.on('ipc-message', (_event, channel) => {
      if (/^(profile-menu|dialog):/.test(channel)) trace('renderer-send', { channel, sender: contents.id })
    })
    contents.on('did-finish-load', () => {
      void contents.executeJavaScript(`(() => {
        const api = window.electronAPI;
        if (!api) return 'no electronAPI';
        for (const name of ['onProfileMenuClosed', 'onProfileMenuLoad', 'onProfileMenuSaveNew', 'onProfileMenuSaveOverwrite', 'onProfileMenuRenameActive', 'onProfileMenuDeleteActive', 'onProfileMenuImport', 'onProfileMenuShowFolder']) {
          if (typeof api[name] === 'function') api[name](() => console.warn('[profile-trace] renderer-received ' + name));
        }
        console.warn('[profile-trace] document visibility=' + document.visibilityState + ' fonts=' + document.fonts.status);
        if (location.search.includes('dialog')) {
          requestAnimationFrame(() => console.warn('[profile-trace] dialog animation frame ran'));
        }
        return 'profile listeners attached';
      })()`).then((result) => trace('renderer-probe', { sender: contents.id, result }))
        .catch((error) => trace('renderer-probe-error', { error: String(error) }))
    })
  })

  app.on('browser-window-created', (_event, win) => {
    setTimeout(() => {
      if (!win.isDestroyed()) trace('window-state', { id: win.id, visible: win.isVisible(), bounds: win.getBounds(), url: win.webContents.getURL() })
    }, 2000).unref()
  })

  app.whenReady().then(() => {
    const paths = { documents: app.getPath('documents'), userData: app.getPath('userData') }
    paths.profiles = join(paths.documents, 'Prism Profiles')
    trace('environment', { ...paths, desktop: process.env.XDG_CURRENT_DESKTOP, session: process.env.XDG_SESSION_TYPE, display: process.env.DISPLAY, wayland: process.env.WAYLAND_DISPLAY, argv: process.argv })
    for (const [name, path] of Object.entries(paths)) {
      try {
        const stat = statSync(path)
        accessSync(path, constants.R_OK | constants.W_OK)
        trace('path-access', { name, path, writable: true, uid: stat.uid, mode: stat.mode.toString(8) })
      } catch (error) { trace('path-access', { name, path, error: String(error) }) }
    }
  })
}

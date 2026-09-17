import { BrowserWindow, screen } from 'electron'
import type { FileBackedWindowStateStore } from './windowStateStore'
import { loadNativeWindowDockingApi } from './nativeWindowDocking'
import { WindowDockingController } from './windowDockingController'
import { dockSettingsBounds } from '../shared/windowDocking'
import type { WindowBounds } from '../types/popout'
import type { WindowDockingPreferences, WindowDockingSnapshot } from '../types/windowDocking'

interface Dependencies {
  store: FileBackedWindowStateStore
  logicalBounds(window: BrowserWindow): WindowBounds
  prepare(window: BrowserWindow): void
  restore(window: BrowserWindow, bounds: WindowBounds): void
  changed(snapshot: WindowDockingSnapshot): void
  geometryChanging(): void
}

export class WindowDockingService {
  readonly controller: WindowDockingController
  private api = loadNativeWindowDockingApi()
  private window: BrowserWindow | null = null
  private panel: BrowserWindow | null = null
  private panelHeight = 400
  private rendererReady = false
  private fullscreen = false
  private fullscreenTimer: ReturnType<typeof setInterval> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private restoreTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave: WindowDockingPreferences | null = null
  private saving: Promise<void> = Promise.resolve()
  private lastSnapshot = ''
  private messages = this.api?.messages()
  private managed = false

  constructor(private deps: Dependencies) {
    this.controller = new WindowDockingController({
      supported: Boolean(this.api),
      bounds: () => this.controller.ownsGeometry ? this.window!.getBounds() : deps.logicalBounds(this.window!),
      displays: () => screen.getAllDisplays().map(display => this.currentDisplay(display)),
      primaryDisplay: () => this.currentDisplay(screen.getPrimaryDisplay()),
      matchingDisplay: bounds => this.currentDisplay(screen.getDisplayMatching(bounds)),
      presented: () => Boolean(this.window && !this.window.isDestroyed() && this.rendererReady
        && this.window.isVisible() && !this.window.isMinimized()),
      reserve: (display, edge, height) => {
        if (!this.window || !this.api) throw new Error('Windows docking is unavailable.')
        if (this.restoreTimer) clearTimeout(this.restoreTimer)
        this.restoreTimer = null
        deps.geometryChanging()
        const nativeHandle = this.window.getNativeWindowHandle()
        if (!this.api.register(nativeHandle)) throw new Error('Windows could not register Prism as a desktop bar.')
        const target = screen.getAllDisplays().find(item => item.id === display.id)!
        const rectangle = this.api.position(nativeHandle, edge,
          screen.dipToScreenRect(null, display.bounds), Math.round(height * target.scaleFactor))
        if (!rectangle) throw new Error('Windows could not reserve space for Prism.')
        const bounds = screen.screenToDipRect(null, rectangle)
        const current = this.window.getBounds()
        if (current.x !== bounds.x || current.y !== bounds.y
          || current.width !== bounds.width || current.height !== bounds.height) {
          this.window.setBounds(bounds)
        }
        this.positionPanel()
        this.updateFullscreen()
      },
      release: () => {
        if (this.controller.ownsGeometry) deps.geometryChanging()
        if (this.window && !this.window.isDestroyed()) this.api?.remove(this.window.getNativeWindowHandle())
      },
      managed: enabled => this.setManaged(enabled),
      restore: bounds => {
        const window = this.window
        if (this.restoreTimer) clearTimeout(this.restoreTimer)
        // Chromium may consume the first SetBounds while handling ABM_REMOVE.
        // Verify the actual HWND bounds and retry after the shell update settles.
        let attempts = 0
        const restore = (): void => {
          this.restoreTimer = null
          if (window && window === this.window && !window.isDestroyed() && !this.controller.ownsGeometry) {
            deps.restore(window, bounds)
            const actual = window.getBounds()
            if (++attempts < 4 && (actual.x !== bounds.x || actual.y !== bounds.y
              || actual.width !== bounds.width || actual.height !== bounds.height)) {
              this.restoreTimer = setTimeout(restore, 30)
            }
          }
        }
        this.restoreTimer = setTimeout(restore, 0)
      },
      closeSettings: () => this.closeSettings(),
      changed: snapshot => {
        const serialized = JSON.stringify(snapshot)
        if (serialized === this.lastSnapshot) return
        this.lastSnapshot = serialized
        this.send('window:docking-changed', snapshot)
        deps.changed(snapshot)
      },
      persist: preferences => {
        this.pendingSave = preferences
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => { void this.flush() }, 100)
      },
    }, deps.store.getDocking())
    screen.on('display-added', this.schedule)
    screen.on('display-removed', this.schedule)
    screen.on('display-metrics-changed', this.schedule)
  }

  private send(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  private setManaged(enabled: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (enabled !== this.managed) {
      this.managed = enabled
      if (enabled) {
        this.deps.prepare(window)
        if (window.isFullScreen()) window.setFullScreen(false)
        if (window.isMaximized()) window.unmaximize()
      }
      window.setMovable(!enabled)
      // The native subclass blocks resize hit-testing/system commands. Keep
      // Electron's programmatic size constraints free for resizing and restore.
      window.setMaximizable(!enabled)
      window.setFullScreenable(!enabled)
    }
    const top = enabled ? !this.fullscreen : this.deps.store.getMainAlwaysOnTop()
    if (window.isAlwaysOnTop() !== top) window.setAlwaysOnTop(top)
    this.send('window:always-on-top-changed', top)
    if (this.panel && !this.panel.isDestroyed()) this.panel.setAlwaysOnTop(top)
  }

  private schedule = (): void => {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.controller.resume()
      this.positionPanel()
    }, 30)
  }

  private updateFullscreen = (): void => {
    const window = this.window
    if (!window || window.isDestroyed() || !this.controller.ownsGeometry) return
    const fullscreen = Boolean(this.api?.fullscreen(window.getNativeWindowHandle()))
    if (fullscreen === this.fullscreen) return
    this.fullscreen = fullscreen
    this.setManaged(true)
    if (fullscreen) {
      if (this.panel && !this.panel.isDestroyed()) this.api?.lower(this.panel.getNativeWindowHandle())
      this.api?.lower(window.getNativeWindowHandle())
    }
  }

  private currentDisplay(display: Electron.Display): Electron.Display {
    // Electron's display cache updates asynchronously after ABM_REMOVE.
    const rectangle = this.api?.workArea(screen.dipToScreenRect(null, display.bounds))
    return rectangle ? { ...display, workArea: screen.screenToDipRect(null, rectangle) } : display
  }

  workAreas(): WindowBounds[] {
    return screen.getAllDisplays().map(display => this.currentDisplay(display).workArea)
  }

  attach(window: BrowserWindow): void {
    this.window = window
    this.rendererReady = false
    this.managed = false
    this.fullscreen = false
    if (this.fullscreenTimer) clearInterval(this.fullscreenTimer)
    // Foreground borderless fullscreen is not reliably announced by Explorer.
    if (this.api) this.fullscreenTimer = setInterval(this.updateFullscreen, 250)
    if (this.messages) {
      window.hookWindowMessage(this.messages.callback, (wParam, lParam) => {
        const code = wParam.readUInt32LE(0)
        if (code === 1) this.schedule() // ABN_POSCHANGED
        if (code === 2) { // ABN_FULLSCREENAPP
          // Read current state as well: some shell versions omit the matching
          // exit notification when a fullscreen window is destroyed.
          this.updateFullscreen()
        }
        if (code === 3) { // ABN_WINDOWARRANGE: preserve the reservation while excluded from tiling.
          if (lParam.readUInt32LE(0)) this.closeSettings()
          this.schedule()
        }
      })
      window.hookWindowMessage(this.messages.taskbarCreated, () => {
        if (this.controller.ownsGeometry) this.controller.shellRestarted()
      })
      window.hookWindowMessage(0x02e0, this.schedule) // WM_DPICHANGED
    }
    window.on('hide', () => this.controller.suspend())
    window.on('minimize', () => this.controller.suspend())
    window.on('show', this.schedule)
    window.on('restore', this.schedule)
    // Windows can fit the HWND into the new work area after a shell change.
    // Reapply only if the actual bounds differ from the negotiated rectangle.
    window.on('move', () => { if (this.controller.ownsGeometry) this.schedule() })
    window.on('resize', () => { if (this.controller.ownsGeometry) this.schedule() })
    window.on('will-move', event => { if (this.controller.ownsGeometry) event.preventDefault() })
    window.on('will-resize', event => { if (this.controller.ownsGeometry) event.preventDefault() })
    window.webContents.on('did-start-loading', () => {
      this.rendererReady = false
      this.controller.suspend()
    })
    window.webContents.on('render-process-gone', () => {
      this.rendererReady = false
      this.controller.suspend()
    })
    window.once('closed', () => {
      this.controller.suspend()
      this.window = null
      this.managed = false
      if (this.fullscreenTimer) clearInterval(this.fullscreenTimer)
      this.fullscreenTimer = null
    })
    this.installSettingsWindow(window)
    this.controller.resume()
  }

  ready(): void {
    this.rendererReady = true
    this.controller.resume()
    this.send('window:docking-changed', this.controller.snapshot)
  }

  closeSettings(): void {
    if (this.panel && !this.panel.isDestroyed()) this.panel.close()
    this.panel = null
    this.send('window:docked-settings-closed')
  }

  private installSettingsWindow(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url, frameName }) => {
      if (url !== 'about:blank' || frameName !== 'prism-docked-settings'
        || !this.controller.snapshot.active || this.panel) return { action: 'deny' }
      return { action: 'allow', overrideBrowserWindowOptions: {
        parent: window, frame: false, show: false, skipTaskbar: true,
        resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, alwaysOnTop: !this.fullscreen,
        backgroundColor: '#080a0e', title: 'Prism settings',
      } }
    })
    window.webContents.on('did-create-window', (panel, details) => {
      if (details.frameName !== 'prism-docked-settings') return
      this.panel = panel
      panel.webContents.on('will-navigate', event => event.preventDefault())
      panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      panel.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); this.closeSettings() }
      })
      panel.once('closed', () => {
        if (this.panel === panel) this.panel = null
        this.send('window:docked-settings-closed')
      })
      this.positionPanel()
    })
  }

  showSettings(height: number): boolean {
    if (!this.panel || this.panel.isDestroyed() || !this.controller.snapshot.active || !Number.isFinite(height)) return false
    this.panelHeight = Math.max(1, height)
    this.positionPanel()
    if (!this.panel.isVisible()) { this.panel.show(); this.panel.focus() }
    return true
  }

  private positionPanel(): void {
    if (!this.panel || this.panel.isDestroyed() || !this.window || this.window.isDestroyed()) return
    const snapshot = this.controller.snapshot
    const selected = screen.getAllDisplays().find(item => item.id === snapshot.displayId)
    const display = selected && this.currentDisplay(selected)
    if (!display) return
    this.panel.setBounds(dockSettingsBounds(this.window.getBounds(), display.workArea, snapshot.edge, this.panelHeight))
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const preferences = this.pendingSave
    this.pendingSave = null
    if (preferences) {
      this.saving = this.saving.then(() => this.deps.store.setDocking(preferences))
        .catch(error => { console.warn('Could not save window docking:', error) })
    }
    await this.saving
  }

  shutdown(): Promise<void> {
    this.rendererReady = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.restoreTimer) clearTimeout(this.restoreTimer)
    this.restoreTimer = null
    if (this.fullscreenTimer) clearInterval(this.fullscreenTimer)
    this.fullscreenTimer = null
    screen.removeListener('display-added', this.schedule)
    screen.removeListener('display-removed', this.schedule)
    screen.removeListener('display-metrics-changed', this.schedule)
    this.controller.suspend()
    return this.flush()
  }
}

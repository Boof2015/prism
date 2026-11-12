import type { WindowBounds } from '../types/popout'
import type { MainWindowSettingsLayout, MainWindowSettingsRequest } from '../types/mainWindowSettings'
import { normalizeMainWindowSettingsRequest, resolveMainWindowSettingsLayout } from '../shared/windowGeometry'

interface Host {
  bounds(): WindowBounds
  normalBounds(): WindowBounds
  workAreas(): WindowBounds[]
  zoomFactor(): number
  chromeHeight(): number
  maximized(): boolean
  fullScreen(): boolean
  setBounds(bounds: WindowBounds): void
  setMinimumHeight(height: number): void
  publish(layout: MainWindowSettingsLayout): void
}

function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Keeps temporary settings geometry out of profile/window persistence. */
export class MainWindowSettingsController {
  private logical: WindowBounds
  private previous: WindowBounds
  private request: MainWindowSettingsRequest = { panelHeight: 0, bottomBarHeight: 0 }
  private viewportHeight: number | undefined
  private applying = false
  private automaticallyMaximized = false
  private wasFixed: boolean
  private modeChangeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private host: Host) {
    this.logical = host.bounds()
    this.previous = { ...this.logical }
    this.wasFixed = this.isFixed()
  }

  get logicalBounds(): WindowBounds { return { ...this.logical } }
  get open(): boolean { return this.request.panelHeight > 0 }

  private isFixed(): boolean {
    return this.host.fullScreen() || (this.host.maximized() && !this.automaticallyMaximized)
  }

  setRequest(raw: unknown): boolean {
    const request = normalizeMainWindowSettingsRequest(raw)
    if (!request) return false
    if (!this.open && request.panelHeight === 0) {
      this.host.publish({ settingsHeight: 0 })
      return true
    }
    if (this.open !== (request.panelHeight > 0)) this.viewportHeight = undefined
    this.request = request
    this.refresh()
    return true
  }

  /** Docking takes over native geometry; discard floating settings without resizing. */
  reset(): void {
    this.dispose()
    this.request = { panelHeight: 0, bottomBarHeight: 0 }
    this.viewportHeight = undefined
    this.host.publish({ settingsHeight: 0 })
  }

  setLogicalBounds(bounds: WindowBounds): void {
    this.logical = { ...bounds }
    this.viewportHeight = undefined
    this.refresh()
  }

  geometryChanged(): void {
    if (this.applying) return
    const bounds = this.host.bounds()
    const fixed = this.isFixed()
    if (this.modeChangeTimer || fixed !== this.wasFixed) {
      this.modeChanged()
      return
    }
    if (sameBounds(bounds, this.previous) && fixed === this.wasFixed) return
    if (!fixed && !this.wasFixed) {
      if (this.open) {
        this.logical = {
          ...this.logical,
          x: this.logical.x + bounds.x - this.previous.x,
          y: this.logical.y + bounds.y - this.previous.y,
          width: bounds.width,
        }
        if (bounds.height !== this.previous.height) this.viewportHeight = bounds.height
      } else {
        this.logical = { ...bounds }
      }
    }
    this.wasFixed = fixed
    this.previous = bounds
    if (this.open) this.refresh()
  }

  modeChanged(event?: 'maximize' | 'unmaximize' | 'enter-full-screen' | 'leave-full-screen'): void {
    if (this.applying) return
    // A delayed native notification for our own screen-filling resize is not
    // a request to keep settings' temporary height when they close.
    if (event === 'maximize' && this.automaticallyMaximized
      && sameBounds(this.host.bounds(), this.previous)) return
    if (!this.open && (event === 'maximize' || event === 'enter-full-screen')) {
      // Native zoom animations can deliver intermediate resize events before
      // their mode event. Recover the real restore bounds instead of saving a frame.
      this.logical = this.host.normalBounds()
    }
    if (event === 'maximize' || event === 'unmaximize') this.automaticallyMaximized = false
    // macOS can emit unmaximize before restoring the old expanded bounds. Wait
    // for that native geometry burst to finish before restoring the closed size.
    clearTimeout(this.modeChangeTimer)
    this.modeChangeTimer = setTimeout(() => {
      this.modeChangeTimer = undefined
      this.refresh()
    }, 100)
    this.refresh()
  }

  dispose(): void {
    clearTimeout(this.modeChangeTimer)
    this.modeChangeTimer = undefined
  }

  refresh(): void {
    if (this.applying) return
    const options = {
      logicalBounds: this.logical,
      request: this.request,
      workAreas: this.host.workAreas(),
      zoomFactor: this.host.zoomFactor(),
      chromeHeight: this.host.chromeHeight(),
      viewportHeight: this.viewportHeight,
      fixedBounds: this.isFixed() || this.modeChangeTimer ? this.host.bounds() : undefined,
    }
    const layout = resolveMainWindowSettingsLayout(options)
    this.applying = true
    try {
      this.host.setMinimumHeight(layout.minimumHeight)
      if (!options.fixedBounds && !sameBounds(this.host.bounds(), layout.bounds)) {
        this.host.setBounds(layout.bounds)
      }
      if (!options.fixedBounds) {
        // AppKit can report isMaximized() solely because setBounds filled the
        // work area, without emitting a maximize event. Keep owning that size.
        this.automaticallyMaximized = this.host.maximized() && !this.host.fullScreen()
      }
      this.previous = this.host.bounds()
      this.wasFixed = this.isFixed()
      // Some window managers constrain/round requested bounds. Render into what exists.
      const actual = resolveMainWindowSettingsLayout({ ...options, fixedBounds: this.previous })
      this.host.publish({ settingsHeight: actual.settingsHeight })
    } finally {
      this.applying = false
    }
  }
}

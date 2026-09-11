import type { WindowBounds } from '../types/popout'
import type { DockEdge, WindowDockingPreferences, WindowDockingSnapshot } from '../types/windowDocking'
import { fitFloatingBounds, normalizeWindowDocking } from '../shared/windowDocking'

export interface DockDisplay { id: number; bounds: WindowBounds; workArea: WindowBounds }
export interface DockingHost {
  supported: boolean
  bounds(): WindowBounds
  displays(): DockDisplay[]
  primaryDisplay(): DockDisplay
  matchingDisplay(bounds: WindowBounds): DockDisplay
  presented(): boolean
  reserve(display: DockDisplay, edge: DockEdge, height: number): void
  release(): void
  managed(enabled: boolean): void
  restore(bounds: WindowBounds): void
  closeSettings(): void
  changed(snapshot: WindowDockingSnapshot): void
  persist(preferences: WindowDockingPreferences): void
}

/** Owns requested docking independently of whether a visible HWND reserves space. */
export class WindowDockingController {
  private preferences: WindowDockingPreferences
  private active = false
  private error: string | null = null
  private updating = false

  constructor(private host: DockingHost, initial: unknown) {
    this.preferences = normalizeWindowDocking(initial)
  }

  get snapshot(): WindowDockingSnapshot {
    return { ...structuredClone(this.preferences), enabled: this.ownsGeometry,
      supported: this.host.supported, active: this.active, error: this.error }
  }

  /** Also guards geometry persistence during hidden/restoring/recreated states. */
  get ownsGeometry(): boolean { return this.host.supported && this.preferences.enabled }

  private publish(persist = false): void {
    if (persist) this.host.persist(structuredClone(this.preferences))
    this.host.changed(this.snapshot)
  }

  setEnabled(enabled: boolean): void {
    if (!this.host.supported || enabled === this.preferences.enabled) return
    this.error = null
    this.host.closeSettings()
    if (enabled) {
      const bounds = this.host.bounds()
      this.preferences = { ...this.preferences, enabled: true,
        floatingBounds: bounds, height: bounds.height,
        displayId: this.host.matchingDisplay(bounds).id }
      this.host.managed(true)
      this.resume()
    } else {
      this.suspend()
      this.preferences.enabled = false
      this.host.managed(false)
      this.restoreFloating()
    }
    this.publish(true)
  }

  setEdge(edge: DockEdge): void {
    this.preferences.edge = edge
    if (this.ownsGeometry) this.resume()
    this.publish(true)
  }

  resize(height: number): void {
    if (!this.ownsGeometry || !Number.isFinite(height)) return
    const display = this.host.displays().find(item => item.id === this.preferences.displayId)
    if (!display) { this.resume(); return }
    // The shell may reduce this further to accommodate other bars.
    this.preferences.height = Math.min(Math.max(100, Math.round(height)), display.bounds.height)
    this.resume()
    this.publish(true)
  }

  suspend(): void {
    this.host.closeSettings()
    this.host.release()
    this.active = false
    this.publish()
  }

  resume(): void {
    if (!this.ownsGeometry || this.updating) return
    const display = this.host.displays().find(item => item.id === this.preferences.displayId)
    if (!display) {
      this.suspend()
      this.preferences.enabled = false
      this.host.managed(false)
      this.restoreFloating(this.host.primaryDisplay())
      this.publish(true)
      return
    }
    this.host.managed(true)
    if (!this.host.presented()) return
    this.updating = true
    try {
      this.host.reserve(display, this.preferences.edge, this.preferences.height)
      this.active = true
      this.error = null
    } catch (error) {
      this.host.release()
      this.active = false
      this.preferences.enabled = false
      this.host.managed(false)
      this.restoreFloating()
      this.error = error instanceof Error ? error.message : 'Prism could not reserve screen space.'
      this.host.persist(structuredClone(this.preferences))
    } finally {
      this.updating = false
      this.publish()
    }
  }

  shellRestarted(): void { this.suspend(); this.resume() }

  undockForDrag(cursor: { x: number; y: number }): WindowBounds | undefined {
    if (!this.ownsGeometry) return
    const dock = this.host.bounds()
    const floating = this.preferences.floatingBounds ?? dock
    const grabFraction = Math.max(0, Math.min(1, (cursor.x - dock.x) / dock.width))
    this.setEnabled(false)
    const display = this.host.matchingDisplay({ x: cursor.x, y: cursor.y, width: 1, height: 1 })
    const restored = fitFloatingBounds({ ...floating,
      x: Math.round(cursor.x - floating.width * grabFraction),
      y: Math.round(cursor.y - Math.min(24, Math.max(0, cursor.y - dock.y))),
    }, display.workArea)
    this.host.restore(restored)
    return restored
  }

  private restoreFloating(display?: DockDisplay): void {
    const bounds = this.preferences.floatingBounds ?? this.host.bounds()
    this.host.restore(fitFloatingBounds(bounds, (display ?? this.host.matchingDisplay(bounds)).workArea))
  }
}

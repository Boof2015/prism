import assert from 'node:assert/strict'
import test from 'node:test'
import { WindowDockingController, type DockDisplay, type DockingHost } from '../src/main/windowDockingController'
import { DockingGeometryGuard } from '../src/main/dockingGeometryGuard'
import { dockSettingsBounds, normalizeWindowDocking } from '../src/shared/windowDocking'
import type { WindowDockingPreferences } from '../src/types/windowDocking'

const floating = { x: 100, y: 150, width: 900, height: 180 }

test('shell-induced popout resizing does not dirty profiles, but deliberate moves still persist', () => {
  let time = 1000
  const guard = new DockingGeometryGuard(() => time)
  assert.equal(guard.shouldPersist(1, false), true)
  guard.systemChange()
  assert.equal(guard.shouldPersist(1, true), false)
  guard.userChange(1)
  assert.equal(guard.shouldPersist(1, true), true)
  assert.equal(guard.shouldPersist(2, true), false)
  time += 1000
  assert.equal(guard.shouldPersist(1, true), false)
  guard.systemChange() // Undocking may asynchronously resize other windows, too.
  assert.equal(guard.shouldPersist(1, false), false)
  time += 1000
  assert.equal(guard.shouldPersist(1, false), true)
})
const primary: DockDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const secondary: DockDisplay = { id: 2, bounds: { x: -2560, y: -200, width: 2560, height: 1440 },
  workArea: { x: -2560, y: -200, width: 2560, height: 1400 } }

function harness(initial?: unknown, supported = true) {
  let bounds = { ...floating }
  let displays = [primary, secondary]
  let presented = true
  let reserved = false
  let fail = false
  let managed = false
  let reservations = 0
  let saved: WindowDockingPreferences | undefined
  const host: DockingHost = {
    supported, bounds: () => ({ ...bounds }), displays: () => displays,
    primaryDisplay: () => primary,
    matchingDisplay: rect => rect.x < 0 ? secondary : primary,
    presented: () => presented,
    reserve: (display, edge, height) => {
      reservations++
      reserved = true
      if (fail) throw new Error('Registration failed')
      bounds = { ...display.workArea, height,
        y: edge === 'top' ? display.workArea.y : display.workArea.y + display.workArea.height - height }
    },
    release: () => { reserved = false },
    managed: value => { managed = value },
    restore: value => { bounds = value },
    closeSettings: () => {}, changed: () => {}, persist: value => { saved = value },
  }
  const controller = new WindowDockingController(host, initial)
  return { controller, host, get bounds() { return bounds }, get saved() { return saved },
    get reserved() { return reserved }, get managed() { return managed }, get reservations() { return reservations },
    hide: () => { presented = false; controller.suspend() },
    show: () => { presented = true; controller.resume() },
    disconnect: () => { displays = [primary]; controller.resume() },
    fail: () => { fail = true },
  }
}

test('docking normalization defaults off and rejects invalid remembered geometry', () => {
  assert.deepEqual(normalizeWindowDocking(undefined), {
    enabled: false, edge: 'bottom', displayId: null, height: 180, floatingBounds: undefined,
  })
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(normalizeWindowDocking({ enabled: true, displayId: 1, floatingBounds: { ...floating, x: value } }).enabled, false)
  }
  assert.equal(normalizeWindowDocking({ enabled: true, floatingBounds: floating }).enabled, false)
  assert.equal(normalizeWindowDocking({ height: -20 }).height, 100)
})

test('docking captures floating bounds, resizes the strip, then restores the original rectangle', () => {
  const h = harness()
  h.controller.setEnabled(true)
  assert.equal(h.reserved, true)
  assert.equal(h.managed, true)
  assert.equal(h.bounds.y, 860)
  h.controller.resize(250)
  h.controller.setEdge('top')
  assert.deepEqual(h.bounds, { x: 0, y: 0, width: 1920, height: 250 })
  assert.deepEqual(h.saved?.floatingBounds, floating)
  h.controller.setEnabled(false)
  assert.equal(h.reserved, false)
  assert.equal(h.managed, false)
  assert.deepEqual(h.bounds, floating)
})

test('hide/show releases and reacquires without clearing intent or exposing dock geometry to profiles', () => {
  const h = harness()
  h.controller.setEnabled(true)
  h.hide()
  assert.equal(h.controller.snapshot.active, false)
  assert.equal(h.controller.ownsGeometry, true)
  assert.equal(h.controller.snapshot.enabled, true)
  assert.equal(h.reserved, false)
  h.controller.resume() // A work-area notification arriving while hidden.
  assert.equal(h.reserved, false)
  h.show()
  assert.equal(h.controller.snapshot.active, true)
  assert.deepEqual(h.controller.snapshot.floatingBounds, floating)
})

test('remembered docking waits for presentation, then survives shell restart', () => {
  const h = harness({ enabled: true, edge: 'top', displayId: 1, height: 120, floatingBounds: floating })
  h.hide()
  h.controller.resume()
  assert.equal(h.reservations, 0)
  h.show()
  assert.equal(h.bounds.height, 120)
  h.controller.shellRestarted()
  assert.equal(h.reservations, 2)
  assert.equal(h.controller.snapshot.active, true)
})

test('missing monitor disables docking and fits the floating rack onto the primary screen', () => {
  const h = harness({ enabled: true, edge: 'bottom', displayId: 2, height: 180,
    floatingBounds: { ...floating, x: -2000 } })
  h.controller.resume()
  h.disconnect()
  assert.equal(h.controller.snapshot.enabled, false)
  assert.equal(h.reserved, false)
  assert.equal(h.bounds.x, 0)
  assert.equal(h.saved?.enabled, false)
  h.controller.resume()
  assert.equal(h.reserved, false)
})

test('reservation failure rolls back managed flags and floating bounds', () => {
  const h = harness()
  h.fail()
  h.controller.setEnabled(true)
  assert.equal(h.controller.snapshot.enabled, false)
  assert.equal(h.controller.snapshot.error, 'Registration failed')
  assert.equal(h.reserved, false)
  assert.equal(h.managed, false)
  assert.deepEqual(h.bounds, floating)
})

test('drag-undock keeps the pointer over the restored rack', () => {
  const h = harness()
  h.controller.setEnabled(true)
  h.controller.undockForDrag({ x: 960, y: 880 })
  assert.deepEqual(h.bounds, { x: 510, y: 860, width: 900, height: 180 })
  assert.equal(h.reserved, false)
  assert.equal(h.controller.snapshot.enabled, false)
})

test('unsupported native capability does not take ownership of profile geometry', () => {
  const h = harness({ enabled: true, displayId: 1, floatingBounds: floating }, false)
  h.controller.resume()
  h.controller.setEnabled(true)
  assert.equal(h.controller.ownsGeometry, false)
  assert.equal(h.reserved, false)
})

test('dock resize remains on screen and preserves the floating restore rectangle', () => {
  const h = harness()
  h.controller.setEnabled(true)
  h.controller.resize(-10)
  assert.equal(h.bounds.height, 100)
  h.controller.resize(Infinity)
  assert.equal(h.bounds.height, 100)
  h.controller.resize(5000)
  assert.equal(h.controller.snapshot.height, primary.bounds.height)
  assert.deepEqual(h.saved?.floatingBounds, floating)
})

test('settings occupy only the workspace next to either dock and clamp their viewport', () => {
  assert.deepEqual(dockSettingsBounds({ x: 0, y: 0, width: 1920, height: 180 },
    { x: 0, y: 180, width: 1920, height: 860 }, 'top', 400),
  { x: 0, y: 180, width: 1920, height: 400 })
  assert.deepEqual(dockSettingsBounds({ x: -2560, y: 1020, width: 2560, height: 180 },
    { x: -2560, y: -200, width: 2560, height: 1220 }, 'bottom', 2000),
  { x: -2560, y: -200, width: 2560, height: 1220 })
})

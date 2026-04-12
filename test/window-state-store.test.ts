import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { FileBackedWindowStateStore } from '../src/main/windowStateStore'
import {
  WINDOW_LOCAL_STATE_FORMAT,
  WINDOW_LOCAL_STATE_VERSION,
} from '../src/types/windowState'

async function createHarness(): Promise<{
  cleanup: () => Promise<void>
  localStatePath: string
  rootDir: string
  store: FileBackedWindowStateStore
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-window-state-'))
  const localStatePath = join(rootDir, 'userData', 'window-state.json')

  return {
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    localStatePath,
    rootDir,
    store: new FileBackedWindowStateStore(localStatePath),
  }
}

test('window state defaults to unpinned when no local state file exists', async () => {
  const harness = await createHarness()

  try {
    await harness.store.initialize()

    assert.equal(harness.store.getMainAlwaysOnTop(), false)
    assert.equal(harness.store.getPopoutAlwaysOnTop('spectrum'), false)
    assert.equal(harness.store.getPopoutAlwaysOnTop('waveform'), false)
  } finally {
    await harness.cleanup()
  }
})

test('main window always-on-top persists immediately and survives reload', async () => {
  const harness = await createHarness()

  try {
    await harness.store.initialize()
    await harness.store.setMainAlwaysOnTop(true)

    const saved = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      format: string
      version: number
      mainAlwaysOnTop: boolean
    }
    assert.equal(saved.format, WINDOW_LOCAL_STATE_FORMAT)
    assert.equal(saved.version, WINDOW_LOCAL_STATE_VERSION)
    assert.equal(saved.mainAlwaysOnTop, true)

    const reloaded = new FileBackedWindowStateStore(harness.localStatePath)
    await reloaded.initialize()
    assert.equal(reloaded.getMainAlwaysOnTop(), true)
  } finally {
    await harness.cleanup()
  }
})

test('popout always-on-top persists independently per scope kind', async () => {
  const harness = await createHarness()

  try {
    await harness.store.initialize()
    await harness.store.setMainAlwaysOnTop(true)
    await harness.store.setPopoutAlwaysOnTop('spectrum', true)

    const reloaded = new FileBackedWindowStateStore(harness.localStatePath)
    await reloaded.initialize()

    assert.equal(reloaded.getMainAlwaysOnTop(), true)
    assert.equal(reloaded.getPopoutAlwaysOnTop('spectrum'), true)
    assert.equal(reloaded.getPopoutAlwaysOnTop('waveform'), false)
  } finally {
    await harness.cleanup()
  }
})

test('now playing config window bounds persist immediately and survive reload', async () => {
  const harness = await createHarness()

  try {
    await harness.store.initialize()
    await harness.store.setNowPlayingConfigWindowBounds({ x: 120, y: 80, width: 720, height: 560 })

    const saved = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      nowPlayingConfigWindowBounds?: {
        x: number
        y: number
        width: number
        height: number
      }
    }
    assert.deepEqual(saved.nowPlayingConfigWindowBounds, { x: 120, y: 80, width: 720, height: 560 })

    const reloaded = new FileBackedWindowStateStore(harness.localStatePath)
    await reloaded.initialize()
    assert.deepEqual(reloaded.getNowPlayingConfigWindowBounds(), { x: 120, y: 80, width: 720, height: 560 })
  } finally {
    await harness.cleanup()
  }
})

test('turning a popout pin back off clears its saved local state without affecting others', async () => {
  const harness = await createHarness()

  try {
    await harness.store.initialize()
    await harness.store.setPopoutAlwaysOnTop('spectrum', true)
    await harness.store.setPopoutAlwaysOnTop('waveform', true)
    await harness.store.setPopoutAlwaysOnTop('spectrum', false)

    const saved = JSON.parse(await readFile(harness.localStatePath, 'utf8')) as {
      popoutAlwaysOnTop: Record<string, boolean | undefined>
    }
    assert.equal(saved.popoutAlwaysOnTop.spectrum, undefined)
    assert.equal(saved.popoutAlwaysOnTop.waveform, true)

    const reloaded = new FileBackedWindowStateStore(harness.localStatePath)
    await reloaded.initialize()
    assert.equal(reloaded.getPopoutAlwaysOnTop('spectrum'), false)
    assert.equal(reloaded.getPopoutAlwaysOnTop('waveform'), true)
  } finally {
    await harness.cleanup()
  }
})

test('invalid saved window state normalizes to supported keys and boolean values', async () => {
  const harness = await createHarness()

  try {
    await mkdir(dirname(harness.localStatePath), { recursive: true })
    await writeFile(harness.localStatePath, `${JSON.stringify({
      format: 'unexpected',
      version: 99,
      mainAlwaysOnTop: true,
      popoutAlwaysOnTop: {
        spectrum: true,
        astra: true,
        waveform: 'yes',
        invalid_scope: true,
      },
      nowPlayingConfigWindowBounds: {
        x: 12.4,
        y: 18.7,
        width: 640.2,
        height: 420.9,
      },
    }, null, 2)}\n`, 'utf8')

    await harness.store.initialize()

    assert.equal(harness.store.getMainAlwaysOnTop(), true)
    assert.equal(harness.store.getPopoutAlwaysOnTop('spectrum'), true)
    assert.equal(harness.store.getPopoutAlwaysOnTop('nowPlaying'), true)
    assert.equal(harness.store.getPopoutAlwaysOnTop('waveform'), false)
    assert.equal(harness.store.getPopoutAlwaysOnTop('oscilloscope'), false)
    assert.deepEqual(harness.store.getNowPlayingConfigWindowBounds(), {
      x: 12,
      y: 19,
      width: 640,
      height: 421,
    })
  } finally {
    await harness.cleanup()
  }
})

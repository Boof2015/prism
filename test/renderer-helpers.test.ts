import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_VISUALIZER_TINT,
  colorToRgbChannels,
  parseColorToRgb,
  resolveColorToRgb,
} from '../src/renderer/utils/color'
import {
  getHorizontalWheelScrollResult,
  normalizeWheelDelta,
} from '../src/renderer/utils/horizontalWheelScroll'
import {
  formatAstraTime,
  getAstraPlaybackProgress,
} from '../src/renderer/utils/astra'
import {
  createDefaultProfile,
} from '../src/shared/profileState'
import { calculateResizedWindowBounds } from '../src/shared/windowResize'
import { createDefaultTheme, resolveNativeThemeSource, resolveTheme } from '../src/shared/themeState'
import { usePerformanceStore } from '../src/renderer/stores/performanceStore'
import { buildProfileDraft, profilesMatch } from '../src/renderer/stores/profileDraft'
import {
  moveDockedScopeOrder,
  useSettingsStore,
} from '../src/renderer/stores/settingsStore'
import { scopeSettingsToOptions } from '../src/renderer/components/ScopeModule'
import { scopeSummary } from '../src/renderer/components/ScopeSettingsSection'
import {
  applyInputGainToStereoSamples,
  inputGainDbToLinear,
} from '../src/renderer/audio/inputGain'
import { SCOPE_KINDS, type ScopeKind } from '../src/types/scope'
import type { ScopePopoutStateMap, WindowBounds } from '../src/types/popout'
import { RESIZE_DIRECTIONS } from '../src/types/windowResize'
import { ScopePopoutDataSource } from '../src/renderer/popouts/ScopePopoutDataSource'
import {
  VUMeterBallistics,
  VU_INTEGRATION_WINDOW_MS,
  VU_METER_MIN_DB,
  VU_PEAK_HOLD_MS,
} from '../src/renderer/visualizers/vuMeterBallistics'
import { FrameScheduler } from '../src/renderer/visualizers/frameScheduler'
import { VisualizerFrameLoop } from '../src/renderer/visualizers/visualizerFrameLoop'
import {
  NativeVisualizerTransport,
  type NativeVisualizerTransportBridge,
} from '../src/renderer/audio/NativeVisualizerTransport'
import { LUFSMeter } from '../src/renderer/visualizers/LUFSMeter'
import {
  MultibandBuffer,
  MultibandSplitter,
  createMultibandChunk,
} from '../src/renderer/visualizers/multibandSplitter'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  type Profile,
} from '../src/types/profile'

type WindowWithRaf = typeof globalThis & Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>
type WindowWithTimers = typeof globalThis & Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  electronAPI: {
    platform: string
  }
}
type GlobalWithStorage = typeof globalThis & {
  localStorage?: Storage
}

function installFakeAnimationFrame(): {
  pendingCount: () => number
  runFrame: (timestamp?: number) => void
  restore: () => void
} {
  let nextFrameId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const globalWithWindow = globalThis as typeof globalThis & { window?: WindowWithRaf }
  const previousWindow = globalWithWindow.window

  globalWithWindow.window = {
    ...globalThis,
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const frameId = nextFrameId
      nextFrameId += 1
      callbacks.set(frameId, callback)
      return frameId
    },
    cancelAnimationFrame(frameId: number): void {
      callbacks.delete(frameId)
    },
  } as WindowWithRaf

  return {
    pendingCount: () => callbacks.size,
    runFrame(timestamp = 0): void {
      const frameCallbacks = [...callbacks.values()]
      callbacks.clear()
      for (const callback of frameCallbacks) {
        callback(timestamp)
      }
    },
    restore(): void {
      if (previousWindow === undefined) {
        delete globalWithWindow.window
        return
      }
      globalWithWindow.window = previousWindow
    },
  }
}

function installFakeTimeouts(hidden = false): {
  pendingCount: () => number
  nextDelay: () => number | null
  runNext: () => void
  restore: () => void
  setHidden: (value: boolean) => void
} {
  let nextTimerId = 1
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const globalWithWindow = globalThis as typeof globalThis & { window?: WindowWithTimers; document?: Document }
  const previousWindow = globalWithWindow.window
  const previousDocument = globalWithWindow.document
  const documentState = { hidden }

  globalWithWindow.window = {
    ...globalThis,
    electronAPI: { platform: 'darwin' },
    setTimeout(callback: TimerHandler, delay?: number): number {
      const timerId = nextTimerId
      nextTimerId += 1
      const run = typeof callback === 'function'
        ? callback as () => void
        : () => {}
      timers.set(timerId, {
        callback: run,
        delay: typeof delay === 'number' ? delay : 0,
      })
      return timerId
    },
    clearTimeout(timerId: number): void {
      timers.delete(timerId)
    },
  } as WindowWithTimers

  globalWithWindow.document = documentState as Document

  return {
    pendingCount: () => timers.size,
    nextDelay: () => {
      const nextTimer = timers.values().next().value
      return nextTimer ? nextTimer.delay : null
    },
    runNext(): void {
      const next = timers.entries().next().value as [number, { callback: () => void; delay: number }] | undefined
      if (!next) {
        return
      }
      const [timerId, timer] = next
      timers.delete(timerId)
      timer.callback()
    },
    restore(): void {
      if (previousWindow === undefined) {
        delete globalWithWindow.window
      } else {
        globalWithWindow.window = previousWindow
      }

      if (previousDocument === undefined) {
        delete globalWithWindow.document
      } else {
        globalWithWindow.document = previousDocument
      }
    },
    setHidden(value: boolean): void {
      documentState.hidden = value
    },
  }
}

function assertAlmostEqual(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  )
}

function createFilledStereoChunk(valueL: number, valueR: number, length: number): {
  left: Float32Array
  right: Float32Array
} {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  left.fill(valueL)
  right.fill(valueR)
  return { left, right }
}

function createProgramSamples(length: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(length)
  const right = new Float32Array(length)

  for (let index = 0; index < length; index += 1) {
    const base = Math.sin(index * 0.037) * 0.55
    const accent = Math.cos(index * 0.011) * 0.15
    left[index] = base
    right[index] = base * 0.65 + accent
  }

  return { left, right }
}

function createScopePopouts(poppedOutScopes: ScopeKind[] = []): ScopePopoutStateMap {
  const poppedOutSet = new Set(poppedOutScopes)
  return SCOPE_KINDS.reduce((acc, kind) => {
    acc[kind] = { poppedOut: poppedOutSet.has(kind) }
    return acc
  }, {} as ScopePopoutStateMap)
}

function installFakeLocalStorage(): {
  getSetCount: () => number
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  restore: () => void
} {
  const storage = new Map<string, string>()
  let setCount = 0
  const globalWithStorage = globalThis as GlobalWithStorage
  const previousLocalStorage = globalWithStorage.localStorage

  globalWithStorage.localStorage = {
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      setCount += 1
      storage.set(key, value)
    },
    removeItem(key: string): void {
      storage.delete(key)
    },
    clear(): void {
      storage.clear()
    },
    key(index: number): string | null {
      return [...storage.keys()][index] ?? null
    },
    get length(): number {
      return storage.size
    },
  } as Storage

  return {
    getSetCount: () => setCount,
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      storage.set(key, value)
    },
    restore(): void {
      if (previousLocalStorage === undefined) {
        delete globalWithStorage.localStorage
        return
      }

      globalWithStorage.localStorage = previousLocalStorage
    },
  }
}

function installFakeElectronWindow(overrides: Record<string, unknown> = {}): {
  restore: () => void
} {
  const globalWithWindow = globalThis as typeof globalThis & { window?: WindowWithTimers }
  const previousWindow = globalWithWindow.window

  globalWithWindow.window = {
    ...globalThis,
    electronAPI: {
      platform: 'darwin',
      ...overrides,
    },
  } as WindowWithTimers

  return {
    restore(): void {
      if (previousWindow === undefined) {
        delete globalWithWindow.window
        return
      }

      globalWithWindow.window = previousWindow
    },
  }
}

function seedProfileDraftState(profile: Profile): void {
  useSettingsStore.setState({
    themeId: profile.themeId,
    scopeOrder: [...profile.scopeOrder],
    hiddenScopes: new Set(profile.hiddenScopes),
    widthWeights: { ...profile.widthWeights },
    scopeSettings: JSON.parse(JSON.stringify(profile.scopeSettings)) as Profile['scopeSettings'],
    scopePopouts: JSON.parse(JSON.stringify(profile.scopePopouts)) as Profile['scopePopouts'],
    windowBounds: profile.windowBounds,
    profiles: {
      [DEFAULT_PROFILE_ID]: JSON.parse(JSON.stringify(profile)) as Profile,
    },
    activeProfileId: DEFAULT_PROFILE_ID,
    savedProfileBaseline: JSON.parse(JSON.stringify(profile)) as Profile,
    hasUnsavedProfileChanges: false,
  })
}

function resizeBounds(
  edge: (typeof RESIZE_DIRECTIONS)[number],
  cursor: { x: number; y: number },
  minWidth = 120,
  minHeight = 90,
): WindowBounds {
  return calculateResizedWindowBounds({
    edge,
    startBounds: {
      x: 100,
      y: 200,
      width: 300,
      height: 180,
    },
    startCursor: { x: 0, y: 0 },
    cursor,
    minWidth,
    minHeight,
  })
}

function createFakeTransportBridge(): {
  bridge: NativeVisualizerTransportBridge
  calls: {
    oscilloscopePushes: Float32Array[]
    vectorscopePushes: Array<{ left: Float32Array; right: Float32Array }>
    spectrumPushes: Float32Array[]
    oscilloscopeResets: number
    vectorscopeResets: number
    spectrumResets: number
    oscilloscopeSampleRates: number[]
    vectorscopeSampleRates: number[]
    spectrumSampleRates: number[]
  }
} {
  let latestSpectrumMagnitudes: Float32Array | null = null
  const calls = {
    oscilloscopePushes: [] as Float32Array[],
    vectorscopePushes: [] as Array<{ left: Float32Array; right: Float32Array }>,
    spectrumPushes: [] as Float32Array[],
    oscilloscopeResets: 0,
    vectorscopeResets: 0,
    spectrumResets: 0,
    oscilloscopeSampleRates: [] as number[],
    vectorscopeSampleRates: [] as number[],
    spectrumSampleRates: [] as number[],
  }

  return {
    bridge: {
      isAvailable: () => true,
      oscilloscope: {
        setSampleRate: (sampleRate) => {
          calls.oscilloscopeSampleRates.push(sampleRate)
        },
        pushSamples: (samples) => {
          calls.oscilloscopePushes.push(samples)
        },
        reset: () => {
          calls.oscilloscopeResets += 1
        },
      },
      spectrum: {
        setSampleRate: (sampleRate) => {
          calls.spectrumSampleRates.push(sampleRate)
        },
        pushSamples: (samples) => {
          calls.spectrumPushes.push(samples)
          latestSpectrumMagnitudes = new Float32Array([samples[0] ?? 0, samples[samples.length - 1] ?? 0])
        },
        fillMagnitudes: (output) => {
          if (!latestSpectrumMagnitudes) {
            return 0
          }
          const count = Math.min(output.length, latestSpectrumMagnitudes.length)
          for (let index = 0; index < count; index += 1) {
            output[index] = latestSpectrumMagnitudes[index]
          }
          return count
        },
        reset: () => {
          calls.spectrumResets += 1
          latestSpectrumMagnitudes = null
        },
      },
      vectorscope: {
        setSampleRate: (sampleRate) => {
          calls.vectorscopeSampleRates.push(sampleRate)
        },
        pushSamples: (left, right) => {
          calls.vectorscopePushes.push({ left, right })
        },
        reset: () => {
          calls.vectorscopeResets += 1
        },
      },
    },
    calls,
  }
}

function readSpectrumMagnitudes(transport: NativeVisualizerTransport, size = 8): number[] {
  const output = new Float32Array(size)
  const count = transport.fillLatestSpectrumMagnitudes(output)
  return Array.from(output.subarray(0, count))
}

function createFakeCanvasContext(): CanvasRenderingContext2D {
  return {
    clearRect() {},
    fillRect() {},
    fillText() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      } as CanvasGradient
    },
    measureText() {
      return { width: 0 } as TextMetrics
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D
}

function createFakeCanvas(): HTMLCanvasElement {
  const context = createFakeCanvasContext()
  return {
    width: 320,
    height: 180,
    getContext: (kind: string) => kind === '2d' ? context : null,
  } as unknown as HTMLCanvasElement
}

test('parseColorToRgb handles hex, rgb, rgba, and percentage formats', () => {
  assert.deepEqual(parseColorToRgb('#38bdf8'), { r: 56, g: 189, b: 248 })
  assert.deepEqual(parseColorToRgb('#3bf'), { r: 51, g: 187, b: 255 })
  assert.deepEqual(parseColorToRgb('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 })
  assert.deepEqual(parseColorToRgb('rgba(10 20 30 / 0.5)'), { r: 10, g: 20, b: 30 })
  assert.deepEqual(parseColorToRgb('rgb(10%, 20%, 30%)'), { r: 26, g: 51, b: 77 })
})

test('color helpers fall back predictably for invalid values', () => {
  assert.equal(colorToRgbChannels('rgba(1, 2, 3, 0.5)'), '1, 2, 3')
  assert.equal(colorToRgbChannels('nope'), null)
  assert.deepEqual(resolveColorToRgb('still-nope'), DEFAULT_VISUALIZER_TINT)
  assert.deepEqual(resolveColorToRgb('rgb(4, 5, 6)'), { r: 4, g: 5, b: 6 })
})

test('calculateResizedWindowBounds supports every resize direction', () => {
  const expectedByDirection: Record<(typeof RESIZE_DIRECTIONS)[number], WindowBounds> = {
    n: { x: 100, y: 220, width: 300, height: 160 },
    s: { x: 100, y: 200, width: 300, height: 200 },
    e: { x: 100, y: 200, width: 340, height: 180 },
    w: { x: 140, y: 200, width: 260, height: 180 },
    ne: { x: 100, y: 220, width: 340, height: 160 },
    nw: { x: 140, y: 220, width: 260, height: 160 },
    se: { x: 100, y: 200, width: 340, height: 200 },
    sw: { x: 140, y: 200, width: 260, height: 200 },
  }

  for (const edge of RESIZE_DIRECTIONS) {
    assert.deepEqual(
      resizeBounds(edge, { x: 40, y: 20 }),
      expectedByDirection[edge],
      `expected ${edge} resize bounds to match`,
    )
  }
})

test('calculateResizedWindowBounds clamps east and south resizes to minimum size', () => {
  assert.deepEqual(
    resizeBounds('e', { x: -220, y: 0 }, 140, 90),
    { x: 100, y: 200, width: 140, height: 180 },
  )

  assert.deepEqual(
    resizeBounds('s', { x: 0, y: -140 }, 120, 100),
    { x: 100, y: 200, width: 300, height: 100 },
  )
})

test('calculateResizedWindowBounds keeps north and west edges anchored when clamped', () => {
  assert.deepEqual(
    resizeBounds('w', { x: 220, y: 0 }, 140, 90),
    { x: 260, y: 200, width: 140, height: 180 },
  )

  assert.deepEqual(
    resizeBounds('nw', { x: 220, y: 140 }, 140, 100),
    { x: 260, y: 280, width: 140, height: 100 },
  )
})

test('inputGainDbToLinear converts dB offsets to expected linear gain values', () => {
  assert.equal(inputGainDbToLinear(0), 1)
  assertAlmostEqual(inputGainDbToLinear(6), 1.9952623149688795, 1e-12, '+6 dB gain')
  assertAlmostEqual(inputGainDbToLinear(-6), 0.5011872336272722, 1e-12, '-6 dB gain')
})

test('applyInputGainToStereoSamples scales both channels in place', () => {
  const { left, right } = createFilledStereoChunk(0.25, -0.5, 3)
  const linearGain = inputGainDbToLinear(6)

  applyInputGainToStereoSamples(left, right, linearGain)

  for (const sample of left) {
    assertAlmostEqual(sample, 0.25 * linearGain, 1e-6, 'left channel scaled')
  }

  for (const sample of right) {
    assertAlmostEqual(sample, -0.5 * linearGain, 1e-6, 'right channel scaled')
  }
})

test('applyInputGainToStereoSamples is a no-op for unity gain', () => {
  const left = new Float32Array([0.1, -0.2, 0.3])
  const right = new Float32Array([-0.4, 0.5, -0.6])
  const initialLeft = Array.from(left)
  const initialRight = Array.from(right)

  applyInputGainToStereoSamples(left, right, 1)

  assert.deepEqual(Array.from(left), initialLeft)
  assert.deepEqual(Array.from(right), initialRight)
})

test('FrameScheduler dispatches every animation frame in display-sync mode', () => {
  const raf = installFakeAnimationFrame()

  try {
    const scheduler = new FrameScheduler({ frameTarget: 'display-sync' })
    let frameCount = 0
    const unsubscribe = scheduler.subscribe(() => {
      frameCount += 1
    })

    assert.equal(raf.pendingCount(), 1)

    raf.runFrame(0)
    raf.runFrame(16.7)
    raf.runFrame(33.4)

    assert.equal(frameCount, 3)
    assert.equal(raf.pendingCount(), 1)

    unsubscribe()
    assert.equal(raf.pendingCount(), 0)
  } finally {
    raf.restore()
  }
})

test('FrameScheduler caps numeric frame targets by skipping intermediate animation frames', () => {
  const raf = installFakeAnimationFrame()

  try {
    const scheduler = new FrameScheduler({ frameTarget: 30 })
    let frameCount = 0
    const unsubscribe = scheduler.subscribe(() => {
      frameCount += 1
    })

    raf.runFrame(0)
    raf.runFrame(16.7)
    raf.runFrame(33.4)
    raf.runFrame(50.1)
    raf.runFrame(66.8)

    assert.equal(frameCount, 3)
    assert.equal(raf.pendingCount(), 1)

    unsubscribe()
    assert.equal(raf.pendingCount(), 0)
  } finally {
    raf.restore()
  }
})

test('FrameScheduler updates cadence when the frame target changes without duplicating subscriptions', () => {
  const raf = installFakeAnimationFrame()

  try {
    const scheduler = new FrameScheduler({ frameTarget: 30 })
    let frameCount = 0
    const unsubscribe = scheduler.subscribe(() => {
      frameCount += 1
    })

    raf.runFrame(0)
    raf.runFrame(16.7)
    assert.equal(frameCount, 1)
    assert.equal(raf.pendingCount(), 1)

    scheduler.setFrameTarget(60)

    raf.runFrame(33.4)
    raf.runFrame(41.7)
    raf.runFrame(50.1)

    assert.equal(frameCount, 3)
    assert.equal(raf.pendingCount(), 1)

    unsubscribe()
    assert.equal(raf.pendingCount(), 0)
  } finally {
    raf.restore()
  }
})

test('VisualizerFrameLoop renders one invalidated frame while idle', () => {
  const raf = installFakeAnimationFrame()

  try {
    let frameCount = 0
    const loop = new VisualizerFrameLoop({
      shouldRun: () => false,
      onFrame: () => {
        frameCount += 1
      },
    })

    loop.start()
    assert.equal(raf.pendingCount(), 1)

    raf.runFrame()

    assert.equal(frameCount, 1)
    assert.equal(raf.pendingCount(), 0)

    loop.dispose()
  } finally {
    raf.restore()
  }
})

test('VisualizerFrameLoop stays subscribed while running and detaches when playback stops', () => {
  const raf = installFakeAnimationFrame()

  try {
    let frameCount = 0
    let running = true
    const loop = new VisualizerFrameLoop({
      shouldRun: () => running,
      onFrame: () => {
        frameCount += 1
      },
    })

    loop.start()
    raf.runFrame()
    assert.equal(frameCount, 1)
    assert.equal(raf.pendingCount(), 1)

    running = false
    raf.runFrame()
    assert.equal(frameCount, 2)
    assert.equal(raf.pendingCount(), 0)

    loop.dispose()
  } finally {
    raf.restore()
  }
})

test('VisualizerFrameLoop invalidate and stop manage subscriptions correctly', () => {
  const raf = installFakeAnimationFrame()

  try {
    let frameCount = 0
    const loop = new VisualizerFrameLoop({
      shouldRun: () => false,
      onFrame: () => {
        frameCount += 1
      },
    })

    loop.start()
    raf.runFrame()
    assert.equal(frameCount, 1)
    assert.equal(raf.pendingCount(), 0)

    loop.invalidate()
    assert.equal(raf.pendingCount(), 1)

    loop.stop()
    assert.equal(raf.pendingCount(), 0)

    raf.runFrame()
    assert.equal(frameCount, 1)
  } finally {
    raf.restore()
  }
})

test('moveDockedScopeOrder swaps a middle docked scope with its adjacent docked neighbor', () => {
  const nextOrder = moveDockedScopeOrder(
    [...SCOPE_KINDS],
    new Set<ScopeKind>(),
    createScopePopouts(),
    'vectorscope',
    'left',
  )

  assert.deepEqual(nextOrder, [
    'spectrum',
    'vectorscope',
    'oscilloscope',
    'spectrogram',
    'vumeter',
    'lufsmeter',
    'waveform',
    'astra',
  ])
})

test('scopeSettingsToOptions wires spectrum side overlay settings into analyzer options', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.spectrum.showSideLine = true
  const theme = resolveTheme(createDefaultTheme())

  const options = scopeSettingsToOptions('spectrum', profile.scopeSettings.spectrum, theme.spectrum)

  assert.equal(options.showSideLine, true)
  assert.equal(options.secondaryLineColor, theme.spectrum.sideLine)
  assert.equal(options.lineColor, theme.spectrum.line)
  assert.equal(options.backgroundColor, theme.spectrum.background)
  assert.equal(options.gridColor, theme.spectrum.guides)
})

test('astra playback progress advances from updatedAt while playing', () => {
  const progress = getAstraPlaybackProgress({
    playbackState: 'playing',
    currentTime: 12,
    duration: 120,
    queueLength: 4,
    outputDeviceLabel: 'Built-in Output',
    visualizerLineColor: '#38bdf8',
    currentTrack: {
      id: 'track-1',
      title: 'Track',
      artist: 'Artist',
      album: 'Album',
      isFavorite: false,
      artworkDataUrl: null,
    },
    updatedAt: 1000,
  }, 3500)

  assertAlmostEqual(progress.currentTime, 14.5, 1e-6, 'current time advances')
  assertAlmostEqual(progress.progress, 14.5 / 120, 1e-6, 'progress ratio advances')
  assert.equal(formatAstraTime(progress.currentTime), '0:14')
})

test('normalizeWheelDelta keeps pixel deltas unchanged', () => {
  assert.equal(normalizeWheelDelta(24, 0, 320), 24)
})

test('normalizeWheelDelta converts line deltas to pixels', () => {
  assert.equal(normalizeWheelDelta(3, 1, 320), 48)
})

test('normalizeWheelDelta scales page deltas to viewport width', () => {
  assert.equal(normalizeWheelDelta(2, 2, 500), 900)
})

test('getHorizontalWheelScrollResult converts vertical wheel input into horizontal movement', () => {
  assert.deepEqual(
    getHorizontalWheelScrollResult({
      clientWidth: 320,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 60,
      scrollLeft: 40,
      scrollWidth: 960,
    }),
    {
      appliedDelta: 60,
      nextScrollLeft: 100,
    },
  )
})

test('getHorizontalWheelScrollResult leaves native horizontal wheel input alone', () => {
  assert.equal(
    getHorizontalWheelScrollResult({
      clientWidth: 320,
      deltaMode: 0,
      deltaX: 8,
      deltaY: 40,
      scrollLeft: 40,
      scrollWidth: 960,
    }),
    null,
  )
})

test('getHorizontalWheelScrollResult is a no-op when the rail does not overflow', () => {
  assert.equal(
    getHorizontalWheelScrollResult({
      clientWidth: 320,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 40,
      scrollLeft: 0,
      scrollWidth: 320,
    }),
    null,
  )
})

test('getHorizontalWheelScrollResult is a no-op for excluded interactive controls', () => {
  assert.equal(
    getHorizontalWheelScrollResult({
      clientWidth: 320,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 40,
      isTargetExcluded: true,
      scrollLeft: 0,
      scrollWidth: 960,
    }),
    null,
  )
})

test('getHorizontalWheelScrollResult moves scrollLeft left for negative deltas', () => {
  assert.deepEqual(
    getHorizontalWheelScrollResult({
      clientWidth: 320,
      deltaMode: 0,
      deltaX: 0,
      deltaY: -50,
      scrollLeft: 120,
      scrollWidth: 960,
    }),
    {
      appliedDelta: -50,
      nextScrollLeft: 70,
    },
  )
})

test('getHorizontalWheelScrollResult normalizes line and page delta modes', () => {
  assert.deepEqual(
    getHorizontalWheelScrollResult({
      clientWidth: 400,
      deltaMode: 1,
      deltaX: 0,
      deltaY: 2,
      scrollLeft: 10,
      scrollWidth: 1200,
    }),
    {
      appliedDelta: 32,
      nextScrollLeft: 42,
    },
  )

  assert.deepEqual(
    getHorizontalWheelScrollResult({
      clientWidth: 400,
      deltaMode: 2,
      deltaX: 0,
      deltaY: 1,
      scrollLeft: 10,
      scrollWidth: 1200,
    }),
    {
      appliedDelta: 360,
      nextScrollLeft: 370,
    },
  )
})

test('scopeSettingsToOptions wires waveform stereo mode into analyzer options', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.waveform.mode = 'stereo'
  profile.scopeSettings.waveform.multiband = true
  const theme = resolveTheme(createDefaultTheme())

  const options = scopeSettingsToOptions('waveform', profile.scopeSettings.waveform, theme.waveform)

  assert.equal(options.mode, 'stereo')
  assert.equal(options.multiband, true)
  assert.equal(options.lineColor, theme.waveform.line)
  assert.equal(options.backgroundColor, theme.waveform.background)
  assert.equal(options.gridMajorColor, theme.waveform.guides)
  assert.equal(options.gridMinorColor, theme.waveform.guidesSecondary)
})

test('scopeSettingsToOptions forwards shared scope background and guides to oscilloscope and vectorscope', () => {
  const profile = createDefaultProfile('Default')
  const authoredTheme = createDefaultTheme()
  authoredTheme.scopes.background = 'rgb(3, 4, 5)'
  authoredTheme.scopes.guides = 'rgba(120, 130, 140, 0.2)'
  const theme = resolveTheme(authoredTheme)

  const oscilloscope = scopeSettingsToOptions('oscilloscope', profile.scopeSettings.oscilloscope, theme.oscilloscope)
  assert.equal(oscilloscope.backgroundColor, 'rgb(3, 4, 5)')
  assert.equal(oscilloscope.gridMajorColor, theme.oscilloscope.guides)
  assert.equal(oscilloscope.gridMinorColor, theme.oscilloscope.guidesSecondary)

  const vectorscope = scopeSettingsToOptions('vectorscope', profile.scopeSettings.vectorscope, theme.vectorscope)
  assert.equal(vectorscope.backgroundColor, 'rgb(3, 4, 5)')
  assert.equal(vectorscope.gridMajorColor, theme.vectorscope.guides)
  assert.equal(vectorscope.gridMinorColor, theme.vectorscope.guidesSecondary)
  assert.equal(vectorscope.labelColor, theme.vectorscope.labels)
})

test('scopeSettingsToOptions forwards themed backgrounds and track colors to spectrogram, VU, and LUFS modules', () => {
  const profile = createDefaultProfile('Default')
  const authoredTheme = createDefaultTheme()
  authoredTheme.scopes.background = 'rgb(6, 7, 8)'
  authoredTheme.vumeter.track = 'rgb(9, 10, 11)'
  authoredTheme.lufsmeter.track = 'rgb(12, 13, 14)'
  authoredTheme.lufsmeter.target = 'rgb(15, 16, 17)'
  const theme = resolveTheme(authoredTheme)

  const spectrogram = scopeSettingsToOptions('spectrogram', profile.scopeSettings.spectrogram, theme.spectrogram)
  assert.equal(spectrogram.backgroundColor, 'rgb(6, 7, 8)')

  const vumeter = scopeSettingsToOptions('vumeter', profile.scopeSettings.vumeter, theme.vumeter)
  assert.equal(vumeter.backgroundColor, 'rgb(6, 7, 8)')
  assert.equal(vumeter.trackColor, 'rgb(9, 10, 11)')
  assert.equal(vumeter.scaleColor, theme.vumeter.scale)
  assert.equal(vumeter.labelColor, theme.vumeter.labels)

  const lufsmeter = scopeSettingsToOptions('lufsmeter', profile.scopeSettings.lufsmeter, theme.lufsmeter)
  assert.equal(lufsmeter.backgroundColor, 'rgb(6, 7, 8)')
  assert.equal(lufsmeter.trackColor, 'rgb(12, 13, 14)')
  assert.equal(lufsmeter.targetColor, 'rgb(15, 16, 17)')
  assert.equal(lufsmeter.scaleColor, theme.lufsmeter.scale)
  assert.equal(lufsmeter.labelColor, theme.lufsmeter.labels)
})

test('scopeSummary includes Stereo for waveform only when stereo mode is enabled', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.waveform.gainDb = 6

  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), '+6 dB')

  profile.scopeSettings.waveform.mode = 'stereo'
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), '+6 dB · Stereo')

  profile.scopeSettings.waveform.multiband = true
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), '+6 dB · Stereo · RGB')
})

test('scopeSummary summarizes astra field visibility', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.astra.showArtist = false
  profile.scopeSettings.astra.showControls = false

  assert.equal(scopeSummary('astra', profile.scopeSettings.astra), 'Cover · Title · Bar · Time')
})

test('ScopePopoutDataSource switches waveform batches between mono and stereo queues', () => {
  const dataSource = new ScopePopoutDataSource('waveform')
  const monoChunk = new Float32Array([0.1, 0.2, 0.3])
  const stereoLeft = new Float32Array([0.4, 0.5])
  const stereoRight = new Float32Array([0.6, 0.7])
  const nextMonoChunk = new Float32Array([0.8])

  dataSource.pushAudioBatch([monoChunk])
  assert.equal(dataSource.getPendingWaveformSamples()[0], monoChunk)
  assert.equal(dataSource.getPendingWaveformStereoSamples().length, 0)

  dataSource.pushAudioBatch([{ left: stereoLeft, right: stereoRight }])
  assert.equal(dataSource.getPendingWaveformSamples().length, 0)
  const stereoBatch = dataSource.getPendingWaveformStereoSamples()
  assert.equal(stereoBatch.length, 1)
  assert.equal(stereoBatch[0]?.left, stereoLeft)
  assert.equal(stereoBatch[0]?.right, stereoRight)

  dataSource.pushAudioBatch([nextMonoChunk])
  assert.equal(dataSource.getPendingWaveformStereoSamples().length, 0)
  assert.equal(dataSource.getPendingWaveformSamples()[0], nextMonoChunk)
})

test('applying a profile snapshot does not change the machine-local frame target', () => {
  const previousPerformanceState = usePerformanceStore.getState()
  const previousSettingsState = useSettingsStore.getState()

  try {
    usePerformanceStore.getState().setFrameTarget(120)

    const defaultProfile = createDefaultProfile('Default')
    const alternateProfile = createDefaultProfile('Live Mix')
    alternateProfile.hiddenScopes = []
    alternateProfile.scopeSettings.waveform.gainDb = 6

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: 'profile_live_mix',
      profiles: {
        profile_default: defaultProfile,
        profile_live_mix: alternateProfile,
      },
    })

    assert.equal(usePerformanceStore.getState().frameTarget, 120)
  } finally {
    usePerformanceStore.setState({
      frameTarget: previousPerformanceState.frameTarget,
      dockedRenderFps: previousPerformanceState.dockedRenderFps,
    })
    useSettingsStore.setState(previousSettingsState)
  }
})

test('profile draft comparisons return to clean after reverting a change', () => {
  const baselineProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  baselineProfile.themeId = 'theme_default'
  baselineProfile.windowBounds = { x: 24, y: 48, width: 900, height: 180 }
  baselineProfile.scopePopouts.spectrum = {
    poppedOut: true,
    windowBounds: { x: 160, y: 90, width: 420, height: 240 },
  }

  const baselineDraft = buildProfileDraft({
    themeId: baselineProfile.themeId,
    scopeOrder: baselineProfile.scopeOrder,
    hiddenScopes: baselineProfile.hiddenScopes,
    widthWeights: baselineProfile.widthWeights,
    scopeSettings: baselineProfile.scopeSettings,
    scopePopouts: baselineProfile.scopePopouts,
    windowBounds: baselineProfile.windowBounds,
  }, baselineProfile.name)

  const changedDraft = buildProfileDraft({
    themeId: baselineProfile.themeId,
    scopeOrder: baselineProfile.scopeOrder,
    hiddenScopes: baselineProfile.hiddenScopes,
    widthWeights: baselineProfile.widthWeights,
    scopeSettings: {
      ...baselineProfile.scopeSettings,
      waveform: {
        ...baselineProfile.scopeSettings.waveform,
        gainDb: baselineProfile.scopeSettings.waveform.gainDb + 3,
      },
    },
    scopePopouts: baselineProfile.scopePopouts,
    windowBounds: baselineProfile.windowBounds,
  }, baselineProfile.name)

  const revertedDraft = buildProfileDraft({
    themeId: baselineProfile.themeId,
    scopeOrder: baselineProfile.scopeOrder,
    hiddenScopes: baselineProfile.hiddenScopes,
    widthWeights: baselineProfile.widthWeights,
    scopeSettings: baselineProfile.scopeSettings,
    scopePopouts: baselineProfile.scopePopouts,
    windowBounds: baselineProfile.windowBounds,
  }, baselineProfile.name)

  assert.equal(profilesMatch(baselineDraft, changedDraft), false)
  assert.equal(profilesMatch(baselineDraft, revertedDraft), true)
})

test('buildProfileDraft preserves unlinked themes instead of coercing the active theme', () => {
  const profile = createDefaultProfile('Live Mix')
  profile.themeId = null

  const draft = buildProfileDraft({
    themeId: profile.themeId,
    scopeOrder: profile.scopeOrder,
    hiddenScopes: profile.hiddenScopes,
    widthWeights: profile.widthWeights,
    scopeSettings: profile.scopeSettings,
    scopePopouts: profile.scopePopouts,
    windowBounds: profile.windowBounds,
  }, profile.name)

  assert.equal(draft.themeId, null)
})

test('resolveNativeThemeSource follows the active theme brightness for native UI', () => {
  const darkTheme = createDefaultTheme()
  const lightTheme = createDefaultTheme()
  lightTheme.app.background = 'rgb(248, 250, 252)'
  lightTheme.app.surface = 'rgba(255, 255, 255, 0.96)'
  lightTheme.app.surfaceAlt = 'rgba(255, 255, 255, 0.92)'
  lightTheme.app.text = 'rgb(15, 23, 42)'
  lightTheme.app.textMuted = 'rgba(15, 23, 42, 0.48)'
  lightTheme.controls.menuSurface = 'rgb(255, 255, 255)'
  lightTheme.controls.menuBorder = 'rgba(15, 23, 42, 0.12)'

  assert.equal(resolveNativeThemeSource(darkTheme), 'dark')
  assert.equal(resolveNativeThemeSource(lightTheme), 'light')
})

test('toggleScope appends astra to the scope order when it is enabled from an opt-in profile', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    seedProfileDraftState(profile)

    assert.equal(useSettingsStore.getState().scopeOrder.includes('astra'), false)

    useSettingsStore.getState().toggleScope('astra')

    assert.equal(useSettingsStore.getState().scopeOrder.at(-1), 'astra')
    assert.equal(useSettingsStore.getState().hiddenScopes.has('astra'), false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('main-window bounds updates persist working state in Electron mode', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }
    seedProfileDraftState(profile)

    useSettingsStore.getState().updateMainWindowBounds({ x: 10, y: 20, width: 900, height: 180 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.equal(fakeStorage.getSetCount(), 1)

    useSettingsStore.getState().updateMainWindowBounds({ x: 24, y: 20, width: 900, height: 180 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, true)
    assert.equal(fakeStorage.getSetCount(), 2)

    useSettingsStore.getState().updateMainWindowBounds({ x: 10, y: 20, width: 900, height: 180 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.equal(fakeStorage.getSetCount(), 3)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('initializeProfiles restores persisted dirty window bounds while keeping the saved profile as baseline', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const restoredBounds: WindowBounds[] = []
  const dirtyBounds = { x: 44, y: 55, width: 900, height: 180 }
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => {
      const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
      profile.themeId = 'theme_default'
      profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }

      return {
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: {
          [DEFAULT_PROFILE_ID]: profile,
        },
      }
    },
    getWindowBounds: async () => dirtyBounds,
    setWindowBounds: (bounds: WindowBounds) => {
      restoredBounds.push(bounds)
    },
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }

    fakeStorage.setItem('prism:settings', JSON.stringify({
      themeId: profile.themeId,
      scopeOrder: profile.scopeOrder,
      hiddenScopes: profile.hiddenScopes,
      widthWeights: profile.widthWeights,
      scopeSettings: profile.scopeSettings,
      scopePopouts: profile.scopePopouts,
      windowBounds: dirtyBounds,
    }))

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.activeProfileId, DEFAULT_PROFILE_ID)
    assert.deepEqual(state.windowBounds, dirtyBounds)
    assert.deepEqual(state.savedProfileBaseline?.windowBounds, profile.windowBounds)
    assert.equal(state.hasUnsavedProfileChanges, true)
    assert.deepEqual(restoredBounds, [dirtyBounds])
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('profiles without saved window bounds mark the first user move dirty after load sync completes', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const currentBounds = { x: 10, y: 20, width: 900, height: 180 }
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => currentBounds,
    setWindowBounds: () => {},
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    assert.deepEqual(useSettingsStore.getState().savedProfileBaseline?.windowBounds, currentBounds)
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)

    useSettingsStore.getState().updateMainWindowBounds({ x: 24, y: 20, width: 900, height: 180 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, true)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('loading a profile syncs the live window bounds without marking the draft dirty', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const currentBounds = { x: 52, y: 18, width: 940, height: 192 }
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => currentBounds,
    setWindowBounds: () => {},
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.deepEqual(useSettingsStore.getState().windowBounds, currentBounds)
    assert.deepEqual(useSettingsStore.getState().savedProfileBaseline?.windowBounds, currentBounds)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('switching to a non-default profile with an unlinked theme does not mark it dirty', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    const defaultProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    defaultProfile.themeId = 'theme_default'

    const liveMixProfile = createDefaultProfile('Live Mix')
    liveMixProfile.themeId = null

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: 'profile_live_mix',
      profiles: {
        [DEFAULT_PROFILE_ID]: defaultProfile,
        profile_live_mix: liveMixProfile,
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    assert.equal(useSettingsStore.getState().themeId, null)
    assert.equal(useSettingsStore.getState().savedProfileBaseline?.themeId, null)
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('profile load absorbs immediate macOS-style window bound adjustments without marking dirty', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => ({ x: 16, y: 18, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })

    useSettingsStore.getState().updateMainWindowBounds({ x: 16, y: 18, width: 900, height: 180 })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('profile load absorbs immediate popout bound adjustments without marking dirty', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.scopePopouts.spectrum = {
      poppedOut: true,
      windowBounds: { x: 140, y: 60, width: 420, height: 240 },
    }

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })

    useSettingsStore.getState().updatePopoutBounds('spectrum', { x: 156, y: 58, width: 420, height: 240 })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('geometry sync window extends while load-time macOS bound updates continue', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    seedProfileDraftState(profile)

    useSettingsStore.setState((state) => ({
      ...state,
      geometrySyncUntil: Date.now() + 50,
    }))
    const before = useSettingsStore.getState().geometrySyncUntil

    useSettingsStore.getState().updateMainWindowBounds({ x: 24, y: 18, width: 900, height: 180 })

    assert.ok(useSettingsStore.getState().geometrySyncUntil > before)
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('popout bounds updates persist working state in Electron mode', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.themeId = 'theme_default'
    profile.scopePopouts.spectrum = {
      poppedOut: true,
      windowBounds: { x: 140, y: 60, width: 420, height: 240 },
    }
    seedProfileDraftState(profile)

    useSettingsStore.getState().updatePopoutBounds('spectrum', { x: 140, y: 60, width: 420, height: 240 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.equal(fakeStorage.getSetCount(), 1)

    useSettingsStore.getState().updatePopoutBounds('spectrum', { x: 180, y: 60, width: 420, height: 240 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, true)
    assert.equal(fakeStorage.getSetCount(), 2)

    useSettingsStore.getState().updatePopoutBounds('spectrum', { x: 140, y: 60, width: 420, height: 240 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.equal(fakeStorage.getSetCount(), 3)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('moveDockedScopeOrder is a no-op at the docked boundaries', () => {
  const initialOrder = [...SCOPE_KINDS]

  assert.equal(
    moveDockedScopeOrder(initialOrder, new Set<ScopeKind>(), createScopePopouts(), 'spectrum', 'left'),
    initialOrder,
  )
  assert.equal(
    moveDockedScopeOrder(initialOrder, new Set<ScopeKind>(), createScopePopouts(), 'astra', 'right'),
    initialOrder,
  )
})

test('moveDockedScopeOrder preserves hidden scope positions in the full order', () => {
  const nextOrder = moveDockedScopeOrder(
    [...SCOPE_KINDS],
    new Set<ScopeKind>(['oscilloscope']),
    createScopePopouts(),
    'vectorscope',
    'left',
  )

  assert.deepEqual(nextOrder, [
    'vectorscope',
    'oscilloscope',
    'spectrum',
    'spectrogram',
    'vumeter',
    'lufsmeter',
    'waveform',
    'astra',
  ])
})

test('moveDockedScopeOrder preserves popped-out scope positions in the full order', () => {
  const nextOrder = moveDockedScopeOrder(
    [...SCOPE_KINDS],
    new Set<ScopeKind>(),
    createScopePopouts(['oscilloscope']),
    'spectrogram',
    'left',
  )

  assert.deepEqual(nextOrder, [
    'spectrum',
    'oscilloscope',
    'spectrogram',
    'vectorscope',
    'vumeter',
    'lufsmeter',
    'waveform',
    'astra',
  ])
})

test('VUMeterBallistics holds VU, bar, and correlation steady when an active frame receives no chunks', () => {
  const sampleRate = 48000
  const windowSamples = Math.round((sampleRate * VU_INTEGRATION_WINDOW_MS) / 1000)
  const meter = new VUMeterBallistics(sampleRate)
  const initial = meter.process([createFilledStereoChunk(0.5, 0.5, windowSamples)], 300)
  const held = meter.process([], 316)

  assert.ok(initial.vuLDb > -7 && initial.vuLDb < -5)
  assertAlmostEqual(held.vuLDb, initial.vuLDb, 1e-12, 'left VU should hold across empty frames')
  assertAlmostEqual(held.vuRDb, initial.vuRDb, 1e-12, 'right VU should hold across empty frames')
  assertAlmostEqual(held.barLDb, initial.barLDb, 1e-12, 'left bar should hold across empty frames')
  assertAlmostEqual(held.barRDb, initial.barRDb, 1e-12, 'right bar should hold across empty frames')
  assertAlmostEqual(held.correlation, initial.correlation, 1e-12, 'correlation should hold across empty frames')
  assert.notEqual(held.vuLDb, VU_METER_MIN_DB)
})

test('VUMeterBallistics produces the same VU, bar, and correlation for contiguous and irregular chunk delivery', () => {
  const sampleRate = 48000
  const windowSamples = Math.round((sampleRate * VU_INTEGRATION_WINDOW_MS) / 1000)
  const program = createProgramSamples(windowSamples)
  const contiguous = new VUMeterBallistics(sampleRate)
  const irregular = new VUMeterBallistics(sampleRate)
  const contiguousSnapshot = contiguous.process([program], (windowSamples / sampleRate) * 1000)

  const chunkSizes = [127, 509, 33, 2048, 401, 89, 3072, 17, 611, 1536]
  let offset = 0
  let nowMs = 0
  let chunkIndex = 0

  while (offset < windowSamples) {
    const chunkSize = chunkSizes[chunkIndex % chunkSizes.length] ?? 1
    const nextOffset = Math.min(windowSamples, offset + chunkSize)
    const left = program.left.slice(offset, nextOffset)
    const right = program.right.slice(offset, nextOffset)
    nowMs += ((nextOffset - offset) / sampleRate) * 1000
    irregular.process([{ left, right }], nowMs)
    offset = nextOffset
    chunkIndex += 1
  }

  const irregularSnapshot = irregular.getSnapshot()
  assertAlmostEqual(irregularSnapshot.vuLDb, contiguousSnapshot.vuLDb, 1e-6, 'left VU should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.vuRDb, contiguousSnapshot.vuRDb, 1e-6, 'right VU should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.barLDb, contiguousSnapshot.barLDb, 1e-6, 'left bar should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.barRDb, contiguousSnapshot.barRDb, 1e-6, 'right bar should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.correlation, contiguousSnapshot.correlation, 1e-6, 'correlation should be chunking-invariant')
})

test('VUMeterBallistics lets the bar outrun the VU needle while peak hold remains highest', () => {
  const sampleRate = 48000
  const meter = new VUMeterBallistics(sampleRate)
  const baselineSamples = Math.floor(sampleRate * 0.2)
  const burstSamples = Math.floor(sampleRate * 0.016)

  meter.process([createFilledStereoChunk(0.1, 0.1, baselineSamples)], 200)
  const burstSnapshot = meter.process([createFilledStereoChunk(1.0, 1.0, burstSamples)], 216)
  const beforeDecay = meter.process([], 216 + VU_PEAK_HOLD_MS - 10)
  const afterDecay = meter.process([], 216 + VU_PEAK_HOLD_MS + 100)

  assert.ok(burstSnapshot.vuLDb < -10)
  assert.ok(burstSnapshot.barLDb > burstSnapshot.vuLDb + 8)
  assert.ok(burstSnapshot.peakLDb >= burstSnapshot.barLDb)
  assert.equal(burstSnapshot.peakLDb, 0)
  assert.equal(beforeDecay.peakLDb, 0)
  assert.ok(afterDecay.peakLDb < beforeDecay.peakLDb)
  assert.ok(afterDecay.peakLDb > -3)
})

test('NativeVisualizerTransport feeds native scope state from chunk arrival without a render tick', () => {
  const { bridge, calls } = createFakeTransportBridge()
  const transport = new NativeVisualizerTransport(bridge)
  const left = new Float32Array([0.2, 0.4, 0.6])
  const right = new Float32Array([0.8, 0.6, 0.4])

  transport.setDemand({
    spectrum: true,
    oscilloscope: true,
    vectorscope: true,
  })
  transport.reset({
    sessionId: 1,
    sampleRate: 48000,
    channelCount: 2,
    capturing: true,
  })
  transport.handleChunk(left, right, {
    sessionId: 1,
    channelCount: 2,
  })

  assert.equal(calls.oscilloscopePushes.length, 1)
  assert.equal(calls.vectorscopePushes.length, 1)
  assert.equal(calls.spectrumPushes.length, 1)
  assert.equal(calls.oscilloscopePushes[0], left)
  assert.equal(calls.vectorscopePushes[0]?.left, left)
  assert.equal(calls.vectorscopePushes[0]?.right, right)
  assert.deepEqual(Array.from(calls.spectrumPushes[0]), [0.5, 0.5, 0.5])
  assert.deepEqual(readSpectrumMagnitudes(transport), [0.5, 0.5])
})

test('NativeVisualizerTransport resets cached state on session changes and sample-rate updates', () => {
  const { bridge, calls } = createFakeTransportBridge()
  const transport = new NativeVisualizerTransport(bridge)

  transport.setDemand({ spectrum: true, oscilloscope: true, vectorscope: true })
  transport.reset({
    sessionId: 7,
    sampleRate: 48000,
    channelCount: 2,
    capturing: true,
  })
  transport.handleChunk(new Float32Array([1, 1]), new Float32Array([1, 1]), {
    sessionId: 7,
    channelCount: 2,
  })
  assert.deepEqual(readSpectrumMagnitudes(transport), [1, 1])

  transport.reset({
    sessionId: 8,
    sampleRate: 96000,
    channelCount: 2,
    capturing: true,
  })

  assert.equal(calls.oscilloscopeSampleRates.at(-1), 96000)
  assert.equal(calls.spectrumSampleRates.at(-1), 96000)
  assert.equal(calls.vectorscopeSampleRates.at(-1), 96000)
  assert.equal(calls.oscilloscopeResets >= 2, true)
  assert.equal(calls.spectrumResets >= 2, true)
  assert.equal(calls.vectorscopeResets >= 2, true)
  assert.equal(transport.fillLatestSpectrumMagnitudes(new Float32Array(4)), 0)
})

test('NativeVisualizerTransport stops feeding scopes when demand is removed', () => {
  const { bridge, calls } = createFakeTransportBridge()
  const transport = new NativeVisualizerTransport(bridge)

  transport.setDemand({ spectrum: true })
  transport.reset({
    sessionId: 2,
    sampleRate: 48000,
    channelCount: 2,
    capturing: true,
  })
  transport.handleChunk(new Float32Array([0.25]), new Float32Array([0.75]), {
    sessionId: 2,
    channelCount: 2,
  })
  assert.equal(calls.spectrumPushes.length, 1)

  transport.setDemand({})
  transport.handleChunk(new Float32Array([0.5]), new Float32Array([0.5]), {
    sessionId: 2,
    channelCount: 2,
  })

  assert.equal(calls.spectrumPushes.length, 1)
  assert.equal(calls.spectrumResets >= 1, true)
  assert.equal(transport.fillLatestSpectrumMagnitudes(new Float32Array(4)), 0)
})

test('MultibandSplitter and MultibandBuffer reuse caller-owned buffers', () => {
  const splitter = new MultibandSplitter()
  splitter.configure(48000)

  const splitTarget = createMultibandChunk(8)
  const leftRef = splitTarget.low.left
  const rightRef = splitTarget.high.right
  const left = new Float32Array([1, 0.75, 0.25, -0.25, -0.75, -1, -0.5, 0.5])
  const right = new Float32Array([0.5, 0.25, -0.5, -1, -0.5, 0.25, 0.75, 1])

  const splitCount = splitter.splitInto(left, right, splitTarget)
  assert.equal(splitCount, 8)
  assert.equal(splitTarget.low.left, leftRef)
  assert.equal(splitTarget.high.right, rightRef)

  const buffer = new MultibandBuffer(16)
  buffer.push(splitTarget, splitCount)

  const pointTarget = createMultibandChunk(8)
  const pointRef = pointTarget.mid.left
  const pointCount = buffer.fillPointsInto(pointTarget, 8)
  assert.equal(pointCount, 8)
  assert.equal(pointTarget.mid.left, pointRef)
  assert.notEqual(pointTarget.low.left[0], 0)
})

test('LUFSMeter keeps integrated history bounded over long runs', () => {
  const chunkQueue: Array<{ left: Float32Array; right: Float32Array }> = []
  const dataSource = {
    getPendingLUFSMeterSamples: () => {
      const drained = chunkQueue.slice()
      chunkQueue.length = 0
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const meter = new LUFSMeter(createFakeCanvas(), { dataSource })
  const processAudio = (meter as unknown as { processAudio: () => void }).processAudio.bind(meter)
  const leftChunk = new Float32Array(4800)
  const rightChunk = new Float32Array(4800)
  for (let index = 0; index < leftChunk.length; index += 1) {
    const sample = index % 2 === 0 ? 0.35 : -0.35
    leftChunk[index] = sample
    rightChunk[index] = sample
  }

  for (let iteration = 0; iteration < 400; iteration += 1) {
    chunkQueue.push({
      left: leftChunk,
      right: rightChunk,
    })
    processAudio()
  }

  const histogramCounts = (meter as unknown as { integratedHistogramCounts: Uint32Array }).integratedHistogramCounts
  const storedBlocks = histogramCounts.reduce((total, count) => total + count, 0)
  assert.equal(Object.prototype.hasOwnProperty.call(meter, 'integratedBlockLoudness'), false)
  assert.equal(histogramCounts.length > 0, true)
  assert.equal(storedBlocks > 100, true)
  assert.equal(Number.isFinite((meter as unknown as { integratedLUFS: number }).integratedLUFS), true)
})

test('NativePolledCaptureBackend schedules immediate, backoff, and hidden-document polls and cancels on stop', async () => {
  const timers = installFakeTimeouts()

  try {
    const { NativePolledCaptureBackend } = await import('../src/renderer/audio/AudioCapture')

    const drainResults = [
      {
        chunks: [{
          left: new Float32Array([0.1, 0.2]),
          right: new Float32Array([0.3, 0.4]),
          channelCount: 2,
          capturedAtMilliseconds: 5,
          sequence: 1,
        }],
        overwriteCount: 0,
        queueDepth: 0,
      },
      {
        chunks: [],
        overwriteCount: 0,
        queueDepth: 0,
      },
      {
        chunks: [],
        overwriteCount: 0,
        queueDepth: 0,
      },
    ]

    const nativeModule = {
      getSupport: () => ({ available: true, reason: null }),
      listOutputDevices: () => [],
      start: () => ({
        sampleRate: 48000,
        channelCount: 2,
        deviceId: 'device',
        deviceLabel: 'Device',
      }),
      stop: () => {},
      drain: () => drainResults.shift() ?? {
        chunks: [],
        overwriteCount: 0,
        queueDepth: 0,
      },
      nowMilliseconds: () => 0,
    }

    class TestNativeBackend extends NativePolledCaptureBackend {
      readonly kind = 'native-macos' as const

      protected getNativeCaptureModule() {
        return nativeModule
      }

      protected getBackendLabel(): string {
        return 'Test Native'
      }
    }

    const backend = new TestNativeBackend({
      kind: 'native-macos',
      available: true,
      reason: null,
    })
    const receivedSequences: number[] = []
    backend.subscribe((chunk) => {
      receivedSequences.push(chunk.sequence)
    })

    await backend.start()
    assert.equal(timers.nextDelay(), 0)

    timers.runNext()
    assert.deepEqual(receivedSequences, [1])
    assert.equal(timers.nextDelay(), 0)

    timers.runNext()
    assert.equal(timers.nextDelay(), 2)

    timers.setHidden(true)
    timers.runNext()
    assert.equal(timers.nextDelay(), 16)

    await backend.stop()
    assert.equal(timers.pendingCount(), 0)
  } finally {
    timers.restore()
  }
})

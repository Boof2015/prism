import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_VISUALIZER_TINT,
  colorToRgbChannels,
  parseColorToRgb,
  resolveColorToRgb,
} from '../src/renderer/utils/color'
import {
  createDefaultProfile,
} from '../src/shared/profileState'
import { usePerformanceStore } from '../src/renderer/stores/performanceStore'
import {
  moveDockedScopeOrder,
  useSettingsStore,
} from '../src/renderer/stores/settingsStore'
import {
  applyInputGainToStereoSamples,
  inputGainDbToLinear,
} from '../src/renderer/audio/inputGain'
import { SCOPE_KINDS, type ScopeKind } from '../src/types/scope'
import type { ScopePopoutStateMap } from '../src/types/popout'
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

type WindowWithRaf = typeof globalThis & Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>
type WindowWithTimers = typeof globalThis & Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  electronAPI: {
    platform: string
  }
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
        getMagnitudes: () => latestSpectrumMagnitudes,
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
  ])
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

test('moveDockedScopeOrder is a no-op at the docked boundaries', () => {
  const initialOrder = [...SCOPE_KINDS]

  assert.equal(
    moveDockedScopeOrder(initialOrder, new Set<ScopeKind>(), createScopePopouts(), 'spectrum', 'left'),
    initialOrder,
  )
  assert.equal(
    moveDockedScopeOrder(initialOrder, new Set<ScopeKind>(), createScopePopouts(), 'waveform', 'right'),
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
  assert.deepEqual(Array.from(transport.getLatestSpectrumMagnitudes() ?? []), [0.5, 0.5])
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
  assert.deepEqual(Array.from(transport.getLatestSpectrumMagnitudes() ?? []), [1, 1])

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
  assert.equal(transport.getLatestSpectrumMagnitudes(), null)
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
  assert.equal(transport.getLatestSpectrumMagnitudes(), null)
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

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_VISUALIZER_TINT,
  colorToRgbChannels,
  parseColorToRgb,
  resolveColorToRgb,
} from '../src/renderer/utils/color'
import { moveDockedScopeOrder } from '../src/renderer/stores/settingsStore'
import { SCOPE_KINDS, type ScopeKind } from '../src/types/scope'
import type { ScopePopoutStateMap } from '../src/types/popout'
import {
  VUMeterBallistics,
  VU_INTEGRATION_WINDOW_MS,
  VU_METER_MIN_DB,
  VU_PEAK_HOLD_MS,
} from '../src/renderer/visualizers/vuMeterBallistics'
import { VisualizerFrameLoop } from '../src/renderer/visualizers/visualizerFrameLoop'

type WindowWithRaf = typeof globalThis & Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>

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

test('VUMeterBallistics holds RMS and correlation steady when an active frame receives no chunks', () => {
  const sampleRate = 48000
  const windowSamples = Math.round((sampleRate * VU_INTEGRATION_WINDOW_MS) / 1000)
  const meter = new VUMeterBallistics(sampleRate)
  const initial = meter.process([createFilledStereoChunk(0.5, 0.5, windowSamples)], 300)
  const held = meter.process([], 316)

  assert.ok(initial.rmsLDb > -7 && initial.rmsLDb < -5)
  assertAlmostEqual(held.rmsLDb, initial.rmsLDb, 1e-12, 'left RMS should hold across empty frames')
  assertAlmostEqual(held.rmsRDb, initial.rmsRDb, 1e-12, 'right RMS should hold across empty frames')
  assertAlmostEqual(held.correlation, initial.correlation, 1e-12, 'correlation should hold across empty frames')
  assert.notEqual(held.rmsLDb, VU_METER_MIN_DB)
})

test('VUMeterBallistics produces the same RMS and correlation for contiguous and irregular chunk delivery', () => {
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
  assertAlmostEqual(irregularSnapshot.rmsLDb, contiguousSnapshot.rmsLDb, 1e-6, 'left RMS should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.rmsRDb, contiguousSnapshot.rmsRDb, 1e-6, 'right RMS should be chunking-invariant')
  assertAlmostEqual(irregularSnapshot.correlation, contiguousSnapshot.correlation, 1e-6, 'correlation should be chunking-invariant')
})

test('VUMeterBallistics tracks a transient peak independently of the RMS bar and decays it by elapsed time', () => {
  const sampleRate = 48000
  const windowSamples = Math.round((sampleRate * VU_INTEGRATION_WINDOW_MS) / 1000)
  const left = new Float32Array(windowSamples)
  const right = new Float32Array(windowSamples)
  left.fill(0.1)
  right.fill(0.1)
  left[Math.floor(windowSamples / 2)] = 1.0
  right[Math.floor(windowSamples / 2)] = 1.0

  const meter = new VUMeterBallistics(sampleRate)
  const initial = meter.process([{ left, right }], 300)
  const beforeDecay = meter.process([], 300 + VU_PEAK_HOLD_MS - 10)
  const afterDecay = meter.process([], 300 + VU_PEAK_HOLD_MS + 100)

  assert.ok(initial.rmsLDb < -19)
  assert.equal(initial.peakLDb, 0)
  assert.ok(initial.peakLDb > initial.rmsLDb + 10)
  assert.equal(beforeDecay.peakLDb, 0)
  assert.ok(afterDecay.peakLDb < beforeDecay.peakLDb)
  assert.ok(afterDecay.peakLDb > -3)
})

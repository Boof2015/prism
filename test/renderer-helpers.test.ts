import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_VISUALIZER_TINT,
  colorToRgbChannels,
  parseColorToRgb,
  parseColorToRgba,
  resolveColorToRgb,
} from '../src/renderer/utils/color'
import {
  getHorizontalWheelScrollResult,
  normalizeWheelDelta,
} from '../src/renderer/utils/horizontalWheelScroll'
import { resolveMainWindowSettingsHeight } from '../src/renderer/mainWindowSettings'
import {
  formatAstraTime,
  getAstraPlaybackProgress,
} from '../src/renderer/utils/astra'
import {
  createDefaultProfile,
} from '../src/shared/profileState'
import { resolveWindowCapabilities } from '../src/shared/windowCapabilities'
import {
  clampDraggedMainWindowBounds,
  raiseWindowAboveNormalPopouts,
  resolveExpandedMainWindowBounds,
} from '../src/shared/windowGeometry'
import { calculateResizedWindowBounds } from '../src/shared/windowResize'
import { createDefaultTheme, resolveNativeThemeSource, resolveTheme } from '../src/shared/themeState'
import { useAudioStore } from '../src/renderer/stores/audioStore'
import { usePerformanceStore } from '../src/renderer/stores/performanceStore'
import { buildProfileDraft, profilesMatch } from '../src/renderer/stores/profileDraft'
import {
  moveDockedScopeOrder,
  useSettingsStore,
} from '../src/renderer/stores/settingsStore'
import { useThemeStore } from '../src/renderer/stores/themeStore'
import { resolveThemeCreditDetails, resolveThemeOptionLabel } from '../src/renderer/components/BottomBar'
import { scopeSettingsToOptions } from '../src/renderer/components/ScopeModule'
import { scopeSummary } from '../src/renderer/components/ScopeSettingsSection'
import {
  applyInputGainToStereoSamples,
  inputGainDbToLinear,
} from '../src/renderer/audio/inputGain'
import { SCOPE_KINDS, type ScopeKind } from '../src/types/scope'
import type { ScopePopoutStateMap, WindowBounds } from '../src/types/popout'
import { RESIZE_DIRECTIONS } from '../src/types/windowResize'
import {
  DEFAULT_SPECTRUM_PEAK_INFO_MODE,
  formatSpectrumPitchInfo,
  normalizeSpectrumPeakInfoMode,
  resolveSpectrumPitchInfo,
  type SpectrumPeakInfo,
} from '../src/types/spectrum'
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
import {
  HEAT_LOW_DB,
  HEAT_MAX_DB,
  HEAT_MID_DB,
  HEAT_MIN_DB,
  normalizeHeatDb,
} from '../src/renderer/visualizers/heatScale'
import { LUFSMeter } from '../src/renderer/visualizers/LUFSMeter'
import { Oscilloscope } from '../src/renderer/visualizers/Oscilloscope'
import { SpectrumAnalyzer, type SpectrumAnalyzerOptions } from '../src/renderer/visualizers/SpectrumAnalyzer'
import { Spectrogram, type SpectrogramOptions } from '../src/renderer/visualizers/Spectrogram'
import { Vectorscope } from '../src/renderer/visualizers/Vectorscope'
import {
  drawVectorscopeGridForMode,
  getVectorscopeLayout,
} from '../src/renderer/visualizers/vectorscopeGrids'
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
import type { WindowCapabilities } from '../src/types/windowCapabilities'

type WindowWithRaf = typeof globalThis & Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>
type FakeElectronAPI = {
  platform: string
  windowCapabilities: WindowCapabilities
  [key: string]: unknown
}
type WindowWithTimers = typeof globalThis & Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  electronAPI: FakeElectronAPI
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
    electronAPI: {
      platform: 'darwin',
      windowCapabilities: resolveWindowCapabilities({ platform: 'darwin' }),
    },
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

function createSineStereoChunk(frequencyHz: number, sampleRate: number, length: number): {
  left: Float32Array
  right: Float32Array
} {
  const left = new Float32Array(length)
  const right = new Float32Array(length)

  for (let index = 0; index < length; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 0.8
    left[index] = sample
    right[index] = sample
  }

  return { left, right }
}

function createCompositeStereoChunk(
  partials: Array<{ frequencyHz: number; amplitude: number }>,
  sampleRate: number,
  length: number,
): {
  left: Float32Array
  right: Float32Array
} {
  const left = new Float32Array(length)
  const right = new Float32Array(length)

  for (let index = 0; index < length; index += 1) {
    let sample = 0
    for (const partial of partials) {
      sample += Math.sin((2 * Math.PI * partial.frequencyHz * index) / sampleRate) * partial.amplitude
    }
    left[index] = sample
    right[index] = sample
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
      windowCapabilities: resolveWindowCapabilities({ platform: 'darwin' }),
      ...overrides,
    } as FakeElectronAPI,
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

function createFakeStackableWindow(alwaysOnTop = false): {
  getMoveTopCalls: () => number
  window: {
    isDestroyed: () => boolean
    isAlwaysOnTop: () => boolean
    moveTop: () => void
  }
} {
  let moveTopCalls = 0

  return {
    getMoveTopCalls: () => moveTopCalls,
    window: {
      isDestroyed: () => false,
      isAlwaysOnTop: () => alwaysOnTop,
      moveTop: () => {
        moveTopCalls += 1
      },
    },
  }
}

function readSpectrumMagnitudes(transport: NativeVisualizerTransport, size = 8): number[] {
  const output = new Float32Array(size)
  const count = transport.fillLatestSpectrumMagnitudes(output)
  return Array.from(output.subarray(0, count))
}

interface FakeCanvasRecorder {
  fillRects: Array<{ x: number; y: number; width: number; height: number; fillStyle: string }>
  strokeRects: Array<{ x: number; y: number; width: number; height: number; lineDash: number[] }>
  arcs: Array<{
    x: number
    y: number
    radius: number
    startAngle: number
    endAngle: number
    anticlockwise: boolean
    lineDash: number[]
  }>
  lineDashes: number[][]
  imageDataWrites: Array<{ x: number; y: number; data: number[] }>
  drawImageCalls: Array<{ compositeOperation: GlobalCompositeOperation }>
}

function createFakeCanvasRecorder(): FakeCanvasRecorder {
  return {
    fillRects: [],
    strokeRects: [],
    arcs: [],
    lineDashes: [],
    imageDataWrites: [],
    drawImageCalls: [],
  }
}

function createFakeCanvasContext(recorder: FakeCanvasRecorder | null = null): CanvasRenderingContext2D {
  let currentLineDash: number[] = []
  let currentFillStyle = ''
  let currentStrokeStyle = ''
  let currentCompositeOperation: GlobalCompositeOperation = 'source-over'

  const context = {
    clearRect() {},
    fillRect(x: number, y: number, width: number, height: number) {
      recorder?.fillRects.push({ x, y, width, height, fillStyle: currentFillStyle })
    },
    fillText() {},
    beginPath() {},
    closePath() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    strokeRect(x: number, y: number, width: number, height: number) {
      recorder?.strokeRects.push({ x, y, width, height, lineDash: [...currentLineDash] })
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false) {
      recorder?.arcs.push({ x, y, radius, startAngle, endAngle, anticlockwise, lineDash: [...currentLineDash] })
    },
    drawImage() {
      recorder?.drawImageCalls.push({ compositeOperation: currentCompositeOperation })
    },
    putImageData(imageData: ImageData, x: number, y: number) {
      recorder?.imageDataWrites.push({ x, y, data: Array.from(imageData.data) })
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    setLineDash(segments: number[]) {
      currentLineDash = [...segments]
      recorder?.lineDashes.push([...segments])
    },
    getLineDash() {
      return [...currentLineDash]
    },
    createLinearGradient() {
      return {
        addColorStop() {},
      } as CanvasGradient
    },
    measureText() {
      return { width: 0 } as TextMetrics
    },
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    get fillStyle() {
      return currentFillStyle
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      currentFillStyle = typeof value === 'string' ? value : String(value)
    },
    get strokeStyle() {
      return currentStrokeStyle
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      currentStrokeStyle = typeof value === 'string' ? value : String(value)
    },
    get globalCompositeOperation() {
      return currentCompositeOperation
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      currentCompositeOperation = value
    },
  }

  return context as unknown as CanvasRenderingContext2D
}

function createFakeCanvas(recorder: FakeCanvasRecorder | null = null): HTMLCanvasElement {
  const context = createFakeCanvasContext(recorder)
  return {
    width: 320,
    height: 180,
    getContext: (kind: string) => kind === '2d' ? context : null,
  } as unknown as HTMLCanvasElement
}

function installFakeCanvasDom(createCanvas: () => HTMLCanvasElement = () => createFakeCanvas()): {
  restore: () => void
} {
  const globalWithDom = globalThis as typeof globalThis & {
    window?: Window
    document?: Document
    ImageData?: typeof ImageData
  }
  const previousWindow = globalWithDom.window
  const previousDocument = globalWithDom.document
  const previousImageData = globalWithDom.ImageData

  globalWithDom.window = {
    ...(previousWindow ?? globalThis),
    devicePixelRatio: 1,
  } as Window

  globalWithDom.document = {
    createElement(tagName: string) {
      if (tagName !== 'canvas') {
        throw new Error(`Unsupported element in test DOM: ${tagName}`)
      }
      return createCanvas()
    },
  } as Document

  if (globalWithDom.ImageData === undefined) {
    class FakeImageData {
      data: Uint8ClampedArray
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        this.data = new Uint8ClampedArray(width * height * 4)
      }
    }

    globalWithDom.ImageData = FakeImageData as unknown as typeof ImageData
  }

  return {
    restore(): void {
      if (previousWindow === undefined) {
        delete globalWithDom.window
      } else {
        globalWithDom.window = previousWindow
      }

      if (previousDocument === undefined) {
        delete globalWithDom.document
      } else {
        globalWithDom.document = previousDocument
      }

      if (previousImageData === undefined) {
        delete globalWithDom.ImageData
      } else {
        globalWithDom.ImageData = previousImageData
      }
    },
  }
}

function assertArraysAlmostEqual(actual: number[], expected: number[], tolerance: number, message: string): void {
  assert.equal(actual.length, expected.length, `${message}: length mismatch`)
  for (let index = 0; index < actual.length; index += 1) {
    if (Math.abs(actual[index] - expected[index]) > tolerance) {
      assert.fail(`${message}: arrays diverged at index ${index}; expected ${expected[index]}, got ${actual[index]}`)
    }
  }
}

function assertArraysDiffer(actual: number[], expected: number[], tolerance: number, message: string): void {
  for (let index = 0; index < actual.length; index += 1) {
    if (Math.abs(actual[index] - expected[index]) > tolerance) {
      return
    }
  }
  assert.fail(message)
}

function renderSpectrumSnapshot(options: Partial<SpectrumAnalyzerOptions>): {
  primaryPointY: number[]
  heatmapPointY: number[]
  renderedHeatmapY: number[]
  heatmapIntensity: number[]
} {
  const dom = installFakeCanvasDom()
  const { left, right } = createProgramSamples(2048)
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [{ left, right }],
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    heatmapFill: true,
    fillGradient: false,
    showGrid: false,
    dataSource,
    ...options,
  })

  try {
    const state = analyzer as unknown as {
      drawFrame: () => void
      renderHeatmap: (
        xPoints: Float32Array,
        yPoints: Float32Array,
        heatmapIntensity: Float32Array,
        pointCount: number,
        width: number,
        height: number,
      ) => void
      primaryPointY: Float32Array
      heatmapPointY: Float32Array
      primaryPointHeatmap: Float32Array
    }
    const originalRenderHeatmap = state.renderHeatmap.bind(state)
    let renderedHeatmapY: number[] = []
    state.renderHeatmap = (xPoints, yPoints, heatmapIntensity, pointCount, width, height) => {
      renderedHeatmapY = Array.from(yPoints.subarray(0, pointCount))
      originalRenderHeatmap(xPoints, yPoints, heatmapIntensity, pointCount, width, height)
    }

    state.drawFrame()
    const snapshotState = analyzer as unknown as {
      primaryPointY: Float32Array
      heatmapPointY: Float32Array
      primaryPointHeatmap: Float32Array
    }
    return {
      primaryPointY: Array.from(snapshotState.primaryPointY),
      heatmapPointY: Array.from(snapshotState.heatmapPointY),
      renderedHeatmapY,
      heatmapIntensity: Array.from(snapshotState.primaryPointHeatmap),
    }
  } finally {
    analyzer.dispose()
    dom.restore()
  }
}

function renderSpectrumHeatmap(
  options: Partial<SpectrumAnalyzerOptions>,
  heatmapIntensity: number[],
  yPoints: number[] = heatmapIntensity.map(() => 0),
): FakeCanvasRecorder {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom()
  const canvas = createFakeCanvas(recorder)
  canvas.width = heatmapIntensity.length
  canvas.height = 24
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(canvas, {
    showSideLine: true,
    heatmapFill: true,
    fillGradient: false,
    showGrid: false,
    dataSource,
    ...options,
  })

  try {
    const state = analyzer as unknown as {
      renderHeatmap: (
        xPoints: Float32Array,
        yPoints: Float32Array,
        heatmapIntensity: Float32Array,
        pointCount: number,
        width: number,
        height: number,
      ) => void
    }
    state.renderHeatmap(
      Float32Array.from(heatmapIntensity.map((_value, index) => index)),
      Float32Array.from(yPoints),
      Float32Array.from(heatmapIntensity),
      heatmapIntensity.length,
      canvas.width,
      canvas.height,
    )
    return recorder
  } finally {
    analyzer.dispose()
    dom.restore()
  }
}

function projectSpectrumDb(options: Partial<SpectrumAnalyzerOptions>, db: number): {
  heatmapIntensity: number[]
  yPoints: number[]
} {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    showGrid: false,
    dataSource,
    ...options,
  })

  try {
    const state = analyzer as unknown as {
      fillSpectrumPoints: (
        frequencyData: Float32Array,
        dataLength: number,
        width: number,
        height: number,
        minFrequency: number,
        maxFrequency: number,
        nyquist: number,
        tiltDbPerOctave: number,
        xOut: Float32Array,
        yOut: Float32Array,
        heatmapIntensityOut: Float32Array | null,
      ) => { pointCount: number }
    }
    const pointCount = 2
    const xOut = new Float32Array(pointCount)
    const yOut = new Float32Array(pointCount)
    const heatmapIntensity = new Float32Array(pointCount)
    const result = state.fillSpectrumPoints(
      Float32Array.from([db, db, db, db]),
      4,
      pointCount,
      100,
      20,
      40,
      2000,
      0,
      xOut,
      yOut,
      heatmapIntensity,
    )

    return {
      heatmapIntensity: Array.from(heatmapIntensity.subarray(0, result.pointCount)),
      yPoints: Array.from(yOut.subarray(0, result.pointCount)),
    }
  } finally {
    analyzer.dispose()
    dom.restore()
  }
}

function renderSpectrogramColumnImage(options: Partial<SpectrogramOptions>, values: number[]): number[] {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const canvas = createFakeCanvas()
  canvas.width = 1
  canvas.height = values.length
  const dataSource = {
    getPendingSpectrogramSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }

  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    ...options,
  })

  try {
    const state = spectrogram as unknown as {
      ensureColumnBuffers: (height: number) => void
      shiftAndPaintColumn: (values: Float32Array) => void
    }
    state.ensureColumnBuffers(values.length)
    state.shiftAndPaintColumn(Float32Array.from(values))
    return recorder.imageDataWrites.at(-1)?.data ?? []
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
}

function renderSpectrogramShift(options: Partial<SpectrogramOptions>, values: number[]): FakeCanvasRecorder {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const canvas = createFakeCanvas()
  canvas.width = 4
  canvas.height = values.length
  const dataSource = {
    getPendingSpectrogramSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }

  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    ...options,
  })

  try {
    const state = spectrogram as unknown as {
      ensureColumnBuffers: (height: number) => void
      shiftAndPaintColumn: (values: Float32Array) => void
    }
    state.ensureColumnBuffers(values.length)
    state.shiftAndPaintColumn(Float32Array.from(values))
    return recorder
  } finally {
    spectrogram.dispose()
    dom.restore()
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
    'nowPlaying',
  ])
})

test('scopeSettingsToOptions wires spectrum side overlay settings into analyzer options', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.spectrum.showSideLine = true
  profile.scopeSettings.spectrum.heatmapSmoothing = 0.64
  const theme = resolveTheme(createDefaultTheme())

  const options = scopeSettingsToOptions('spectrum', profile.scopeSettings.spectrum, theme.spectrum)

  assert.equal(options.showSideLine, true)
  assert.equal(options.heatmapSmoothing, 0.64)
  assert.equal(options.secondaryLineColor, theme.spectrum.sideLine)
  assert.equal(options.lineColor, theme.spectrum.line)
  assert.equal(options.backgroundColor, theme.spectrum.background)
  assert.equal(options.gridColor, theme.spectrum.guides)
})

test('default profile starts with spectrum peak info disabled', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(profile.scopeSettings.spectrum.peakInfoMode, DEFAULT_SPECTRUM_PEAK_INFO_MODE)
  assert.equal(normalizeSpectrumPeakInfoMode('nope'), DEFAULT_SPECTRUM_PEAK_INFO_MODE)
})

test('spectrum pitch helpers format nearest note with octave and cents', () => {
  assert.equal(formatSpectrumPitchInfo(resolveSpectrumPitchInfo(440)), 'A4 0c')
  assert.equal(formatSpectrumPitchInfo(resolveSpectrumPitchInfo(261.6255653005986)), 'C4 0c')
  assert.equal(formatSpectrumPitchInfo(resolveSpectrumPitchInfo(Number.NaN)), '--')
})

test('normalizeHeatDb uses the shared hybrid heat window', () => {
  assert.equal(normalizeHeatDb(HEAT_MIN_DB), 0)
  assert.equal(normalizeHeatDb(-60), 0.5)
  assert.equal(normalizeHeatDb(HEAT_MAX_DB), 1)
  assert.equal(normalizeHeatDb(-140), 0)
  assert.equal(normalizeHeatDb(12), 1)
  assert.equal(normalizeHeatDb(Number.NaN), 0)
})

test('SpectrumAnalyzer heat intensity uses shared heat scale without changing line geometry', () => {
  const referenceDb = -60
  const defaultLine = projectSpectrumDb({
    minDecibels: -90,
    maxDecibels: -10,
  }, referenceDb)
  const expandedLine = projectSpectrumDb({
    minDecibels: -120,
    maxDecibels: 0,
  }, referenceDb)
  const expectedHeat = Math.pow(normalizeHeatDb(referenceDb), 1.4)

  assertAlmostEqual(defaultLine.heatmapIntensity[0], expectedHeat, 1e-6, 'heat intensity should use shared heat dB normalization')
  assertArraysAlmostEqual(
    defaultLine.heatmapIntensity,
    expandedLine.heatmapIntensity,
    1e-6,
    'heat intensity should ignore spectrum line min/max dB options',
  )
  assertArraysDiffer(
    defaultLine.yPoints,
    expandedLine.yPoints,
    1e-6,
    'line geometry should still respond to spectrum line min/max dB options',
  )
})

test('SpectrumAnalyzer heatmap output does not change when only line smoothing changes', () => {
  const looseLine = renderSpectrumSnapshot({
    smoothing: 0,
    heatmapSmoothing: 0.5,
  })
  const tightLine = renderSpectrumSnapshot({
    smoothing: 0.99,
    heatmapSmoothing: 0.5,
  })

  assertArraysDiffer(
    looseLine.primaryPointY,
    tightLine.primaryPointY,
    1e-6,
    'line path should respond to the line smoothing control',
  )
  assertArraysAlmostEqual(
    looseLine.heatmapIntensity,
    tightLine.heatmapIntensity,
    1e-6,
    'heatmap intensity should ignore the line smoothing control',
  )
  assertArraysAlmostEqual(
    looseLine.renderedHeatmapY,
    looseLine.primaryPointY,
    1e-6,
    'rendered heatmap fill should follow the line geometry',
  )
  assertArraysAlmostEqual(
    tightLine.renderedHeatmapY,
    tightLine.primaryPointY,
    1e-6,
    'rendered heatmap fill should follow the line geometry',
  )
})

test('SpectrumAnalyzer line output does not change when only heatmap smoothing changes', () => {
  const looseHeat = renderSpectrumSnapshot({
    smoothing: 0.9,
    heatmapSmoothing: 0,
  })
  const tightHeat = renderSpectrumSnapshot({
    smoothing: 0.9,
    heatmapSmoothing: 0.99,
  })

  assertArraysAlmostEqual(
    looseHeat.primaryPointY,
    tightHeat.primaryPointY,
    1e-6,
    'line path should ignore the heatmap smoothing control',
  )
  assertArraysDiffer(
    looseHeat.heatmapIntensity,
    tightHeat.heatmapIntensity,
    1e-6,
    'heatmap intensity should respond to the heatmap smoothing control',
  )
  assertArraysAlmostEqual(
    looseHeat.renderedHeatmapY,
    looseHeat.primaryPointY,
    1e-6,
    'rendered heatmap fill should follow the line geometry',
  )
  assertArraysAlmostEqual(
    tightHeat.renderedHeatmapY,
    tightHeat.primaryPointY,
    1e-6,
    'rendered heatmap fill should follow the line geometry',
  )
})

test('SpectrumAnalyzer renders heatmap fill on the spectrum line', () => {
  const snapshot = renderSpectrumSnapshot({
    smoothing: 0.99,
    heatmapSmoothing: 0,
  })

  assertArraysAlmostEqual(snapshot.renderedHeatmapY, snapshot.primaryPointY, 1e-6, 'heatmap fill should use the line geometry')
})

test('SpectrumAnalyzer heatmap does not repaint the full viewport when heat base is omitted', () => {
  const recorder = renderSpectrumHeatmap({}, [0.24, 0.62, 1])

  assert.equal(
    recorder.fillRects.some((rect) => rect.x === 0 && rect.y === 0 && rect.width === 3 && rect.height === 24),
    false,
  )
})

test('SpectrumAnalyzer heatmap honors authored token alpha for low-end heat colors', () => {
  const recorder = renderSpectrumHeatmap({
    heatColors: [
      'rgba(15, 7, 33, 0)',
      'rgba(163, 26, 121, 0.6)',
      'rgb(255, 241, 209)',
    ],
  }, [0.48, 0.62, 1])

  const renderedAlpha = recorder.fillRects
    .map((rect) => parseColorToRgba(rect.fillStyle)?.a ?? null)
    .filter((value): value is number => value !== null)

  assert.equal(renderedAlpha.some((value) => value > 0 && value < 1), true)
  assert.equal(renderedAlpha.some((value) => Math.abs(value - 1) < 1e-3), true)
})

test('SpectrumAnalyzer heat base only fills the visible heatmap area under the curve', () => {
  const recorder = renderSpectrumHeatmap(
    {
      heatBaseColor: 'rgb(12, 34, 56)',
      heatColors: [
        'rgba(15, 7, 33, 0)',
        'rgba(163, 26, 121, 0)',
        'rgba(255, 241, 209, 0)',
      ],
    },
    [0, 0, 0],
    [8, 12, 16],
  )

  const baseRects = recorder.fillRects.filter((rect) => rect.fillStyle === 'rgb(12, 34, 56)')
  assert.equal(baseRects.length, 3)
  assert.deepEqual(
    baseRects.map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
    [
      { x: 0, y: 8, width: 1, height: 16 },
      { x: 1, y: 12, width: 1, height: 12 },
      { x: 2, y: 16, width: 1, height: 8 },
    ],
  )
})

test('Spectrogram heatmap preserves authored alpha in generated image data', () => {
  const imageData = renderSpectrogramColumnImage({
    heatColors: [
      'rgba(15, 7, 33, 0)',
      'rgba(163, 26, 121, 0.5)',
      'rgb(255, 241, 209)',
    ],
  }, [0, 0.62, 1])

  assert.equal(imageData[3], 0)
  assert.equal(imageData[7] > 0 && imageData[7] < 255, true)
  assert.equal(imageData[11], 255)
})

test('Spectrogram solid color uses intensity as alpha while preserving tint RGB', () => {
  const imageData = renderSpectrogramColumnImage({
    colorScheme: 'mono',
    lineColor: 'rgb(10, 20, 30)',
  }, [0, 0.5, 1])

  assert.deepEqual(imageData.slice(0, 3), [10, 20, 30])
  assert.equal(imageData[3], 0)
  assert.deepEqual(imageData.slice(4, 7), [10, 20, 30])
  assert.equal(imageData[7], 128)
  assert.deepEqual(imageData.slice(8, 11), [10, 20, 30])
  assert.equal(imageData[11], 255)
})

test('Spectrogram solid color honors authored tint alpha', () => {
  const imageData = renderSpectrogramColumnImage({
    colorScheme: 'mono',
    lineColor: 'rgba(100, 150, 200, 0.5)',
  }, [0.5, 1])

  assert.deepEqual(imageData.slice(0, 3), [100, 150, 200])
  assert.equal(imageData[3], 64)
  assert.deepEqual(imageData.slice(4, 7), [100, 150, 200])
  assert.equal(imageData[7], 128)
})

test('Spectrogram keeps the historical display dB range for line thickness', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingSpectrogramSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const spectrogram = new Spectrogram(createFakeCanvas(), { dataSource })

  try {
    const state = spectrogram as unknown as {
      options: {
        minDecibels: number
        maxDecibels: number
      }
    }
    assert.equal(state.options.minDecibels, -90)
    assert.equal(state.options.maxDecibels, -12)
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram display gain feeds both display and heat intensity', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingSpectrogramSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const canvas = createFakeCanvas()
  canvas.width = 1
  canvas.height = 1
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    clarityMode: 'classic',
    minDecibels: -90,
    maxDecibels: -12,
  })

  try {
    const state = spectrogram as unknown as {
      drawColumn: (magnitudes: Float32Array) => Float32Array
      heatColumnValues: Float32Array
      rowCenterBins: Float32Array
      rowBandStartBins: Float32Array
      rowBandEndBins: Float32Array
    }
    state.rowCenterBins = Float32Array.from([1])
    state.rowBandStartBins = Float32Array.from([0.5])
    state.rowBandEndBins = Float32Array.from([1.5])

    const magnitudes = new Float32Array(24)
    magnitudes.fill(-120)
    magnitudes[1] = -66
    const values = state.drawColumn(magnitudes)
    const expectedDisplay = Math.pow((-64 - (-90)) / (-12 - (-90)), 1.4)
    const expectedHeat = normalizeHeatDb(-58)

    assertAlmostEqual(values[0], expectedDisplay, 1e-6, 'display intensity should include spectrogram display gain')
    assertAlmostEqual(state.heatColumnValues[0], expectedHeat, 1e-6, 'heat color should include display gain before heat compensation')
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram tilt adds 4 dB per octave above the reference frequency', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingSpectrogramSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const canvas = createFakeCanvas()
  canvas.width = 1
  canvas.height = 1
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    clarityMode: 'classic',
    minDecibels: -90,
    maxDecibels: -12,
  })

  try {
    const state = spectrogram as unknown as {
      drawColumn: (magnitudes: Float32Array) => Float32Array
      heatColumnValues: Float32Array
      rowCenterBins: Float32Array
      rowBandStartBins: Float32Array
      rowBandEndBins: Float32Array
    }
    state.rowCenterBins = Float32Array.from([2])
    state.rowBandStartBins = Float32Array.from([1.5])
    state.rowBandEndBins = Float32Array.from([2.5])

    const magnitudes = new Float32Array(24)
    magnitudes.fill(-120)
    magnitudes[2] = -66
    const values = state.drawColumn(magnitudes)
    const expectedDisplay = Math.pow((-60 - (-90)) / (-12 - (-90)), 1.4)
    const expectedHeat = normalizeHeatDb(-54)

    assertAlmostEqual(values[0], expectedDisplay, 1e-6, 'display intensity should include +4 dB/oct spectrogram tilt')
    assertAlmostEqual(state.heatColumnValues[0], expectedHeat, 1e-6, 'heat color should include +4 dB/oct spectrogram tilt')
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram custom heat colors land on shared low mid and high thresholds', () => {
  const imageData = renderSpectrogramColumnImage({
    heatColors: [
      'rgb(10, 20, 30)',
      'rgb(40, 50, 60)',
      'rgb(70, 80, 90)',
    ],
  }, [
    normalizeHeatDb(HEAT_LOW_DB),
    normalizeHeatDb(HEAT_MID_DB),
    normalizeHeatDb(HEAT_MAX_DB),
  ])

  assert.deepEqual(imageData.slice(0, 3), [10, 20, 30])
  assert.deepEqual(imageData.slice(4, 7), [40, 50, 60])
  assert.deepEqual(imageData.slice(8, 11), [70, 80, 90])
  assert.equal(imageData[3] > 0 && imageData[3] < imageData[7], true)
  assert.equal(imageData[7] > imageData[3] && imageData[7] < imageData[11], true)
  assert.equal(imageData[11], 255)
})

test('Spectrogram low-intensity heat stays mostly transparent with default RGB heat colors', () => {
  const imageData = renderSpectrogramColumnImage({
    heatColors: [
      'rgb(15, 7, 33)',
      'rgb(163, 26, 121)',
      'rgb(255, 241, 209)',
    ],
  }, [0, 0.1, 1])

  assert.equal(imageData[3], 0)
  assert.equal(imageData[7] > 0 && imageData[7] < 40, true)
  assert.equal(imageData[11], 255)
})

test('Spectrogram shifts existing columns with copy compositing to avoid transparent streaking', () => {
  const recorder = renderSpectrogramShift({
    heatColors: [
      'rgba(15, 7, 33, 0)',
      'rgba(163, 26, 121, 0.5)',
      'rgb(255, 241, 209)',
    ],
  }, [0.2, 0.6, 1])

  assert.equal(recorder.drawImageCalls.at(-1)?.compositeOperation, 'copy')
})

test('SpectrumAnalyzer reports peak info from the visible spectrum curve', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const { left, right } = createSineStereoChunk(440, sampleRate, 4096)
  let peakInfo: SpectrumPeakInfo | null = null
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [{ left, right }],
    getSampleRate: () => sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    showGrid: false,
    fillGradient: false,
    smoothing: 0,
    tiltDbPerOctave: 0,
    fftSize: 4096,
    dataSource,
    capturePeakInfo: true,
    onPeakInfo: (nextPeakInfo) => {
      peakInfo = nextPeakInfo
    },
  })

  try {
    const state = analyzer as unknown as {
      drawFrame: () => void
      primaryPointFrequency: Float32Array
      isLocalPeak: (index: number, pointCount: number) => boolean
    }
    state.drawFrame()

    assert.ok(peakInfo, 'expected peak info to be reported')
    assert.ok(peakInfo.frequencyHz > 437 && peakInfo.frequencyHz < 443, `expected peak frequency near 440 Hz, got ${peakInfo.frequencyHz}`)
    assert.match(peakInfo.key, /^A4 [+-]?\d+c$/)
    assert.ok(peakInfo.db > -20, `expected an audible peak dB, got ${peakInfo.db}`)
    assert.ok(peakInfo.normalizedX >= 0 && peakInfo.normalizedX <= 1, 'peak x should be normalized')
    assert.ok(peakInfo.normalizedY >= 0 && peakInfo.normalizedY <= 1, 'peak y should be normalized')

    let selectedIndex = 0
    let smallestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < state.primaryPointFrequency.length; index += 1) {
      if (!state.isLocalPeak(index, state.primaryPointFrequency.length)) {
        continue
      }
      const distance = Math.abs(state.primaryPointFrequency[index] - peakInfo.frequencyHz)
      if (distance < smallestDistance) {
        smallestDistance = distance
        selectedIndex = index
      }
    }
    assert.equal(
      state.isLocalPeak(selectedIndex, state.primaryPointFrequency.length),
      true,
      'reported peak should stay anchored to a local maximum on the rendered curve',
    )
    assert.ok(
      smallestDistance < 3,
      `expected reported peak frequency to stay near a local-peak candidate, got distance ${smallestDistance}`,
    )
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('SpectrumAnalyzer smooths peak selection without smoothing the reported position', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const frameA = createCompositeStereoChunk([
    { frequencyHz: 440, amplitude: 0.95 },
    { frequencyHz: 660, amplitude: 0.6 },
  ], sampleRate, 4096)
  const frameB = createCompositeStereoChunk([
    { frequencyHz: 440, amplitude: 0.72 },
    { frequencyHz: 660, amplitude: 0.84 },
  ], sampleRate, 4096)
  const frameC = createCompositeStereoChunk([
    { frequencyHz: 440, amplitude: 0.28 },
    { frequencyHz: 660, amplitude: 0.95 },
  ], sampleRate, 4096)
  const pendingFrames = [frameA, frameB, frameC]
  const peakKeys: string[] = []
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => {
      const nextFrame = pendingFrames.shift()
      return nextFrame ? [nextFrame] : []
    },
    getSampleRate: () => sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    showGrid: false,
    fillGradient: false,
    smoothing: 0,
    tiltDbPerOctave: 0,
    fftSize: 4096,
    dataSource,
    capturePeakInfo: true,
    onPeakInfo: (nextPeakInfo) => {
      if (nextPeakInfo) {
        peakKeys.push(nextPeakInfo.key)
      }
    },
  })

  try {
    const state = analyzer as unknown as {
      drawFrame: () => void
    }
    state.drawFrame()
    state.drawFrame()
    state.drawFrame()

    assert.match(peakKeys[0] ?? '', /^A4 [+-]?\d+c$/)
    assert.match(peakKeys[1] ?? '', /^A4 [+-]?\d+c$/)
    assert.match(peakKeys[2] ?? '', /^E5 [+-]?\d+c$/)
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('SpectrumAnalyzer does not over-bias toward an octave-lower peak', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const frame = createCompositeStereoChunk([
    { frequencyHz: 174.614, amplitude: 0.8 },
    { frequencyHz: 349.228, amplitude: 1.0 },
  ], sampleRate, 4096)
  let peakInfo: SpectrumPeakInfo | null = null
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [frame],
    getSampleRate: () => sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    showGrid: false,
    fillGradient: false,
    smoothing: 0,
    tiltDbPerOctave: 0,
    fftSize: 4096,
    dataSource,
    capturePeakInfo: true,
    onPeakInfo: (nextPeakInfo) => {
      peakInfo = nextPeakInfo
    },
  })

  try {
    const state = analyzer as unknown as { drawFrame: () => void }
    state.drawFrame()

    assert.ok(peakInfo, 'expected peak info to be reported')
    assert.match(peakInfo.key, /^F4 [+-]?\d+c$/)
    assert.ok(
      peakInfo.frequencyHz > 347 && peakInfo.frequencyHz < 351,
      `expected peak frequency near 349 Hz, got ${peakInfo.frequencyHz}`,
    )
  } finally {
    analyzer.dispose()
    dom.restore()
  }
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
  assert.equal(Object.hasOwn(options, 'gainDb'), false)
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

test('Oscilloscope projects raw sample amplitude without renderer gain', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingOscilloscopeSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const oscilloscope = new Oscilloscope(createFakeCanvas(), { dataSource })

  try {
    const state = oscilloscope as unknown as {
      projectSampleY: (sample: number, height: number) => number
    }

    assert.equal(state.projectSampleY(0.5, 180), 45)
    assert.equal(state.projectSampleY(-0.5, 180), 135)
  } finally {
    oscilloscope.dispose()
    dom.restore()
  }
})

test('Vectorscope uses the base layout radius for projection scale', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingVectorscopeSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(), { dataSource })

  try {
    const state = vectorscope as unknown as {
      getProjectionScale: (radius: number) => number
    }
    const layout = getVectorscopeLayout(320, 180, 'lissajous')

    assert.equal(state.getProjectionScale(layout.radius), layout.radius)
    assert.equal(layout.radius, 81)
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
})

test('vectorscope adds a subtle dashed outer boundary without changing the base graph', () => {
  const lissajousRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(lissajousRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'lissajous',
  )
  assert.equal(
    lissajousRecorder.lineDashes.some((segments) => segments.length > 0),
    false,
    'lissajous should not render an outer headroom boundary',
  )

  const linearRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(linearRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'linear-bipolar',
  )
  assert.equal(
    linearRecorder.lineDashes.some((segments) => segments.length > 0),
    true,
    'linear mode should render a dashed outer max boundary',
  )

  const polarRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(polarRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'polar-bipolar',
  )
  const polarLayout = getVectorscopeLayout(320, 180, 'polar-bipolar')
  const dashedPolarArc = polarRecorder.arcs.find((arc) => arc.lineDash.length > 0)
  const expectedPolarOverflowRadius = Math.min(
    Math.min(polarLayout.centerX, 320 - polarLayout.centerX, polarLayout.centerY, 180 - polarLayout.centerY) * 0.98,
    polarLayout.radius * 1.25,
  )
  assert.equal(
    polarRecorder.lineDashes.some((segments) => segments.length > 0),
    true,
    'polar mode should render a dashed outer boundary',
  )
  assert.ok(
    dashedPolarArc && dashedPolarArc.radius > polarLayout.radius,
    'polar dashed boundary should sit outside the existing graph',
  )
  assertAlmostEqual(
    dashedPolarArc?.radius ?? 0,
    expectedPolarOverflowRadius,
    1e-6,
    'polar dashed boundary should follow the next relative grid step, clamped to the canvas',
  )
})

test('Vectorscope keeps the original linear projection behavior', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingVectorscopeSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(), { dataSource })

  try {
    const state = vectorscope as unknown as {
      drawProjectedDot: (
        ctx: CanvasRenderingContext2D,
        left: number,
        right: number,
        mode: 'linear-bipolar',
        centerX: number,
        centerY: number,
        scale: number,
        dotSize: number,
      ) => void
      getProjectionScale: (radius: number) => number
    }
    const layout = getVectorscopeLayout(320, 180, 'linear-bipolar')
    const recorder = createFakeCanvasRecorder()
    const ctx = createFakeCanvasContext(recorder)
    const scale = state.getProjectionScale(layout.radius)

    state.drawProjectedDot(ctx, -1, 1, 'linear-bipolar', layout.centerX, layout.centerY, scale, 2)

    assert.equal(recorder.fillRects.length, 1)
    const rect = recorder.fillRects[0]
    const projectedCenterX = rect.x + rect.width / 2
    const projectedCenterY = rect.y + rect.height / 2
    assertAlmostEqual(
      projectedCenterX,
      layout.centerX + layout.radius * Math.SQRT2,
      1e-6,
      'linear projection should preserve the original unscaled mapping',
    )
    assertAlmostEqual(
      projectedCenterY,
      layout.centerY,
      1e-6,
      'linear overs peak should stay on the side axis',
    )
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
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

test('scopeSummary includes only waveform display modes', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Mono')

  profile.scopeSettings.waveform.mode = 'stereo'
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Stereo')

  profile.scopeSettings.waveform.multiband = true
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Stereo · RGB')
})

test('scopeSummary includes spectrum peak mode when enabled', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'Fill · FFT 2048')

  profile.scopeSettings.spectrum.peakInfoMode = 'on'
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'Fill · FFT 2048 · Peak')

  profile.scopeSettings.spectrum.peakInfoMode = 'following'
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'Fill · FFT 2048 · Peak Follow')
})

test('scopeSummary summarizes now playing field visibility', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.nowPlaying.showArtist = false
  profile.scopeSettings.nowPlaying.showControls = false

  assert.equal(scopeSummary('nowPlaying', profile.scopeSettings.nowPlaying), 'Cover · Title · Bar · Time')
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

test('applying a profile snapshot does not change the machine-local trim', () => {
  const previousAudioState = useAudioStore.getState()
  const previousSettingsState = useSettingsStore.getState()

  try {
    useAudioStore.setState({ inputGainDb: 6.5 })

    const defaultProfile = createDefaultProfile('Default')
    const alternateProfile = createDefaultProfile('Live Mix')
    alternateProfile.hiddenScopes = []

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: 'profile_live_mix',
      profiles: {
        profile_default: defaultProfile,
        profile_live_mix: alternateProfile,
      },
    })

    assert.equal(useAudioStore.getState().inputGainDb, 6.5)
  } finally {
    useAudioStore.setState(previousAudioState)
    useSettingsStore.setState(previousSettingsState)
  }
})

test('profile draft comparisons return to clean after reverting a change', () => {
  const baselineProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  baselineProfile.windowBounds = { x: 24, y: 48, width: 900, height: 180 }
  baselineProfile.scopePopouts.spectrum = {
    poppedOut: true,
    windowBounds: { x: 160, y: 90, width: 420, height: 240 },
  }

  const baselineDraft = buildProfileDraft({
    scopeOrder: baselineProfile.scopeOrder,
    hiddenScopes: baselineProfile.hiddenScopes,
    widthWeights: baselineProfile.widthWeights,
    scopeSettings: baselineProfile.scopeSettings,
    scopePopouts: baselineProfile.scopePopouts,
    windowBounds: baselineProfile.windowBounds,
  }, baselineProfile.name)

  const changedDraft = buildProfileDraft({
    scopeOrder: baselineProfile.scopeOrder,
    hiddenScopes: baselineProfile.hiddenScopes,
    widthWeights: baselineProfile.widthWeights,
    scopeSettings: {
      ...baselineProfile.scopeSettings,
      waveform: {
        ...baselineProfile.scopeSettings.waveform,
        scrollSpeed: baselineProfile.scopeSettings.waveform.scrollSpeed + 1,
      },
    },
    scopePopouts: baselineProfile.scopePopouts,
    windowBounds: baselineProfile.windowBounds,
  }, baselineProfile.name)

  const revertedDraft = buildProfileDraft({
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

test('buildProfileDraft omits theme metadata from the runtime draft', () => {
  const profile = createDefaultProfile('Live Mix')

  const draft = buildProfileDraft({
    scopeOrder: profile.scopeOrder,
    hiddenScopes: profile.hiddenScopes,
    widthWeights: profile.widthWeights,
    scopeSettings: profile.scopeSettings,
    scopePopouts: profile.scopePopouts,
    windowBounds: profile.windowBounds,
  }, profile.name)

  assert.equal('themeId' in draft, false)
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

test('resolveThemeCreditDetails normalizes descriptions and enables links only for valid http and https theme websites', () => {
  assert.deepEqual(
    resolveThemeCreditDetails({
      credit: 'Night Shift',
      website: 'https://themes.example/night',
      description: '  Soft neon palette  ',
    }),
    {
      credit: 'Night Shift',
      url: 'https://themes.example/night',
      description: 'Soft neon palette',
    },
  )
  assert.deepEqual(
    resolveThemeCreditDetails({
      credit: 'Night Shift',
      website: 'http://themes.example/night',
      description: 'Soft neon palette',
    }),
    {
      credit: 'Night Shift',
      url: 'http://themes.example/night',
      description: 'Soft neon palette',
    },
  )
  assert.deepEqual(
    resolveThemeCreditDetails({
      credit: 'Night Shift',
      website: 'ftp://themes.example/night',
      description: 'Soft neon palette',
    }),
    {
      credit: 'Night Shift',
      url: null,
      description: 'Soft neon palette',
    },
  )
  assert.deepEqual(
    resolveThemeCreditDetails({
      credit: 'Night Shift',
      website: 'not a url',
      description: 'Soft neon palette',
    }),
    {
      credit: 'Night Shift',
      url: null,
      description: 'Soft neon palette',
    },
  )
  assert.deepEqual(
    resolveThemeCreditDetails({ credit: '   ', website: 'https://themes.example/night' }),
    {
      credit: null,
      url: null,
      description: null,
    },
  )
  assert.deepEqual(
    resolveThemeCreditDetails({ description: 'Soft neon palette' }),
    {
      credit: null,
      url: null,
      description: null,
    },
  )
})

test('resolveThemeOptionLabel appends creator credit when present', () => {
  assert.equal(
    resolveThemeOptionLabel({ name: 'Night Shift', credit: 'Astra' }),
    'Night Shift - Astra',
  )
  assert.equal(
    resolveThemeOptionLabel({ name: 'Night Shift' }),
    'Night Shift',
  )
  assert.equal(
    resolveThemeOptionLabel({ name: 'Night Shift', credit: '   ' }),
    'Night Shift',
  )
})

test('BottomBar theme section renders compact credit metadata and opens valid links through Electron', async () => {
  const componentSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'BottomBar.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')

  assert.match(componentSource, /const themeCredit = resolveThemeCreditDetails\(activeTheme\)/)
  assert.match(componentSource, /window\.electronAPI\.openExternalUrl\(url\)/)
  assert.match(componentSource, /bottom-bar__theme-metadata/)
  assert.match(componentSource, /By \{themeCredit\.credit\}/)
  assert.match(componentSource, /themeCredit\.description \?/)
  assert.match(componentSource, /bottom-bar__theme-description/)
  assert.match(componentSource, /bottom-bar__theme-separator/)
  assert.match(componentSource, /bottom-bar__section-header/)
  assert.match(componentSource, /bottom-bar__theme-credit--link/)
  assert.match(stylesSource, /\.bottom-bar__section--theme \{[\s\S]*min-width: 420px;/)
  assert.match(stylesSource, /\.bottom-bar__section-header \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-metadata \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-description \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-credit--link \{/)
})

test('toolbar uses the Prism logo support link and static package icons are configured', async () => {
  const toolbarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Toolbar.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const packageSource = await readFile(join(process.cwd(), 'package.json'), 'utf8')
  const packageJson = JSON.parse(packageSource) as {
    build: {
      mac: { icon: string }
      win: { icon: string }
      linux: { icon: string }
      extraResources: Array<{ from: string; to: string }>
    }
  }

  assert.match(toolbarSource, /import PrismLogo from '\.\/PrismLogo'/)
  assert.match(toolbarSource, /const PRISM_SUPPORT_URL = 'https:\/\/ko-fi\.com\/boof2015'/)
  assert.match(toolbarSource, /window\.electronAPI\.openExternalUrl\(PRISM_SUPPORT_URL\)/)
  assert.match(toolbarSource, /<PrismLogo \/>/)
  assert.match(toolbarSource, /toolbar__brand-heart/)
  assert.doesNotMatch(toolbarSource, /toolbar__brand-mark/)
  assert.doesNotMatch(toolbarSource, /toolbar__brand-text/)

  assert.match(stylesSource, /\.toolbar__brand-heart \{/)
  assert.match(stylesSource, /\.prism-logo__path--upper \{[\s\S]*fill: var\(--accent\);/)
  assert.match(stylesSource, /animation: titlebarLogoHeartPop 0\.22s cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
  assert.match(stylesSource, /@keyframes titlebarLogoHeartPop/)
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/)

  assert.match(mainSource, /nativeImage/)
  assert.match(mainSource, /function applyStaticDockIcon\(\)/)
  assert.match(mainSource, /process\.platform !== 'darwin' \|\| app\.isPackaged/)
  assert.match(mainSource, /app\.dock\?\.setIcon\(icon\)/)
  assert.match(mainSource, /applyStaticDockIcon\(\)/)
  assert.match(mainSource, /function getStaticWindowIconOptions\(\)/)
  assert.match(mainSource, /\.\.\.getStaticWindowIconOptions\(\)/)
  assert.equal(packageJson.build.mac.icon, 'resources/icon.icns')
  assert.equal(packageJson.build.win.icon, 'resources/icon.ico')
  assert.equal(packageJson.build.linux.icon, 'resources/icon.png')
  assert.ok(packageJson.build.extraResources.some((entry) => {
    return entry.from === 'resources/icon.png' && entry.to === 'icon.png'
  }))
})

test('resolveWindowCapabilities detects native Wayland sessions on Linux', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'linux',
      argv: [],
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
      },
    }),
    {
      displayServer: 'wayland',
      useNativeDragRegions: true,
      supportsProgrammaticReposition: false,
      supportsGeometryPersistence: false,
    },
  )
})

test('resolveWindowCapabilities respects --ozone-platform=x11 in a Wayland session', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'linux',
      argv: ['--ozone-platform=x11'],
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        DISPLAY: ':0',
      },
    }),
    {
      displayServer: 'x11',
      useNativeDragRegions: false,
      supportsProgrammaticReposition: true,
      supportsGeometryPersistence: true,
    },
  )
})

test('resolveWindowCapabilities detects X11 sessions on Linux', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'linux',
      argv: [],
      env: {
        XDG_SESSION_TYPE: 'x11',
        DISPLAY: ':0',
      },
    }),
    {
      displayServer: 'x11',
      useNativeDragRegions: false,
      supportsProgrammaticReposition: true,
      supportsGeometryPersistence: true,
    },
  )
})

test('resolveWindowCapabilities leaves non-Linux platforms on the full-featured path', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'darwin',
      argv: [],
      env: {},
    }),
    {
      displayServer: 'other',
      useNativeDragRegions: false,
      supportsProgrammaticReposition: true,
      supportsGeometryPersistence: true,
    },
  )
})

test('Wayland window controls use native drag regions and omit unsupported reposition/geometry paths', async () => {
  const toolbarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Toolbar.tsx'), 'utf8')
  const appSource = await readFile(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8')
  const popoutSource = await readFile(join(process.cwd(), 'src', 'renderer', 'popouts', 'ScopePopoutWindow.tsx'), 'utf8')
  const nowPlayingSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'NowPlayingConfigWindow.tsx'), 'utf8')
  const bridgeSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'ScopePopoutBridge.tsx'), 'utf8')
  const stripSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Strip.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')

  assert.match(toolbarSource, /WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE/)
  assert.match(toolbarSource, /disabled=\{!supportsProgrammaticReposition\}/)
  assert.match(toolbarSource, /useNativeDragRegions \? 'is-native-drag' : ''/)
  assert.match(appSource, /onMouseDown=\{useNativeDragRegions \? undefined : handleAltDragStart\}/)
  assert.match(popoutSource, /scope-popout__header \$\{useNativeDragRegions \? 'is-native-drag' : ''\}/)
  assert.match(nowPlayingSource, /now-playing-config__toolbar \$\{useNativeDragRegions \? 'is-native-drag' : ''\}/)
  assert.match(bridgeSource, /bounds: supportsGeometryPersistence\s*\?\s*scopePopouts\[kind\]\?\.windowBounds\s*:\s*undefined/)
  assert.match(stripSource, /if \(!supportsGeometryPersistence\) \{\s*popOutScope\(kind\)/)
  assert.match(stylesSource, /\.toolbar\.is-native-drag \{/)
  assert.match(stylesSource, /\.scope-popout__header\.is-native-drag \{/)
})

test('toggleScope appends now playing to the scope order when it is enabled from an opt-in profile', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    seedProfileDraftState(profile)

    assert.equal(useSettingsStore.getState().scopeOrder.includes('nowPlaying'), false)

    useSettingsStore.getState().toggleScope('nowPlaying')

    assert.equal(useSettingsStore.getState().scopeOrder.at(-1), 'nowPlaying')
    assert.equal(useSettingsStore.getState().hiddenScopes.has('nowPlaying'), false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
  }
})

test('resolveMainWindowSettingsHeight waits for real measurements instead of using a placeholder height', () => {
  assert.equal(resolveMainWindowSettingsHeight(false, 312, 96), 0)
  assert.equal(resolveMainWindowSettingsHeight(true, 0, 96), 0)
  assert.equal(resolveMainWindowSettingsHeight(true, 312, 0), 0)
  assert.equal(resolveMainWindowSettingsHeight(true, 312, 96), 408)
})

test('expanded main-window bounds can push upward into an overlapping display above', () => {
  const resolved = resolveExpandedMainWindowBounds(
    { x: 700, y: 1110, width: 900, height: 180 },
    400,
    [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 600, y: 1080, width: 720, height: 260 },
    ],
  )

  assert.equal(resolved.x, 700)
  assert.equal(resolved.y, 760)
  assert.equal(resolved.height, 580)
})

test('expanded main-window bounds can span into a taller side display instead of clamping to one display', () => {
  const resolved = resolveExpandedMainWindowBounds(
    { x: 650, y: 650, width: 400, height: 180 },
    300,
    [
      { x: 0, y: 0, width: 800, height: 800 },
      { x: 800, y: 0, width: 800, height: 1200 },
    ],
  )

  assert.equal(resolved.x, 650)
  assert.equal(resolved.y, 650)
  assert.equal(resolved.height, 480)
})

test('dragged main-window bounds keep a visible grab margin without sticking at a display seam', () => {
  const clamped = clampDraggedMainWindowBounds(
    { x: 760, y: 120, width: 400, height: 220 },
    [
      { x: 0, y: 0, width: 800, height: 900 },
      { x: 800, y: 0, width: 800, height: 900 },
    ],
    64,
  )

  assert.equal(clamped.x, 760)
  assert.equal(clamped.y, 120)
})

test('raiseWindowAboveNormalPopouts raises the main window when an unpinned popout exists', () => {
  const main = createFakeStackableWindow()
  const normalPopout = createFakeStackableWindow(false)
  const pinnedPopout = createFakeStackableWindow(true)

  const raised = raiseWindowAboveNormalPopouts(main.window, [normalPopout.window, pinnedPopout.window])

  assert.equal(raised, true)
  assert.equal(main.getMoveTopCalls(), 1)
})

test('raiseWindowAboveNormalPopouts leaves pinned popouts above the main window', () => {
  const main = createFakeStackableWindow()
  const pinnedPopout = createFakeStackableWindow(true)

  const raised = raiseWindowAboveNormalPopouts(main.window, [pinnedPopout.window])

  assert.equal(raised, false)
  assert.equal(main.getMoveTopCalls(), 0)
})

test('main-window bounds updates persist working state in Electron mode', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const fakeWindow = installFakeElectronWindow()

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
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

test('native Wayland main-window bounds updates do not dirty or persist geometry', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const fakeWindow = installFakeElectronWindow({
    platform: 'linux',
    windowCapabilities: resolveWindowCapabilities({
      platform: 'linux',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
      },
    }),
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }
    seedProfileDraftState(profile)

    useSettingsStore.getState().updateMainWindowBounds({ x: 24, y: 20, width: 900, height: 180 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.deepEqual(useSettingsStore.getState().windowBounds, profile.windowBounds)
    assert.equal(fakeStorage.getSetCount(), 0)
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
    profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }

    fakeStorage.setItem('prism:settings', JSON.stringify({
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

test('initializeProfiles ignores persisted geometry on native Wayland and keeps the saved profile clean', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const savedBounds = { x: 10, y: 20, width: 900, height: 180 }
  const savedPopoutBounds = { x: 140, y: 60, width: 420, height: 240 }
  const restoredBounds: WindowBounds[] = []
  let getWindowBoundsCalls = 0
  const fakeWindow = installFakeElectronWindow({
    platform: 'linux',
    windowCapabilities: resolveWindowCapabilities({
      platform: 'linux',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
      },
    }),
    getProfileSnapshot: async () => {
      const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
      profile.windowBounds = savedBounds
      profile.scopePopouts.spectrum = {
        poppedOut: true,
        windowBounds: savedPopoutBounds,
      }

      return {
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: {
          [DEFAULT_PROFILE_ID]: profile,
        },
      }
    },
    getWindowBounds: async () => {
      getWindowBoundsCalls += 1
      return { x: 44, y: 55, width: 900, height: 180 }
    },
    setWindowBounds: (bounds: WindowBounds) => {
      restoredBounds.push(bounds)
    },
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.windowBounds = savedBounds
    profile.scopePopouts.spectrum = {
      poppedOut: true,
      windowBounds: savedPopoutBounds,
    }

    fakeStorage.setItem('prism:settings', JSON.stringify({
      scopeOrder: profile.scopeOrder,
      hiddenScopes: profile.hiddenScopes,
      widthWeights: profile.widthWeights,
      scopeSettings: profile.scopeSettings,
      scopePopouts: {
        ...profile.scopePopouts,
        spectrum: {
          poppedOut: true,
          windowBounds: { x: 188, y: 92, width: 440, height: 260 },
        },
      },
      windowBounds: { x: 44, y: 55, width: 900, height: 180 },
    }))

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.activeProfileId, DEFAULT_PROFILE_ID)
    assert.deepEqual(state.windowBounds, savedBounds)
    assert.deepEqual(state.scopePopouts.spectrum.windowBounds, savedPopoutBounds)
    assert.equal(state.hasUnsavedProfileChanges, false)
    assert.deepEqual(restoredBounds, [])
    assert.equal(getWindowBoundsCalls, 0)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('initializeProfiles ignores stale persisted theme-only state and loads the saved profile normally', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const savedBounds = { x: 10, y: 20, width: 900, height: 180 }
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => {
      const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
      profile.windowBounds = savedBounds

      return {
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: {
          [DEFAULT_PROFILE_ID]: profile,
        },
      }
    },
    getWindowBounds: async () => savedBounds,
    setWindowBounds: () => {},
  })

  try {
    fakeStorage.setItem('prism:settings', JSON.stringify({
      themeId: 'theme_midnight',
    }))

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.activeProfileId, DEFAULT_PROFILE_ID)
    assert.deepEqual(state.windowBounds, savedBounds)
    assert.deepEqual(state.savedProfileBaseline?.windowBounds, savedBounds)
    assert.equal(state.hasUnsavedProfileChanges, false)
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

test('switching profiles leaves the global theme alone and does not mark the profile dirty', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const previousThemeState = useThemeStore.getState()
  const fakeWindow = installFakeElectronWindow({
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    const defaultProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    const liveMixProfile = createDefaultProfile('Live Mix')
    const midnightTheme = createDefaultTheme()
    midnightTheme.name = 'Midnight'
    midnightTheme.credit = 'Night Shift'
    midnightTheme.app.background = 'rgb(6, 10, 20)'
    useThemeStore.setState({
      themes: {
        Default: createDefaultTheme(),
        Midnight: midnightTheme,
      },
      activeThemeId: 'Midnight',
      activeTheme: resolveTheme(midnightTheme),
      accent: resolveTheme(midnightTheme).interface.accent,
    })

    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: 'profile_live_mix',
      profiles: {
        [DEFAULT_PROFILE_ID]: defaultProfile,
        profile_live_mix: liveMixProfile,
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    assert.equal(useThemeStore.getState().activeThemeId, 'Midnight')
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    useThemeStore.setState(previousThemeState)
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

test('native Wayland popout bounds updates do not dirty or persist geometry', () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const fakeWindow = installFakeElectronWindow({
    platform: 'linux',
    windowCapabilities: resolveWindowCapabilities({
      platform: 'linux',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
      },
    }),
  })

  try {
    const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    profile.scopePopouts.spectrum = {
      poppedOut: true,
      windowBounds: { x: 140, y: 60, width: 420, height: 240 },
    }
    seedProfileDraftState(profile)

    useSettingsStore.getState().updatePopoutBounds('spectrum', { x: 156, y: 58, width: 420, height: 240 })
    assert.equal(useSettingsStore.getState().hasUnsavedProfileChanges, false)
    assert.deepEqual(useSettingsStore.getState().scopePopouts.spectrum.windowBounds, profile.scopePopouts.spectrum.windowBounds)
    assert.equal(fakeStorage.getSetCount(), 0)
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
    moveDockedScopeOrder(initialOrder, new Set<ScopeKind>(), createScopePopouts(), 'nowPlaying', 'right'),
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
    'nowPlaying',
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
    'nowPlaying',
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

test('NativePolledCaptureBackend forwards all drained chunks, respects hidden-document backoff, and cancels on stop', async () => {
  const timers = installFakeTimeouts()

  try {
    const { NativePolledCaptureBackend } = await import('../src/renderer/audio/AudioCapture')

    const drainResults = [
      {
        chunks: [
          {
            left: new Float32Array([0.1, 0.2]),
            right: new Float32Array([0.3, 0.4]),
            channelCount: 2,
            capturedAtMilliseconds: 5,
            sequence: 1,
          },
          {
            left: new Float32Array([0.5, 0.6]),
            right: new Float32Array([0.7, 0.8]),
            channelCount: 2,
            capturedAtMilliseconds: 15,
            sequence: 2,
          },
        ],
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
    const receivedChunkTimes: number[] = []
    backend.subscribe((chunk) => {
      receivedSequences.push(chunk.sequence)
      receivedChunkTimes.push(chunk.capturedAt)
    })

    await backend.start()
    assert.equal(timers.nextDelay(), 0)

    timers.runNext()
    assert.deepEqual(receivedSequences, [1, 2])
    assert.equal(receivedChunkTimes.length, 2)
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

test('NativePolledCaptureBackend trims stale backlog to the newest live slice when catch-up mode is enabled', async () => {
  const timers = installFakeTimeouts()

  try {
    const { NativePolledCaptureBackend } = await import('../src/renderer/audio/AudioCapture')

    const drainResults = [
      {
        chunks: [
          {
            left: new Float32Array([0.1]),
            right: new Float32Array([0.1]),
            channelCount: 2,
            capturedAtMilliseconds: 0,
            sequence: 1,
          },
          {
            left: new Float32Array([0.2]),
            right: new Float32Array([0.2]),
            channelCount: 2,
            capturedAtMilliseconds: 10,
            sequence: 2,
          },
          {
            left: new Float32Array([0.3]),
            right: new Float32Array([0.3]),
            channelCount: 2,
            capturedAtMilliseconds: 30,
            sequence: 3,
          },
          {
            left: new Float32Array([0.4]),
            right: new Float32Array([0.4]),
            channelCount: 2,
            capturedAtMilliseconds: 70,
            sequence: 4,
          },
          {
            left: new Float32Array([0.5]),
            right: new Float32Array([0.5]),
            channelCount: 2,
            capturedAtMilliseconds: 90,
            sequence: 5,
          },
        ],
        overwriteCount: 0,
        queueDepth: 3,
      },
      {
        chunks: [{
          left: new Float32Array([0.6]),
          right: new Float32Array([0.6]),
          channelCount: 2,
          capturedAtMilliseconds: 120,
          sequence: 6,
        }],
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
      readonly kind = 'native-linux' as const

      protected getNativeCaptureModule() {
        return nativeModule
      }

      protected getBackendLabel(): string {
        return 'Test Native'
      }

      protected shouldTrimBacklogForLiveCapture(): boolean {
        return true
      }
    }

    const backend = new TestNativeBackend({
      kind: 'native-linux',
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
    assert.deepEqual(receivedSequences, [4, 5])
    assert.equal(timers.nextDelay(), 0)

    timers.runNext()
    assert.deepEqual(receivedSequences, [4, 5, 6])
    assert.equal(timers.nextDelay(), 0)

    timers.runNext()
    assert.equal(timers.nextDelay(), 2)

    await backend.stop()
    assert.equal(timers.pendingCount(), 0)
  } finally {
    timers.restore()
  }
})

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
import {
  resolveMainWindowSettingsHeight,
  resolveMainWindowSettingsPanelHeight,
} from '../src/renderer/mainWindowSettings'
import {
  buildAnalyzerGridTemplateColumns,
} from '../src/renderer/analyzerLayout'
import {
  DEFAULT_SCOPE_POPOUT_MIN_WIDTH_PX,
  MIN_LOUDNESS_METER_WIDTH_PX,
  getScopePopoutMinWidth,
} from '../src/shared/scopeSizing'
import {
  formatAstraTime,
  getAstraPlaybackProgress,
} from '../src/renderer/utils/astra'
import {
  createDefaultProfile,
} from '../src/shared/profileState'
import {
  resolveMacWindowBlurMaterial,
  resolveWindowCapabilities,
} from '../src/shared/windowCapabilities'
import {
  clampDraggedMainWindowBounds,
  clampRestoredWindowBounds,
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
  inverseTransformNormalizedScopePoint,
  resolveScopeCanvasLayout,
  transformNormalizedScopePoint,
} from '../src/renderer/scopeCanvasTransform'
import {
  SPECTRUM_MEASUREMENT_SMOOTHING,
  frequencyAtNormalizedPosition,
  resolveMeasurementReadoutPosition,
  resolveOscilloscopeMeasurement,
  resolveSpectrogramMeasurement,
  resolveSpectrumMeasurement,
  resolveWaveformMeasurement,
} from '../src/renderer/scopeMeasurement'
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
import type {
  LUFSMeterNativeAnalyzer,
  LUFSMeterNativeSnapshot,
  SpectrogramNativeAnalyzer,
  SpectrogramNativeOptions,
  SpectrogramNativeResult,
  SpectrumNativeAnalyzer,
  VectorscopeNativeAnalyzer,
  VUMeterNativeAnalyzer,
  VUMeterNativeSnapshot,
  WaveformNativeAnalyzer,
} from '../src/renderer/audio/native'
import {
  HEAT_LOW_DB,
  HEAT_MAX_DB,
  HEAT_MID_DB,
  HEAT_MIN_DB,
  normalizeHeatDb,
} from '../src/renderer/visualizers/heatScale'
import { LUFSMeter, formatMaxTruePeakDb } from '../src/renderer/visualizers/LUFSMeter'
import { Oscilloscope } from '../src/renderer/visualizers/Oscilloscope'
import { SpectrumAnalyzer, type SpectrumAnalyzerOptions } from '../src/renderer/visualizers/SpectrumAnalyzer'
import { BridgeSpectrumAnalyzer } from '../src/plugin-ui/BridgeSpectrumAnalyzer'
import { decodeLUFSMeterFrame, decodeSpectrumFrame } from '../src/plugin-ui/juceBridge'
import { formatSpectrumPeakDbfs } from '../src/plugin-ui/peakOverlay'
import { spectrogramSettingsToOptions } from '../src/plugin-ui/spectrogramOptions'
import { spectrumSettingsToOptions } from '../src/plugin-ui/spectrumOptions'
import { vectorscopeSettingsToOptions } from '../src/plugin-ui/vectorscopeOptions'
import { Spectrogram, type SpectrogramOptions } from '../src/renderer/visualizers/Spectrogram'
import { Vectorscope } from '../src/renderer/visualizers/Vectorscope'
import { Waveform } from '../src/renderer/visualizers/Waveform'
import {
  VUMeter,
  VU_NEEDLE_FACE_HEIGHT_CSS_PX,
  VU_NEEDLE_FACE_WIDTH_CSS_PX,
  classicVuToNormalized,
  dbfsToClassicVu,
  resolveVUNeedleFaceLayout,
  resolveVUNeedleReadings,
  stereoRmsDbAverage,
} from '../src/renderer/visualizers/VUMeter'
import {
  drawVectorscopeGridForMode,
  getVectorscopeLayout,
  isVectorscopePhaseRisk,
  transformPoint,
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
import {
  buildFrequencyGuides,
  clampFrequencyRangeToNyquist,
  frequencyBoundsForRange,
  normalizeFrequencyScaleMode,
  normalizedPositionAtFrequency,
  type FrequencyScaleMode,
} from '../src/types/frequencyScale'
import {
  formatVectorscopeReferenceDbfs,
  normalizeVectorscopeZoomDb,
  vectorscopeZoomDbToGain,
} from '../src/types/vectorscope'

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
    localStorage: (globalThis as GlobalWithStorage).localStorage,
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
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalWithStorage, 'localStorage')

  const fakeLocalStorage = {
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
  Object.defineProperty(globalWithStorage, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: fakeLocalStorage,
    writable: true,
  })

  return {
    getSetCount: () => setCount,
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      storage.set(key, value)
    },
    restore(): void {
      if (!previousLocalStorageDescriptor) {
        delete globalWithStorage.localStorage
        return
      }

      Object.defineProperty(globalWithStorage, 'localStorage', previousLocalStorageDescriptor)
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
  fillTexts: Array<{ text: string; x: number; y: number; fillStyle: string; font: string }>
  lineStrokes: Array<{
    commands: Array<{ kind: 'moveTo' | 'lineTo'; x: number; y: number }>
    strokeStyle: string
    lineWidth: number
  }>
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
  fills: Array<{
    commands: Array<{ kind: 'moveTo' | 'lineTo'; x: number; y: number }>
    fillStyle: string
  }>
  imageDataWrites: Array<{ x: number; y: number; width: number; height: number; data: number[] }>
  drawImageCalls: Array<{ compositeOperation: GlobalCompositeOperation; args: unknown[] }>
}

function createFakeCanvasRecorder(): FakeCanvasRecorder {
  return {
    fillRects: [],
    fillTexts: [],
    lineStrokes: [],
    strokeRects: [],
    arcs: [],
    lineDashes: [],
    fills: [],
    imageDataWrites: [],
    drawImageCalls: [],
  }
}

function createFakeCanvasContext(recorder: FakeCanvasRecorder | null = null): CanvasRenderingContext2D {
  let currentLineDash: number[] = []
  let currentFillStyle = ''
  let currentStrokeStyle = ''
  let currentLineWidth = 1
  let currentFont = ''
  let currentCompositeOperation: GlobalCompositeOperation = 'source-over'
  let currentPath: Array<{ kind: 'moveTo' | 'lineTo'; x: number; y: number }> = []

  const context = {
    clearRect() {},
    fillRect(x: number, y: number, width: number, height: number) {
      recorder?.fillRects.push({ x, y, width, height, fillStyle: currentFillStyle })
    },
    fillText(text: string, x: number, y: number) {
      recorder?.fillTexts.push({ text: String(text), x, y, fillStyle: currentFillStyle, font: currentFont })
    },
    beginPath() {
      currentPath = []
    },
    closePath() {},
    fill() {
      recorder?.fills.push({ commands: [...currentPath], fillStyle: currentFillStyle })
    },
    moveTo(x: number, y: number) {
      currentPath.push({ kind: 'moveTo', x, y })
    },
    lineTo(x: number, y: number) {
      currentPath.push({ kind: 'lineTo', x, y })
    },
    stroke() {
      if (currentPath.length > 0) {
        recorder?.lineStrokes.push({
          commands: [...currentPath],
          strokeStyle: currentStrokeStyle,
          lineWidth: currentLineWidth,
        })
      }
    },
    strokeRect(x: number, y: number, width: number, height: number) {
      recorder?.strokeRects.push({ x, y, width, height, lineDash: [...currentLineDash] })
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false) {
      recorder?.arcs.push({ x, y, radius, startAngle, endAngle, anticlockwise, lineDash: [...currentLineDash] })
    },
    ellipse() {},
    drawImage(...args: unknown[]) {
      recorder?.drawImageCalls.push({ compositeOperation: currentCompositeOperation, args })
    },
    putImageData(imageData: ImageData, x: number, y: number) {
      recorder?.imageDataWrites.push({ x, y, width: imageData.width, height: imageData.height, data: Array.from(imageData.data) })
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
    measureText(text: string) {
      const fontSizeMatch = currentFont.match(/(\d+(?:\.\d+)?)px/)
      const fontSize = fontSizeMatch ? Number(fontSizeMatch[1]) : 12
      return { width: String(text).length * fontSize * 0.62 } as TextMetrics
    },
    get lineWidth() {
      return currentLineWidth
    },
    set lineWidth(value: number) {
      currentLineWidth = value
    },
    get font() {
      return currentFont
    },
    set font(value: string) {
      currentFont = value
    },
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

function createFakeCanvas(
  recorder: FakeCanvasRecorder | null = null,
  width = 320,
  height = 180,
): HTMLCanvasElement {
  const context = createFakeCanvasContext(recorder)
  return {
    width,
    height,
    getContext: (kind: string) => kind === '2d' ? context : null,
  } as unknown as HTMLCanvasElement
}

function createFakeCssSizedCanvas(
  recorder: FakeCanvasRecorder,
  cssWidth: number,
  cssHeight: number,
  pixelRatio = 1,
): HTMLCanvasElement {
  const canvas = createFakeCanvas(
    recorder,
    Math.round(cssWidth * pixelRatio),
    Math.round(cssHeight * pixelRatio),
  )
  Object.defineProperty(canvas, 'style', {
    configurable: true,
    value: {
      width: `${cssWidth}px`,
      height: `${cssHeight}px`,
    },
  })
  return canvas
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

interface FakeSpectrumNativeAnalyzer extends SpectrumNativeAnalyzer {
  calls: {
    monoPushes: Float32Array[]
    stereoPushes: Array<{ left: Float32Array; right: Float32Array }>
    fillMagnitudes: number
    fillRawMagnitudes: number
    fillSideMagnitudes: number
    fillChannelMaxMagnitudes: number
    resets: number
    smoothingValues: number[]
  }
}

function runFft(re: Float32Array, im: Float32Array): void {
  const size = re.length
  if (size <= 1) return

  let j = 0
  for (let i = 1; i < size; i += 1) {
    let bit = size >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit

    if (i < j) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }

  for (let len = 2; len <= size; len <<= 1) {
    const halfLen = len >> 1
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)

    for (let i = 0; i < size; i += len) {
      let curRe = 1
      let curIm = 0

      for (let k = 0; k < halfLen; k += 1) {
        const evenIndex = i + k
        const oddIndex = i + k + halfLen
        const tRe = curRe * re[oddIndex] - curIm * im[oddIndex]
        const tIm = curRe * im[oddIndex] + curIm * re[oddIndex]

        re[oddIndex] = re[evenIndex] - tRe
        im[oddIndex] = im[evenIndex] - tIm
        re[evenIndex] += tRe
        im[evenIndex] += tIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function createFakeSpectrumNativeAnalyzer(): FakeSpectrumNativeAnalyzer {
  let fftSize = 2048
  let sampleRate = 48000
  let smoothing = 0.9
  let bufferedSamples = 0
  let history = new Float32Array(fftSize)
  let sideHistory = new Float32Array(fftSize)
  let rawMagnitudes = new Float32Array(fftSize / 2)
  let magnitudes = new Float32Array(fftSize / 2)
  let sideMagnitudes = new Float32Array(fftSize / 2)
  let leftMagnitudes = new Float32Array(fftSize / 2)
  let rightMagnitudes = new Float32Array(fftSize / 2)
  let channelMaxMagnitudes = new Float32Array(fftSize / 2)
  let leftHistory = new Float32Array(fftSize)
  let rightHistory = new Float32Array(fftSize)
  let re = new Float32Array(fftSize)
  let im = new Float32Array(fftSize)
  rawMagnitudes.fill(-100)
  magnitudes.fill(-100)
  sideMagnitudes.fill(-100)
  leftMagnitudes.fill(-100)
  rightMagnitudes.fill(-100)
  channelMaxMagnitudes.fill(-100)

  const calls: FakeSpectrumNativeAnalyzer['calls'] = {
    monoPushes: [],
    stereoPushes: [],
    fillMagnitudes: 0,
    fillRawMagnitudes: 0,
    fillSideMagnitudes: 0,
    fillChannelMaxMagnitudes: 0,
    resets: 0,
    smoothingValues: [],
  }

  const resize = (size: number): void => {
    fftSize = size
    bufferedSamples = 0
    history = new Float32Array(fftSize)
    sideHistory = new Float32Array(fftSize)
    rawMagnitudes = new Float32Array(fftSize / 2)
    magnitudes = new Float32Array(fftSize / 2)
    sideMagnitudes = new Float32Array(fftSize / 2)
    leftMagnitudes = new Float32Array(fftSize / 2)
    rightMagnitudes = new Float32Array(fftSize / 2)
    channelMaxMagnitudes = new Float32Array(fftSize / 2)
    leftHistory = new Float32Array(fftSize)
    rightHistory = new Float32Array(fftSize)
    re = new Float32Array(fftSize)
    im = new Float32Array(fftSize)
    rawMagnitudes.fill(-100)
    magnitudes.fill(-100)
    sideMagnitudes.fill(-100)
    leftMagnitudes.fill(-100)
    rightMagnitudes.fill(-100)
    channelMaxMagnitudes.fill(-100)
  }

  const updateMagnitudes = (source: Float32Array, output: Float32Array, rawOutput: Float32Array | null): void => {
    for (let index = 0; index < fftSize; index += 1) {
      const window = fftSize <= 1 ? 1 : 0.5 * (1 - Math.cos((2 * Math.PI * index) / (fftSize - 1)))
      re[index] = source[index] * window
      im[index] = 0
    }
    runFft(re, im)

    const scale = 2 / fftSize
    for (let index = 0; index < output.length; index += 1) {
      const magnitude = Math.hypot(re[index], im[index]) * scale
      const coherentGain = fftSize <= 1 ? 1 : (fftSize - 1) / (2 * fftSize)
      let db = 20 * Math.log10(Math.max(magnitude, 1e-10)) - 20 * Math.log10(coherentGain)
      db = Math.min(12, Math.max(-120, db))
      if (rawOutput) {
        rawOutput[index] = db
      }
      output[index] = bufferedSamples < fftSize
        ? db
        : smoothing * output[index] + (1 - smoothing) * db
    }
  }

  const pushMonoHistory = (samples: Float32Array): void => {
    const length = samples.length
    if (length >= fftSize) {
      history.set(samples.subarray(length - fftSize))
      sideHistory.fill(0)
      bufferedSamples = fftSize
      return
    }

    history.copyWithin(0, length)
    sideHistory.copyWithin(0, length)
    history.set(samples, fftSize - length)
    sideHistory.fill(0, fftSize - length)
    bufferedSamples = Math.min(fftSize, bufferedSamples + length)
  }

  const pushStereoHistory = (left: Float32Array, right: Float32Array): void => {
    const length = Math.min(left.length, right.length)
    if (length >= fftSize) {
      const start = length - fftSize
      for (let index = 0; index < fftSize; index += 1) {
        const leftValue = left[start + index]
        const rightValue = right[start + index]
        history[index] = (leftValue + rightValue) * 0.5
        sideHistory[index] = (leftValue - rightValue) * 0.5
      }
      bufferedSamples = fftSize
      return
    }

    history.copyWithin(0, length)
    sideHistory.copyWithin(0, length)
    const writeStart = fftSize - length
    for (let index = 0; index < length; index += 1) {
      history[writeStart + index] = (left[index] + right[index]) * 0.5
      sideHistory[writeStart + index] = (left[index] - right[index]) * 0.5
    }
    bufferedSamples = Math.min(fftSize, bufferedSamples + length)
  }

  const copyInto = (source: Float32Array, output: Float32Array): number => {
    const count = Math.min(source.length, output.length)
    output.set(source.subarray(0, count), 0)
    return count
  }

  const updateAllMagnitudes = (): void => {
    updateMagnitudes(history, magnitudes, rawMagnitudes)
    updateMagnitudes(sideHistory, sideMagnitudes, null)
    for (let index = 0; index < fftSize; index += 1) {
      leftHistory[index] = history[index] + sideHistory[index]
      rightHistory[index] = history[index] - sideHistory[index]
    }
    updateMagnitudes(leftHistory, leftMagnitudes, null)
    updateMagnitudes(rightHistory, rightMagnitudes, null)
    for (let index = 0; index < channelMaxMagnitudes.length; index += 1) {
      channelMaxMagnitudes[index] = Math.max(leftMagnitudes[index], rightMagnitudes[index])
    }
  }

  const analyzer: FakeSpectrumNativeAnalyzer = {
    calls,
    isAvailable: () => true,
    setFFTSize: (size) => {
      if (size !== fftSize) {
        resize(size)
      }
    },
    getFFTSize: () => fftSize,
    setSampleRate: (nextSampleRate) => {
      sampleRate = nextSampleRate
    },
    setSmoothing: (nextSmoothing) => {
      smoothing = Math.min(0.99, Math.max(0, nextSmoothing))
      calls.smoothingValues.push(nextSmoothing)
    },
    pushSamples: (audioData) => {
      calls.monoPushes.push(new Float32Array(audioData))
      pushMonoHistory(audioData)
      updateAllMagnitudes()
    },
    pushStereoSamples: (leftChannel, rightChannel) => {
      calls.stereoPushes.push({
        left: new Float32Array(leftChannel),
        right: new Float32Array(rightChannel),
      })
      pushStereoHistory(leftChannel, rightChannel)
      updateAllMagnitudes()
    },
    fillRawMagnitudes: (output) => {
      calls.fillRawMagnitudes += 1
      return copyInto(rawMagnitudes, output)
    },
    fillMagnitudes: (output) => {
      calls.fillMagnitudes += 1
      return copyInto(magnitudes, output)
    },
    fillSideMagnitudes: (output) => {
      calls.fillSideMagnitudes += 1
      return copyInto(sideMagnitudes, output)
    },
    fillChannelMaxMagnitudes: (output) => {
      calls.fillChannelMaxMagnitudes += 1
      return copyInto(channelMaxMagnitudes, output)
    },
    getRawMagnitudes: () => rawMagnitudes,
    getMagnitudes: () => magnitudes,
    getSideMagnitudes: () => sideMagnitudes,
    getChannelMaxMagnitudes: () => channelMaxMagnitudes,
    process: (audioData) => {
      analyzer.pushSamples(audioData)
      return magnitudes
    },
    binToFrequency: (bin) => bin * sampleRate / fftSize,
    reset: () => {
      calls.resets += 1
      history.fill(0)
      sideHistory.fill(0)
      rawMagnitudes.fill(-100)
      magnitudes.fill(-100)
      sideMagnitudes.fill(-100)
      leftMagnitudes.fill(-100)
      rightMagnitudes.fill(-100)
      channelMaxMagnitudes.fill(-100)
      bufferedSamples = 0
    },
  }

  return analyzer
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
      shiftAndPaintColumns: (
        display: Float32Array,
        heat: Float32Array,
        columnCount: number,
        rowCount: number,
      ) => void
    }
    state.ensureColumnBuffers(values.length)
    const column = Float32Array.from(values)
    state.shiftAndPaintColumns(column, column, 1, values.length)
    return recorder.imageDataWrites.at(-1)?.data ?? []
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
}

function renderSpectrogramShift(
  options: Partial<SpectrogramOptions>,
  values: number[],
  canvasSize: { width: number; height: number } = { width: 4, height: values.length },
): FakeCanvasRecorder {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const canvas = createFakeCanvas()
  canvas.width = canvasSize.width
  canvas.height = canvasSize.height
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
      shiftAndPaintColumns: (
        display: Float32Array,
        heat: Float32Array,
        columnCount: number,
        rowCount: number,
      ) => void
    }
    state.ensureColumnBuffers(values.length)
    const column = Float32Array.from(values)
    state.shiftAndPaintColumns(column, column, 1, values.length)
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

test('analyzer layout lets the loudness meter follow its width weight down to its supported minimum', () => {
  const columns = buildAnalyzerGridTemplateColumns(
    ['spectrum', 'lufsmeter', 'waveform'],
    { spectrum: 1, lufsmeter: 0.15, waveform: 1 },
  )

  assert.equal(MIN_LOUDNESS_METER_WIDTH_PX, 112)
  assert.equal(
    columns,
    `minmax(0, 1fr) minmax(${MIN_LOUDNESS_METER_WIDTH_PX}px, 0.15fr) minmax(0, 1fr)`,
  )
})

test('scope popout sizing permits compact LUFS windows without changing other scope minimums', () => {
  assert.equal(getScopePopoutMinWidth('lufsmeter'), MIN_LOUDNESS_METER_WIDTH_PX)
  assert.equal(MIN_LOUDNESS_METER_WIDTH_PX, 112)
  assert.equal(DEFAULT_SCOPE_POPOUT_MIN_WIDTH_PX, 220)

  for (const kind of SCOPE_KINDS) {
    if (kind === 'lufsmeter') continue
    assert.equal(getScopePopoutMinWidth(kind), DEFAULT_SCOPE_POPOUT_MIN_WIDTH_PX)
  }
})

test('scope canvas layout swaps logical dimensions for quarter-turn rotations', () => {
  const horizontal = resolveScopeCanvasLayout(640, 360, 2, 0)
  assert.deepEqual(horizontal, {
    viewportCssWidth: 640,
    viewportCssHeight: 360,
    cssWidth: 640,
    cssHeight: 360,
    pixelWidth: 1280,
    pixelHeight: 720,
    dpr: 2,
  })

  const vertical = resolveScopeCanvasLayout(640, 360, 2, 90)
  assert.deepEqual(vertical, {
    viewportCssWidth: 640,
    viewportCssHeight: 360,
    cssWidth: 360,
    cssHeight: 640,
    pixelWidth: 720,
    pixelHeight: 1280,
    dpr: 2,
  })
  assert.deepEqual(resolveScopeCanvasLayout(640, 360, 2, 270), vertical)
})

test('scope point transforms mirror the source axis before clockwise rotation', () => {
  const point = { x: 0.2, y: 0.3 }

  assert.deepEqual(transformNormalizedScopePoint(point, 0, false), { x: 0.2, y: 0.3 })
  assert.deepEqual(transformNormalizedScopePoint(point, 90, false), { x: 0.7, y: 0.2 })
  assert.deepEqual(transformNormalizedScopePoint(point, 180, false), { x: 0.8, y: 0.7 })
  assert.deepEqual(transformNormalizedScopePoint(point, 270, false), { x: 0.3, y: 0.8 })
  assert.deepEqual(transformNormalizedScopePoint(point, 0, true), { x: 0.8, y: 0.3 })
  assert.deepEqual(transformNormalizedScopePoint(point, 90, true), { x: 0.7, y: 0.8 })
  const mirrored270 = transformNormalizedScopePoint(point, 270, true)
  assert.equal(mirrored270.x, 0.3)
  assertAlmostEqual(mirrored270.y, 0.2, 1e-12, 'mirrored 270-degree y coordinate')
})

test('scope point inverse transforms round-trip every rotation and mirror state', () => {
  const point = { x: 0.217, y: 0.683 }
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const mirrorHorizontal of [false, true]) {
      const viewportPoint = transformNormalizedScopePoint(point, rotation, mirrorHorizontal)
      const restored = inverseTransformNormalizedScopePoint(viewportPoint, rotation, mirrorHorizontal)
      assertAlmostEqual(restored.x, point.x, 1e-12, `${rotation}° mirror=${mirrorHorizontal} x`)
      assertAlmostEqual(restored.y, point.y, 1e-12, `${rotation}° mirror=${mirrorHorizontal} y`)
    }
  }
})

test('scope measurement helpers resolve MiniMeters-style cursor axis values', () => {
  const spectrumX = Math.log10(1000 / 20) / Math.log10(20000 / 20)
  const spectrum = resolveSpectrumMeasurement(
    { x: spectrumX, y: 0.5 },
    {
      sampleRate: 48000,
      minFrequency: 20,
      maxFrequency: 20000,
      minDecibels: -90,
      maxDecibels: -10,
      scaleType: 'log',
    },
  )
  assert.deepEqual(spectrum.values.slice(0, 2), ['-50.00dB', '1.00kHz'])
  assert.match(spectrum.values[2] ?? '', /^B5 /)

  const slaneyOneKhz = 1000 / (200 / 3)
  const slaneyMin = 20 / (200 / 3)
  const slaneyMax = slaneyOneKhz + Math.log(20) / (Math.log(6.4) / 27)
  const oneKhzPositions = new Map<FrequencyScaleMode, number>([
    ['log', spectrumX],
    ['mel', (slaneyOneKhz - slaneyMin) / (slaneyMax - slaneyMin)],
    ['linear', (1000 - 20) / (20000 - 20)],
  ])
  for (const [scaleType, x] of oneKhzPositions) {
    const scaleMeasurement = resolveSpectrumMeasurement(
      { x, y: 0.5 },
      {
        sampleRate: 48000,
        minFrequency: 20,
        maxFrequency: 20000,
        minDecibels: -90,
        maxDecibels: -10,
        scaleType,
      },
    )
    assert.equal(scaleMeasurement.values[1], '1.00kHz')
  }

  const nyquistLimited = resolveSpectrumMeasurement(
    { x: 1, y: 0 },
    {
      sampleRate: 8000,
      minFrequency: 20,
      maxFrequency: 20000,
      minDecibels: -90,
      maxDecibels: -10,
      scaleType: 'log',
    },
  )
  assert.equal(nyquistLimited.values[1], '4.00kHz')

  const oscilloscope = resolveOscilloscopeMeasurement({ x: 0.5, y: 0.25 }, 48000, 2048)
  assert.deepEqual(oscilloscope.values, ['21.32ms', '+0.500', '-6.02dBFS'])

  const waveform = resolveWaveformMeasurement(
    { x: 0, y: 0.025 },
    { mode: 'mono', scrollSpeed: 1, canvasPixelWidth: 129 },
  )
  assert.deepEqual(waveform.values, ['1.00s ago', '+1.000', '+0.00dBFS'])

  const stereoWaveform = resolveWaveformMeasurement(
    { x: 1, y: 0.75 },
    { mode: 'stereo', scrollSpeed: 1, canvasPixelWidth: 129 },
  )
  assert.deepEqual(stereoWaveform.values, ['R', '0.00ms ago', '+0.000', '-∞dBFS'])
})

test('spectrogram measurement follows scale mode and rendered history speed', () => {
  assert.equal(frequencyAtNormalizedPosition(0.5, 20, 20000, 'linear'), 10010)
  assertAlmostEqual(
    frequencyAtNormalizedPosition(0.5, 20, 20000, 'log'),
    Math.sqrt(20 * 20000),
    1e-9,
    'log midpoint',
  )
  const melMidpoint = frequencyAtNormalizedPosition(0.5, 20, 20000, 'mel')
  assert.ok(melMidpoint > 1000 && melMidpoint < 10000)

  const measurement = resolveSpectrogramMeasurement(
    { x: 0.5, y: 0 },
    {
      sampleRate: 48000,
      minFrequency: 20,
      maxFrequency: 20000,
      scaleMode: 'log',
      fftSize: 4096,
      scrollSpeed: 2,
      canvasPixelWidth: 101,
    },
  )
  assert.deepEqual(measurement.values.slice(0, 2), ['266.67ms ago', '20.00kHz'])

  const expectedHistory = new Map([
    [1, '1.28s ago'],
    [2, '640.00ms ago'],
    [4, '320.00ms ago'],
    [8, '160.00ms ago'],
  ])
  for (const [scrollSpeed, expectedTime] of expectedHistory) {
    const historyMeasurement = resolveSpectrogramMeasurement(
      { x: 0, y: 1 },
      {
        sampleRate: 48000,
        minFrequency: 20,
        maxFrequency: 20000,
        scaleMode: 'linear',
        fftSize: 4096,
        scrollSpeed,
        canvasPixelWidth: 121,
      },
    )
    assert.deepEqual(historyMeasurement.values.slice(0, 2), [expectedTime, '20.00Hz'])
  }
})

test('frequency scale transforms are monotonic, invertible, and Nyquist-safe', () => {
  const minFrequency = 20
  const maxFrequency = 20000
  const positions = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

  for (const scaleMode of ['log', 'mel', 'linear'] as const) {
    const frequencies = positions.map((position) => (
      frequencyAtNormalizedPosition(position, minFrequency, maxFrequency, scaleMode)
    ))
    assertAlmostEqual(frequencies[0], minFrequency, 1e-12, `${scaleMode} minimum`)
    assertAlmostEqual(frequencies.at(-1) ?? 0, maxFrequency, 1e-9, `${scaleMode} maximum`)
    for (let index = 1; index < frequencies.length; index += 1) {
      assert.ok(frequencies[index] > frequencies[index - 1], `${scaleMode} should be monotonic`)
      assertAlmostEqual(
        normalizedPositionAtFrequency(frequencies[index], minFrequency, maxFrequency, scaleMode),
        positions[index],
        1e-12,
        `${scaleMode} inverse at ${positions[index]}`,
      )
    }
  }

  const slaneyMelAtOneKhz = 1000 / (200 / 3)
  const slaneyMelAtTwentyKhz = 15 + Math.log(20) / (Math.log(6.4) / 27)
  const expectedOneKhzPosition = (
    slaneyMelAtOneKhz - (20 / (200 / 3))
  ) / (
    slaneyMelAtTwentyKhz - (20 / (200 / 3))
  )
  assertAlmostEqual(
    normalizedPositionAtFrequency(1000, 20, 20000, 'mel'),
    expectedOneKhzPosition,
    1e-12,
    'Slaney mel 1kHz anchor',
  )

  assert.deepEqual(clampFrequencyRangeToNyquist(32000, 20, 20000), {
    minFrequency: 20,
    maxFrequency: 16000,
  })
  assert.equal(normalizeFrequencyScaleMode('bark'), 'log')
})

test('frequency ranges and adaptive guides cover extended audio without crowding compact scopes', () => {
  assert.deepEqual(frequencyBoundsForRange('extended', 44100), {
    minFrequency: 10,
    maxFrequency: 22050,
  })
  assert.deepEqual(frequencyBoundsForRange('extended', 96000), {
    minFrequency: 10,
    maxFrequency: 24000,
  })
  assert.deepEqual(frequencyBoundsForRange('audible', 48000), {
    minFrequency: 20,
    maxFrequency: 20000,
  })

  const wideGuides = buildFrequencyGuides(10, 24000, 'log', 1500)
  assert.ok(wideGuides.some(({ frequencyHz, kind }) => frequencyHz === 30 && kind === 'minor'))
  assert.ok(wideGuides.some(({ frequencyHz, kind, label }) => (
    frequencyHz === 1000 && kind === 'major' && label === '1k'
  )))

  const compactGuides = buildFrequencyGuides(10, 24000, 'log', 320)
  assert.equal(compactGuides.some(({ kind }) => kind === 'minor'), false)
  assert.ok(compactGuides.every((guide, index) => (
    index === 0 || guide.normalizedPosition > compactGuides[index - 1].normalizedPosition
  )))
})

test('measurement readout flips and clamps at viewport edges', () => {
  assert.deepEqual(
    resolveMeasurementReadoutPosition(
      { x: 190, y: 90 },
      { width: 200, height: 100 },
      { width: 80, height: 24 },
    ),
    { left: 98, top: 54 },
  )
  assert.deepEqual(
    resolveMeasurementReadoutPosition(
      { x: 2, y: 2 },
      { width: 60, height: 30 },
      { width: 80, height: 40 },
    ),
    { left: 8, top: 8 },
  )
})

test('scopeSettingsToOptions wires frequency ranges and overlays into desktop and plugin options', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.spectrum.showSideLine = true
  profile.scopeSettings.spectrum.heatmapSmoothing = 0.64
  profile.scopeSettings.spectrum.scaleMode = 'mel'
  profile.scopeSettings.spectrum.frequencyRangeMode = 'audible'
  profile.scopeSettings.spectrogram.frequencyRangeMode = 'extended'
  profile.scopeSettings.spectrogram.clarityMode = 'focused'
  profile.scopeSettings.spectrogram.showGrid = true
  const theme = resolveTheme(createDefaultTheme())

  const options = scopeSettingsToOptions('spectrum', profile.scopeSettings.spectrum, theme.spectrum)

  assert.equal(options.showSideLine, true)
  assert.equal(options.heatmapSmoothing, 0.64)
  assert.equal(options.secondaryLineColor, theme.spectrum.sideLine)
  assert.equal(options.lineColor, theme.spectrum.line)
  assert.equal(options.backgroundColor, theme.spectrum.background)
  assert.equal(options.gridColor, theme.spectrum.guides)
  assert.equal(options.scaleType, 'mel')
  assert.equal(options.minFrequency, 20)
  assert.equal(options.maxFrequency, 20000)

  const pluginOptions = spectrumSettingsToOptions(profile.scopeSettings.spectrum, theme.spectrum)
  assert.equal(pluginOptions.scaleType, 'mel')
  assert.equal(pluginOptions.minFrequency, 20)
  assert.equal(pluginOptions.maxFrequency, 20000)

  const spectrogramOptions = scopeSettingsToOptions(
    'spectrogram',
    profile.scopeSettings.spectrogram,
    theme.spectrogram,
  )
  assert.equal(spectrogramOptions.minFrequency, 10)
  assert.equal(spectrogramOptions.maxFrequency, 24000)
  assert.equal(spectrogramOptions.clarityMode, 'focused')
  assert.equal(spectrogramOptions.showGrid, true)

  const pluginSpectrogramOptions = spectrogramSettingsToOptions(
    profile.scopeSettings.spectrogram,
    theme.spectrogram,
  )
  assert.equal(pluginSpectrogramOptions.minFrequency, 10)
  assert.equal(pluginSpectrogramOptions.maxFrequency, 24000)
  assert.equal(pluginSpectrogramOptions.clarityMode, 'focused')
  assert.equal(pluginSpectrogramOptions.showGrid, true)
})

test('SpectrumAnalyzer grid only draws frequency guides when enabled', () => {
  const renderGrid = (showGrid: boolean, scaleType: FrequencyScaleMode = 'log'): FakeCanvasRecorder => {
    const recorder = createFakeCanvasRecorder()
    const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
    const dataSource = {
      getPendingSpectrumSamples: () => [],
      getPendingSpectrumStereoSamples: () => [],
      getSampleRate: () => 48000,
      isPlaying: () => false,
      subscribeToSessionChanges: () => () => {},
    }
    const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
      showGrid,
      scaleType,
      dataSource,
      nativeAnalyzer: null,
    })

    try {
      const state = analyzer as unknown as {
        ensureStaticLayer: (minFrequency: number, maxFrequency: number) => void
      }
      state.ensureStaticLayer(20, 20000)
      return recorder
    } finally {
      analyzer.dispose()
      dom.restore()
    }
  }

  const enabled = renderGrid(true)
  assert.deepEqual(
    enabled.fillTexts.map(({ text }) => text),
    ['50', '100', '200', '500', '1k', '2k', '5k', '10k'],
  )
  assert.equal(enabled.fillTexts.some(({ text }) => text.endsWith('dB')), false)
  assert.equal(enabled.lineStrokes.length, 8)
  for (const stroke of enabled.lineStrokes) {
    assert.deepEqual(stroke.commands.map(({ kind }) => kind), ['moveTo', 'lineTo'])
    const [start, end] = stroke.commands
    assert.equal(start.x, end.x)
    assert.equal(start.y, 0)
    assert.equal(end.y, 180)
  }

  const disabled = renderGrid(false)
  assert.deepEqual(disabled.fillTexts, [])
  assert.deepEqual(disabled.lineStrokes, [])

  for (const scaleType of ['log', 'mel', 'linear'] as const) {
    const recorder = renderGrid(true, scaleType)
    const oneKhz = recorder.fillTexts.find(({ text }) => text === '1k')
    assert.ok(oneKhz)
    assertAlmostEqual(
      oneKhz.x,
      normalizedPositionAtFrequency(1000, 20, 20000, scaleType) * 320,
      1e-9,
      `${scaleType} 1kHz grid position`,
    )
  }
})

test('SpectrumAnalyzer applies frequency scale changes without recreation', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showGrid: true,
    scaleType: 'log',
    dataSource,
    nativeAnalyzer: null,
  })

  try {
    const state = analyzer as unknown as {
      ensureStaticLayer: (minFrequency: number, maxFrequency: number) => void
    }
    state.ensureStaticLayer(20, 20000)
    const logPosition = recorder.fillTexts.find(({ text }) => text === '1k')?.x
    assert.notEqual(logPosition, undefined)

    analyzer.setOptions({ scaleType: 'linear' })
    state.ensureStaticLayer(20, 20000)
    const oneKhzLabels = recorder.fillTexts.filter(({ text }) => text === '1k')
    assert.equal(oneKhzLabels.length, 2)
    const linearPosition = oneKhzLabels.at(-1)?.x
    assert.notEqual(linearPosition, undefined)
    assert.notEqual(linearPosition, logPosition)
    assertAlmostEqual(
      linearPosition ?? 0,
      normalizedPositionAtFrequency(1000, 20, 20000, 'linear') * 320,
      1e-9,
      'live linear 1kHz grid position',
    )
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('SpectrumAnalyzer applies and restores transient measurement smoothing without resetting', () => {
  const dom = installFakeCanvasDom()
  const nativeAnalyzer = createFakeSpectrumNativeAnalyzer()
  const dataSource = {
    getPendingSpectrumSamples: () => [],
    getPendingSpectrumStereoSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    smoothing: 0.9,
    dataSource,
    nativeAnalyzer,
  })

  try {
    const resetsBeforeMeasurement = nativeAnalyzer.calls.resets
    analyzer.setMeasurementActive(true)
    assert.equal(nativeAnalyzer.calls.smoothingValues.at(-1), SPECTRUM_MEASUREMENT_SMOOTHING)
    assert.equal(nativeAnalyzer.calls.resets, resetsBeforeMeasurement)

    analyzer.setMeasurementActive(false)
    assertAlmostEqual(
      nativeAnalyzer.calls.smoothingValues.at(-1) ?? 0,
      0.9,
      1e-12,
      'configured smoothing should be restored',
    )

    analyzer.setOptions({ smoothing: 0.99 })
    analyzer.setMeasurementActive(true)
    assertAlmostEqual(
      nativeAnalyzer.calls.smoothingValues.at(-1) ?? 0,
      0.99,
      1e-12,
      'higher user smoothing should be preserved',
    )
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('SpectrumAnalyzer side line uses native stereo spectrum without draining mono samples', () => {
  const dom = installFakeCanvasDom()
  const nativeAnalyzer = createFakeSpectrumNativeAnalyzer()
  let monoDrains = 0
  let stereoDrains = 0
  const left = new Float32Array([1, 0.5, -0.5, -1])
  const right = new Float32Array([-1, -0.5, 0.5, 1])
  const dataSource = {
    getPendingSpectrumSamples: () => {
      monoDrains += 1
      return [new Float32Array([0.25, 0.25, 0.25, 0.25])]
    },
    getPendingSpectrumStereoSamples: () => {
      stereoDrains += 1
      return [{ left, right }]
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }

  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: true,
    showGrid: false,
    fillGradient: false,
    dataSource,
    nativeAnalyzer,
  })

  try {
    const state = analyzer as unknown as { drawFrame: () => void }
    state.drawFrame()

    assert.equal(monoDrains, 0)
    assert.equal(stereoDrains, 1)
    assert.equal(nativeAnalyzer.calls.monoPushes.length, 0)
    assert.equal(nativeAnalyzer.calls.stereoPushes.length, 1)
    assert.deepEqual(Array.from(nativeAnalyzer.calls.stereoPushes[0]?.left ?? []), Array.from(left))
    assert.deepEqual(Array.from(nativeAnalyzer.calls.stereoPushes[0]?.right ?? []), Array.from(right))
    assert.equal(nativeAnalyzer.calls.fillSideMagnitudes, 1)
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('default profile starts with spectrum peak info disabled', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(profile.scopeSettings.spectrum.peakInfoMode, DEFAULT_SPECTRUM_PEAK_INFO_MODE)
  assert.equal(normalizeSpectrumPeakInfoMode('nope'), DEFAULT_SPECTRUM_PEAK_INFO_MODE)
})

test('default profile starts with high-detail spectrogram FFT size', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(profile.scopeSettings.spectrogram.fftSize, 4096)
  assert.equal(profile.scopeSettings.spectrogram.tiltDbPerOctave, 4)
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

test('Spectrogram vertical orientation paints newest frequency row at the bottom', () => {
  const recorder = renderSpectrogramShift({
    orientation: 'vertical',
    colorScheme: 'mono',
    lineColor: 'rgb(10, 20, 30)',
  }, [0, 0.5, 1], { width: 3, height: 5 })
  const write = recorder.imageDataWrites.at(-1)

  assert.ok(write)
  assert.equal(write.x, 0)
  assert.equal(write.y, 4)
  assert.equal(write.width, 3)
  assert.equal(write.height, 1)
  assert.deepEqual(write.data.slice(0, 3), [10, 20, 30])
  assert.equal(write.data[3], 0)
  assert.deepEqual(write.data.slice(4, 7), [10, 20, 30])
  assert.equal(write.data[7], 128)
  assert.deepEqual(write.data.slice(8, 11), [10, 20, 30])
  assert.equal(write.data[11], 255)
})

test('Spectrogram vertical orientation shifts existing rows upward with copy compositing', () => {
  const recorder = renderSpectrogramShift({
    orientation: 'vertical',
  }, [0.2, 0.6, 1], { width: 3, height: 5 })
  const drawCall = recorder.drawImageCalls.at(-1)

  assert.equal(drawCall?.compositeOperation, 'copy')
  assert.equal(drawCall?.args[1], 0)
  assert.equal(drawCall?.args[2], -1)
})

test('Spectrogram draws adaptive frequency guides in the selected scale', () => {
  const renderGrid = (showGrid: boolean, scaleMode: FrequencyScaleMode): FakeCanvasRecorder => {
    const recorder = createFakeCanvasRecorder()
    const dom = installFakeCanvasDom(() => createFakeCanvas(recorder, 320, 600))
    const spectrogram = new Spectrogram(createFakeCanvas(recorder, 320, 600), {
      showGrid,
      scaleMode,
      minFrequency: 20,
      maxFrequency: 20000,
      dataSource: {
        getPendingSpectrogramSamples: () => [],
        getPendingSpectrogramStereoSamples: () => [],
        getSampleRate: () => 48000,
        isPlaying: () => false,
        subscribeToSessionChanges: () => () => {},
      },
      nativeAnalyzer: null,
    })

    try {
      const state = spectrogram as unknown as { drawFrame: () => void }
      state.drawFrame()
      return recorder
    } finally {
      spectrogram.dispose()
      dom.restore()
    }
  }

  const enabled = renderGrid(true, 'mel')
  const oneKhz = enabled.fillTexts.find(({ text }) => text === '1k')
  assert.ok(oneKhz)
  assertAlmostEqual(
    oneKhz.y,
    600 - (normalizedPositionAtFrequency(1000, 20, 20000, 'mel') * 600) - 2,
    1e-9,
    'Mel spectrogram 1kHz grid position',
  )

  const wideLog = renderGrid(true, 'log')
  assert.ok(wideLog.lineStrokes.length > wideLog.fillTexts.length)

  const disabled = renderGrid(false, 'log')
  assert.deepEqual(disabled.fillTexts, [])
  assert.deepEqual(disabled.lineStrokes, [])
})

test('Spectrogram paints multiple native analyzer columns in order', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const canvas = createFakeCanvas(recorder, 4, 2)
  let pending = [Float32Array.from([0, 1, 0, -1])]
  const dataSource = {
    getPendingSpectrogramSamples: () => {
      const chunks = pending
      pending = []
      return chunks
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer: SpectrogramNativeAnalyzer = {
    isAvailable: () => true,
    configure: () => {},
    process: () => ({
      display: Float32Array.from([0.25, 0.5, 0.75, 1]),
      heat: Float32Array.from([0.25, 0.5, 0.75, 1]),
      columnCount: 2,
      rowCount: 2,
    }),
    reset: () => {},
  }
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    nativeAnalyzer,
    colorScheme: 'mono',
    lineColor: 'rgb(10, 20, 30)',
  })

  try {
    const state = spectrogram as unknown as { drawFrame: () => void }
    state.drawFrame()

    const writes = recorder.imageDataWrites
    assert.equal(writes.length, 2)
    assert.deepEqual(writes[0].data.slice(0, 8), [10, 20, 30, 64, 10, 20, 30, 128])
    assert.deepEqual(writes[1].data.slice(0, 8), [10, 20, 30, 191, 10, 20, 30, 255])
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram forwards stereo channels without a cancellation-prone mono downmix', () => {
  const dom = installFakeCanvasDom()
  const canvas = createFakeCanvas(null, 4, 2)
  const left = Float32Array.from([0.5, 0, -0.5, 0])
  const right = Float32Array.from([-0.5, 0, 0.5, 0])
  let pending = [{ left, right }]
  let processedLeft: Float32Array | null = null
  let processedRight: Float32Array | null = null
  const dataSource = {
    getPendingSpectrogramSamples: (): Float32Array[] => assert.fail('stereo input must not be downmixed'),
    getPendingSpectrogramStereoSamples: () => {
      const chunks = pending
      pending = []
      return chunks
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const emptyResult = (): SpectrogramNativeResult => ({
    display: new Float32Array(0),
    heat: new Float32Array(0),
    columnCount: 0,
    rowCount: 2,
  })
  const nativeAnalyzer: SpectrogramNativeAnalyzer = {
    isAvailable: () => true,
    configure: () => {},
    process: () => assert.fail('stereo input must use processStereo'),
    processStereo: (nextLeft, nextRight) => {
      processedLeft = nextLeft
      processedRight = nextRight
      return emptyResult()
    },
    reset: () => {},
  }
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    nativeAnalyzer,
    showGrid: false,
  })

  try {
    const state = spectrogram as unknown as { drawFrame: () => void }
    state.drawFrame()
    assert.equal(processedLeft, left)
    assert.equal(processedRight, right)
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram forwards orientation and row count to the native analyzer', () => {
  const dom = installFakeCanvasDom()
  const canvas = createFakeCanvas(null, 3, 5)
  let capturedConfig: SpectrogramNativeOptions | null = null
  let pending = [Float32Array.from([0, 0])]
  const dataSource = {
    getPendingSpectrogramSamples: () => {
      const chunks = pending
      pending = []
      return chunks
    },
    getSampleRate: () => 44100,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer: SpectrogramNativeAnalyzer = {
    isAvailable: () => true,
    configure: (options) => {
      capturedConfig = options
    },
    process: (): SpectrogramNativeResult => ({
      display: new Float32Array(0),
      heat: new Float32Array(0),
      columnCount: 0,
      rowCount: 3,
    }),
    reset: () => {},
  }
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    nativeAnalyzer,
    orientation: 'vertical',
    scaleMode: 'linear',
    fftSize: 8192,
    scrollSpeed: 4,
    tiltDbPerOctave: 5.5,
  })

  try {
    const state = spectrogram as unknown as { drawFrame: () => void }
    state.drawFrame()

    assert.equal(capturedConfig?.orientation, 'vertical')
    assert.equal(capturedConfig?.rowCount, 3)
    assert.equal(capturedConfig?.scaleMode, 'linear')
    assert.equal(capturedConfig?.fftSize, 8192)
    assert.equal(capturedConfig?.scrollSpeed, 4)
    assert.equal(capturedConfig?.tiltDbPerOctave, 5.5)
    assert.equal(capturedConfig?.sampleRate, 44100)

    spectrogram.setOptions({ scaleMode: 'mel' })
    pending = [Float32Array.from([0, 0])]
    state.drawFrame()
    assert.equal(capturedConfig?.scaleMode, 'mel')
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
})

test('Spectrogram freezes the waterfall when native analyzer is unavailable', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom()
  const canvas = createFakeCanvas(recorder, 4, 4)
  let pending = [Float32Array.from([0, 1, 0, -1])]
  let pendingFlushes = 0
  let nativeProcessCalls = 0
  const dataSource = {
    getPendingSpectrogramSamples: () => {
      pendingFlushes += 1
      const chunks = pending
      pending = []
      return chunks
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer: SpectrogramNativeAnalyzer = {
    isAvailable: () => false,
    configure: () => {},
    process: () => {
      nativeProcessCalls += 1
      return null
    },
    reset: () => {},
  }
  const spectrogram = new Spectrogram(canvas, {
    dataSource,
    nativeAnalyzer,
  })

  try {
    const state = spectrogram as unknown as { drawFrame: () => void }
    state.drawFrame()

    assert.equal(pendingFlushes, 1)
    assert.equal(nativeProcessCalls, 0)
    assert.equal(recorder.imageDataWrites.length, 0)
    assert.equal(recorder.drawImageCalls.length, 1)
  } finally {
    spectrogram.dispose()
    dom.restore()
  }
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
    assert.ok(peakInfo.dbfs > -20, `expected an audible peak dBFS, got ${peakInfo.dbfs}`)
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

test('SpectrumAnalyzer reports louder-channel dBFS without applying visual tilt', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const fftSize = 4096
  const frequencyHz = 21 * sampleRate / fftSize
  const frame = createCompositeStereoChunk([
    { frequencyHz, amplitude: 0.2 },
  ], sampleRate, fftSize)

  const renderWithTilt = (tiltDbPerOctave: number): {
    peak: SpectrumPeakInfo
    visibleDb: number
  } => {
    let peakInfo: SpectrumPeakInfo | null = null
    const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
      showSideLine: true,
      showGrid: false,
      fillGradient: false,
      smoothing: 0,
      tiltDbPerOctave,
      fftSize,
      dataSource: {
        getPendingSpectrumSamples: () => [],
        getPendingSpectrumStereoSamples: () => [frame],
        getSampleRate: () => sampleRate,
        isPlaying: () => true,
        subscribeToSessionChanges: () => () => {},
      },
      nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
      capturePeakInfo: true,
      onPeakInfo: (nextPeakInfo) => {
        peakInfo = nextPeakInfo
      },
    })

    try {
      const state = analyzer as unknown as {
        drawFrame: () => void
        primaryPointDb: Float32Array
        primaryPointFrequency: Float32Array
      }
      state.drawFrame()
      assert.ok(peakInfo)
      let closestIndex = 0
      for (let index = 1; index < state.primaryPointFrequency.length; index += 1) {
        if (
          Math.abs(state.primaryPointFrequency[index] - peakInfo.frequencyHz)
          < Math.abs(state.primaryPointFrequency[closestIndex] - peakInfo.frequencyHz)
        ) {
          closestIndex = index
        }
      }
      return { peak: peakInfo, visibleDb: state.primaryPointDb[closestIndex] }
    } finally {
      analyzer.dispose()
    }
  }

  try {
    const flat = renderWithTilt(0)
    const tilted = renderWithTilt(6)
    assertAlmostEqual(flat.peak.dbfs, 20 * Math.log10(0.2), 0.3, 'flat dBFS')
    assertAlmostEqual(tilted.peak.dbfs, flat.peak.dbfs, 1e-5, 'tilt-independent dBFS')
    assertAlmostEqual(tilted.peak.frequencyHz, flat.peak.frequencyHz, 0.1, 'visible peak frequency')
    assertAlmostEqual(
      tilted.visibleDb - flat.visibleDb,
      6 * Math.log2(frequencyHz / 1000),
      0.6,
      'visual curve tilt',
    )
  } finally {
    dom.restore()
  }
})

test('SpectrumAnalyzer keeps a left-only Mid curve while reporting the left channel near 0 dBFS', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const fftSize = 4096
  const frequencyHz = 85 * sampleRate / fftSize
  const left = createCompositeStereoChunk([{ frequencyHz, amplitude: 1 }], sampleRate, fftSize).left
  const right = new Float32Array(fftSize)
  let peakInfo: SpectrumPeakInfo | null = null
  let stereoDrains = 0
  const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
    showSideLine: false,
    showGrid: false,
    fillGradient: false,
    smoothing: 0,
    tiltDbPerOctave: 0,
    minFrequency: 20,
    maxFrequency: 20000,
    fftSize,
    dataSource: {
      getPendingSpectrumSamples: () => assert.fail('peak capture must preserve stereo channel data'),
      getPendingSpectrumStereoSamples: () => {
        stereoDrains += 1
        return [{ left, right }]
      },
      getSampleRate: () => sampleRate,
      isPlaying: () => true,
      subscribeToSessionChanges: () => () => {},
    },
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
    capturePeakInfo: true,
    onPeakInfo: (nextPeakInfo) => {
      peakInfo = nextPeakInfo
    },
  })

  try {
    const state = analyzer as unknown as {
      drawFrame: () => void
      primaryPointDb: Float32Array
      primaryPointFrequency: Float32Array
    }
    state.drawFrame()
    assert.ok(peakInfo)
    assert.equal(stereoDrains, 1)
    assertAlmostEqual(peakInfo.dbfs, 0, 0.3, 'left-channel dBFS')

    let closestIndex = 0
    for (let index = 1; index < state.primaryPointFrequency.length; index += 1) {
      if (
        Math.abs(state.primaryPointFrequency[index] - peakInfo.frequencyHz)
        < Math.abs(state.primaryPointFrequency[closestIndex] - peakInfo.frequencyHz)
      ) {
        closestIndex = index
      }
    }
    assertAlmostEqual(state.primaryPointDb[closestIndex], -6.0206, 0.3, 'left-only Mid curve')
  } finally {
    analyzer.dispose()
    dom.restore()
  }
})

test('SpectrumAnalyzer tilt can change the visible peak while each readout stays un-tilted', () => {
  const dom = installFakeCanvasDom()
  const sampleRate = 48000
  const fftSize = 4096

  const captureWithTilt = (tiltDbPerOctave: number): SpectrumPeakInfo => {
    const frame = createCompositeStereoChunk([
      { frequencyHz: 250, amplitude: 0.3 },
      { frequencyHz: 4000, amplitude: 0.15 },
    ], sampleRate, fftSize)
    let peakInfo: SpectrumPeakInfo | null = null
    const analyzer = new SpectrumAnalyzer(createFakeCanvas(), {
      showSideLine: true,
      showGrid: false,
      fillGradient: false,
      smoothing: 0,
      tiltDbPerOctave,
      fftSize,
      dataSource: {
        getPendingSpectrumSamples: () => [],
        getPendingSpectrumStereoSamples: () => [frame],
        getSampleRate: () => sampleRate,
        isPlaying: () => true,
        subscribeToSessionChanges: () => () => {},
      },
      nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
      capturePeakInfo: true,
      onPeakInfo: (nextPeakInfo) => {
        peakInfo = nextPeakInfo
      },
    })
    try {
      ;(analyzer as unknown as { drawFrame: () => void }).drawFrame()
      assert.ok(peakInfo)
      return peakInfo
    } finally {
      analyzer.dispose()
    }
  }

  try {
    const flat = captureWithTilt(0)
    const tilted = captureWithTilt(6)
    assert.ok(flat.frequencyHz > 240 && flat.frequencyHz < 260)
    assert.ok(tilted.frequencyHz > 3900 && tilted.frequencyHz < 4100)
    assertAlmostEqual(flat.dbfs, 20 * Math.log10(0.3), 0.3, 'low peak dBFS')
    assertAlmostEqual(tilted.dbfs, 20 * Math.log10(0.15), 0.3, 'high peak dBFS')
  } finally {
    dom.restore()
  }
})

test('spectrum plugin bridge carries channel-max data and falls back for legacy frames', () => {
  const encode = (values: Float32Array): string => Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString('base64')
  const magnitudes = Float32Array.from([-30, -20, -10])
  const side = Float32Array.from([-50, -40, -30])
  const channelMax = Float32Array.from([-24, -14, -4])

  const decoded = decodeSpectrumFrame({
    sampleRate: 96000,
    magnitudes: encode(magnitudes),
    side: encode(side),
    channelMax: encode(channelMax),
  })
  assert.ok(decoded)
  assert.equal(decoded.sampleRate, 96000)
  assert.deepEqual(Array.from(decoded.channelMax), Array.from(channelMax))

  const legacy = decodeSpectrumFrame({ magnitudes: encode(magnitudes) })
  assert.ok(legacy)
  assert.deepEqual(Array.from(legacy.channelMax), Array.from(magnitudes))

  const analyzer = new BridgeSpectrumAnalyzer(6)
  analyzer.setMagnitudes(magnitudes, side, channelMax)
  const output = new Float32Array(3)
  assert.equal(analyzer.fillChannelMaxMagnitudes(output), 3)
  assert.deepEqual(Array.from(output), Array.from(channelMax))

  analyzer.setMagnitudes(magnitudes, side)
  assert.deepEqual(Array.from(analyzer.getChannelMaxMagnitudes()), Array.from(magnitudes))
  analyzer.setFFTSize(8)
  assert.deepEqual(Array.from(analyzer.getChannelMaxMagnitudes()), [-100, -100, -100, -100])
  analyzer.reset()
  assert.deepEqual(Array.from(analyzer.getChannelMaxMagnitudes()), [-100, -100, -100, -100])
  assert.equal(formatSpectrumPeakDbfs(-6.0206), '-6.02dBFS')
  assert.equal(formatSpectrumPeakDbfs(0), '+0.00dBFS')
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
    nativeAnalyzer: createFakeSpectrumNativeAnalyzer(),
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
  profile.scopeSettings.vectorscope.zoomDb = 6
  const authoredTheme = createDefaultTheme()
  authoredTheme.scopes.background = 'rgb(3, 4, 5)'
  authoredTheme.scopes.guides = 'rgba(120, 130, 140, 0.2)'
  authoredTheme.vectorscope.phaseRisk = 'rgb(200, 100, 50)'
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
  assert.equal(vectorscope.phaseRiskColor, 'rgb(200, 100, 50)')
  assert.equal(vectorscope.zoomDb, 6)

  const pluginVectorscope = vectorscopeSettingsToOptions(profile.scopeSettings.vectorscope, theme.vectorscope)
  assert.equal(pluginVectorscope.phaseRiskColor, vectorscope.phaseRiskColor)
  assert.equal(pluginVectorscope.zoomDb, vectorscope.zoomDb)
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

test('Vectorscope centers width-constrained unipolar artwork vertically', () => {
  for (const mode of ['polar-unipolar', 'linear-unipolar'] as const) {
    const layout = getVectorscopeLayout(120, 300, mode)
    const artworkTop = layout.centerY - layout.radius
    const artworkBottom = layout.centerY

    assertAlmostEqual(
      (artworkTop + artworkBottom) / 2,
      150,
      1e-12,
      `${mode} artwork should center in a narrow canvas`,
    )
  }
})

test('Vectorscope preserves height-limited and bipolar layout behavior', () => {
  const wideUnipolar = getVectorscopeLayout(600, 200, 'polar-unipolar')
  assertAlmostEqual(wideUnipolar.centerY, 192, 1e-12, 'wide unipolar layout should remain bottom-aligned')
  assertAlmostEqual(wideUnipolar.radius, 192 * 0.88, 1e-12, 'wide unipolar radius should remain height-limited')

  for (const mode of ['lissajous', 'polar-bipolar', 'linear-bipolar'] as const) {
    const layout = getVectorscopeLayout(120, 300, mode)
    assertAlmostEqual(layout.centerY, 150, 1e-12, `${mode} should remain centered`)
    assertAlmostEqual(layout.radius, 54, 1e-12, `${mode} radius should remain unchanged`)
  }
})

test('vectorscope grids use calibrated boundaries, phase-risk shading, and honest labels', () => {
  const lissajousRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(lissajousRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'lissajous',
    'rgb(255, 191, 0)',
    6,
  )
  assert.equal(
    lissajousRecorder.lineDashes.some((segments) => segments.length > 0),
    false,
    'XY should not render an arbitrary overflow boundary',
  )
  assert.equal(lissajousRecorder.strokeRects.length, 1)
  assert.equal(lissajousRecorder.strokeRects[0]?.width, getVectorscopeLayout(320, 180, 'lissajous').radius * 2)
  assert.equal(
    lissajousRecorder.fillRects.filter(({ fillStyle }) => fillStyle === 'rgba(255, 191, 0, 0.08)').length,
    2,
    'XY should shade its two opposite-sign quadrants',
  )
  assert.equal(lissajousRecorder.fillTexts.some(({ text }) => text === '-6 dBFS'), true)
  assert.equal(lissajousRecorder.fillTexts.some(({ text }) => text === 'M'), true)
  assert.equal(lissajousRecorder.fillTexts.some(({ text }) => text === 'S'), true)

  const linearRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(linearRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'linear-bipolar',
    'rgb(255, 191, 0)',
  )
  assert.equal(
    linearRecorder.lineDashes.some((segments) => segments.length > 0),
    false,
    'linear mode should only use its exact outer diamond',
  )
  assert.equal(linearRecorder.fills.filter(({ fillStyle }) => fillStyle === 'rgba(255, 191, 0, 0.08)').length, 2)
  assert.equal(linearRecorder.fillTexts.some(({ text }) => text === 'M+'), true)
  assert.equal(linearRecorder.fillTexts.some(({ text }) => text === 'M−'), true)
  assert.equal(linearRecorder.fillTexts.some(({ text }) => text === 'S−'), true)
  assert.equal(linearRecorder.fillTexts.some(({ text }) => text === 'S+'), true)

  const polarRecorder = createFakeCanvasRecorder()
  drawVectorscopeGridForMode(
    createFakeCanvasContext(polarRecorder),
    320,
    180,
    'rgba(255, 255, 255, 0.12)',
    'rgba(255, 255, 255, 0.05)',
    'rgba(255, 255, 255, 0.2)',
    'polar-bipolar',
    'rgb(255, 191, 0)',
  )
  const polarLayout = getVectorscopeLayout(320, 180, 'polar-bipolar')
  assert.equal(
    polarRecorder.lineDashes.some((segments) => segments.length > 0),
    false,
    'polar mode should not render an arbitrary overflow circle',
  )
  assertAlmostEqual(
    Math.max(...polarRecorder.arcs.map(({ radius }) => radius)),
    polarLayout.radius,
    1e-6,
    'the outer radial-reference circle should equal the layout radius',
  )
  assert.equal(polarRecorder.fills.filter(({ fillStyle }) => fillStyle === 'rgba(255, 191, 0, 0.08)').length, 2)
  assert.equal(polarRecorder.fillTexts.some(({ text }) => text === '0 dB radial'), true)
})

test('vectorscope projections calibrate XY and M/S Linear while preserving classic Polar shaping', () => {
  const assertPoint = (
    actual: { dx: number; dy: number },
    expected: { dx: number; dy: number },
    message: string,
  ): void => {
    assertAlmostEqual(actual.dx, expected.dx, 1e-9, `${message} x`)
    assertAlmostEqual(actual.dy, expected.dy, 1e-9, `${message} y`)
  }

  assertPoint(transformPoint(0.5, -0.25, 'lissajous'), { dx: -0.25, dy: 0.5 }, 'XY')
  assertPoint(transformPoint(1, 1, 'linear-bipolar'), { dx: 0, dy: 1 }, 'linear mono')
  assertPoint(transformPoint(1, 0, 'linear-bipolar'), { dx: -0.5, dy: 0.5 }, 'linear left-only')
  assertPoint(transformPoint(0, 1, 'linear-bipolar'), { dx: 0.5, dy: 0.5 }, 'linear right-only')
  assertPoint(transformPoint(1, -1, 'linear-bipolar'), { dx: -1, dy: 0 }, 'linear anti-phase')
  assertPoint(transformPoint(-1, -1, 'linear-bipolar'), { dx: 0, dy: -1 }, 'linear inverted mono')
  assertPoint(transformPoint(0.75, -0.25, 'linear-bipolar'), { dx: -0.5, dy: 0.25 }, 'linear unequal')

  const polarLeft = transformPoint(1, 0, 'polar-bipolar')
  assertAlmostEqual(polarLeft.dx, -Math.SQRT1_2, 1e-9, 'polar left-only x')
  assertAlmostEqual(polarLeft.dy, Math.SQRT1_2, 1e-9, 'polar left-only y')
  assertAlmostEqual(Math.hypot(polarLeft.dx, polarLeft.dy), 1, 1e-9, 'polar left-only radius')
  const polarUnequal = transformPoint(0.75, -0.25, 'polar-bipolar')
  assertAlmostEqual(
    Math.hypot(polarUnequal.dx, polarUnequal.dy),
    Math.pow(Math.hypot(0.75, -0.25), 0.35),
    1e-9,
    'polar unequal radius retains classic shaping',
  )

  for (const amplitude of [0.25, 0.5, 1]) {
    const xy = transformPoint(amplitude, amplitude, 'lissajous')
    const linear = transformPoint(amplitude, amplitude, 'linear-bipolar')
    const polar = transformPoint(amplitude, amplitude, 'polar-bipolar')
    assertAlmostEqual(Math.max(Math.abs(xy.dx), Math.abs(xy.dy)), amplitude, 1e-9, `XY amplitude ${amplitude}`)
    assertAlmostEqual(Math.abs(linear.dx) + Math.abs(linear.dy), amplitude, 1e-9, `linear amplitude ${amplitude}`)
    assertAlmostEqual(
      Math.hypot(polar.dx, polar.dy),
      Math.pow(Math.hypot(amplitude, amplitude), 0.35),
      1e-9,
      `classic polar amplitude ${amplitude}`,
    )
  }

  for (const mode of ['polar-unipolar', 'linear-unipolar'] as const) {
    assertPoint(
      transformPoint(-0.8, -0.2, mode),
      transformPoint(0.8, 0.2, mode),
      `${mode} antipodal fold`,
    )
  }
})

test('vectorscope zoom maps the labeled per-channel and Polar radial references', () => {
  for (const zoomDb of [-12, 0, 24]) {
    const inputReference = 10 ** (-zoomDb / 20)
    assertAlmostEqual(vectorscopeZoomDbToGain(zoomDb) * inputReference, 1, 1e-12, `zoom ${zoomDb}`)

    for (const mode of ['lissajous', 'linear-unipolar', 'linear-bipolar'] as const) {
      const point = transformPoint(inputReference, inputReference, mode, zoomDb)
      const boundaryValue = mode === 'lissajous'
        ? Math.max(Math.abs(point.dx), Math.abs(point.dy))
        : Math.abs(point.dx) + Math.abs(point.dy)
      assertAlmostEqual(boundaryValue, 1, 1e-9, `${mode} at zoom ${zoomDb}`)
    }

    for (const mode of ['polar-unipolar', 'polar-bipolar'] as const) {
      const point = transformPoint(inputReference, 0, mode, zoomDb)
      assertAlmostEqual(Math.hypot(point.dx, point.dy), 1, 1e-9, `${mode} radial reference at zoom ${zoomDb}`)
    }
  }

  assert.equal(normalizeVectorscopeZoomDb(6.49), 6)
  assert.equal(normalizeVectorscopeZoomDb(6.5), 7)
  assert.equal(normalizeVectorscopeZoomDb(-99), -12)
  assert.equal(normalizeVectorscopeZoomDb(99), 24)
  assert.equal(normalizeVectorscopeZoomDb('invalid'), 0)
  assert.equal(formatVectorscopeReferenceDbfs(6), '-6 dBFS')
  assert.equal(formatVectorscopeReferenceDbfs(-6), '+6 dBFS')
})

test('vectorscope phase-risk classification treats channel guides as safe boundaries', () => {
  assert.equal(isVectorscopePhaseRisk(1, 1), false)
  assert.equal(isVectorscopePhaseRisk(-1, -1), false)
  assert.equal(isVectorscopePhaseRisk(1, -1), true)
  assert.equal(isVectorscopePhaseRisk(-0.25, 0.75), true)
  assert.equal(isVectorscopePhaseRisk(1, 0), false)
  assert.equal(isVectorscopePhaseRisk(0, -1), false)
})

test('native and JavaScript vectorscope paths project identical channel samples', () => {
  const dom = installFakeCanvasDom()
  const dataSource = {
    getPendingVectorscopeSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(), { dataSource, nativeAnalyzer: null, zoomDb: 3 })

  try {
    const state = vectorscope as unknown as {
      drawPoints: (
        ctx: CanvasRenderingContext2D,
        x: Float32Array,
        y: Float32Array,
        count: number,
        centerX: number,
        centerY: number,
        scale: number,
      ) => void
      drawFallbackPoints: (
        ctx: CanvasRenderingContext2D,
        samples: Array<{ left: Float32Array; right: Float32Array }>,
        centerX: number,
        centerY: number,
        scale: number,
      ) => void
      options: { mode: 'polar-unipolar' }
    }
    state.options.mode = 'polar-unipolar'
    const left = -0.8
    const right = -0.2
    const nativeRecorder = createFakeCanvasRecorder()
    const fallbackRecorder = createFakeCanvasRecorder()

    state.drawPoints(
      createFakeCanvasContext(nativeRecorder),
      new Float32Array([right]),
      new Float32Array([left]),
      1,
      100,
      100,
      80,
    )
    state.drawFallbackPoints(
      createFakeCanvasContext(fallbackRecorder),
      [{ left: new Float32Array([left]), right: new Float32Array([right]) }],
      100,
      100,
      80,
    )

    assert.equal(nativeRecorder.fillRects.length, 1)
    assert.equal(fallbackRecorder.fillRects.length, 1)
    assertAlmostEqual(nativeRecorder.fillRects[0]?.x ?? 0, fallbackRecorder.fillRects[0]?.x ?? 0, 1e-6, 'path parity x')
    assertAlmostEqual(nativeRecorder.fillRects[0]?.y ?? 0, fallbackRecorder.fillRects[0]?.y ?? 0, 1e-6, 'path parity y')
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
})

test('Vectorscope applies live calibrated zoom and clears the previous projection', () => {
  const dom = installFakeCanvasDom()
  const nativeAnalyzer = createFakeVectorscopeNativeAnalyzer()
  const dataSource = {
    getPendingVectorscopeSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(), { dataSource, nativeAnalyzer })

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
      options: { zoomDb: number }
    }
    const layout = getVectorscopeLayout(320, 180, 'linear-bipolar')
    const recorder = createFakeCanvasRecorder()
    const ctx = createFakeCanvasContext(recorder)
    const scale = state.getProjectionScale(layout.radius)

    vectorscope.setOptions({ zoomDb: 6.4 })
    assert.equal(state.options.zoomDb, 6)
    assert.equal(nativeAnalyzer.resetCount, 1)
    state.drawProjectedDot(ctx, -1, 1, 'linear-bipolar', layout.centerX, layout.centerY, scale, 2)

    assert.equal(recorder.fillRects.length, 1)
    const rect = recorder.fillRects[0]
    const projectedCenterX = rect.x + rect.width / 2
    const projectedCenterY = rect.y + rect.height / 2
    assertAlmostEqual(
      projectedCenterX,
      layout.centerX + layout.radius * vectorscopeZoomDbToGain(6),
      1e-6,
      'linear projection should apply the normalized zoom gain',
    )
    assertAlmostEqual(
      projectedCenterY,
      layout.centerY,
      1e-6,
      'anti-phase projection should stay on the Side axis',
    )
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
})

test('scopeSettingsToOptions forwards themed backgrounds and track colors to spectrogram, VU, and LUFS modules', () => {
  const profile = createDefaultProfile('Default')
  profile.scopeSettings.spectrogram.rotation = 90
  profile.scopeSettings.spectrogram.tiltDbPerOctave = 5.2
  profile.scopeSettings.lufsmeter.readout = 'shortTerm'
  profile.scopeSettings.vumeter.needleChannels = 'combined'
  const authoredTheme = createDefaultTheme()
  authoredTheme.scopes.background = 'rgb(6, 7, 8)'
  authoredTheme.vumeter.track = 'rgb(9, 10, 11)'
  authoredTheme.vumeter.needleLeft = 'rgb(20, 21, 22)'
  authoredTheme.vumeter.needleRight = 'rgb(23, 24, 25)'
  authoredTheme.vumeter.needleCombined = 'rgb(26, 27, 28)'
  authoredTheme.lufsmeter.track = 'rgb(12, 13, 14)'
  authoredTheme.lufsmeter.target = 'rgb(15, 16, 17)'
  const theme = resolveTheme(authoredTheme)

  const spectrogram = scopeSettingsToOptions('spectrogram', profile.scopeSettings.spectrogram, theme.spectrogram)
  assert.equal(spectrogram.backgroundColor, 'rgb(6, 7, 8)')
  assert.equal(spectrogram.orientation, 'horizontal')
  assert.equal(spectrogram.tiltDbPerOctave, 5.2)

  const vumeter = scopeSettingsToOptions('vumeter', profile.scopeSettings.vumeter, theme.vumeter)
  assert.equal(vumeter.backgroundColor, 'rgb(6, 7, 8)')
  assert.equal(vumeter.trackColor, 'rgb(9, 10, 11)')
  assert.equal(vumeter.scaleColor, theme.vumeter.scale)
  assert.equal(vumeter.labelColor, theme.vumeter.labels)
  assert.equal(vumeter.needleLeftColor, 'rgb(20, 21, 22)')
  assert.equal(vumeter.needleRightColor, 'rgb(23, 24, 25)')
  assert.equal(vumeter.needleCombinedColor, 'rgb(26, 27, 28)')
  assert.equal(vumeter.needleChannels, 'combined')

  const lufsmeter = scopeSettingsToOptions('lufsmeter', profile.scopeSettings.lufsmeter, theme.lufsmeter)
  assert.equal(lufsmeter.backgroundColor, 'rgb(6, 7, 8)')
  assert.equal(lufsmeter.trackColor, 'rgb(12, 13, 14)')
  assert.equal(lufsmeter.targetColor, 'rgb(15, 16, 17)')
  assert.equal(lufsmeter.scaleColor, theme.lufsmeter.scale)
  assert.equal(lufsmeter.labelColor, theme.lufsmeter.labels)
  assert.equal(lufsmeter.readout, 'shortTerm')
})

test('VUMeter shared needle helpers map dBFS to a classic VU face', () => {
  // K-14: 0 VU = -14 dBFS
  assert.equal(dbfsToClassicVu(-14), 0)
  assert.equal(dbfsToClassicVu(-11), 3)
  assert.equal(dbfsToClassicVu(-15), -1)
  assert.equal(dbfsToClassicVu(-40), -20)
  assertAlmostEqual(classicVuToNormalized(-20), 0, 1e-12, '-20 VU should start the scale')
  assertAlmostEqual(classicVuToNormalized(0), 0.81, 1e-12, '0 VU should sit near the hot zone')
  assertAlmostEqual(classicVuToNormalized(3), 1, 1e-12, '+3 VU should end the scale')
})

test('VUMeter needle face layout stays fixed instead of scaling up', () => {
  const wide = resolveVUNeedleFaceLayout(1200, 500)
  assert.equal(wide.width, VU_NEEDLE_FACE_WIDTH_CSS_PX)
  assert.equal(wide.height, VU_NEEDLE_FACE_HEIGHT_CSS_PX)
  assertAlmostEqual(wide.x, (1200 - VU_NEEDLE_FACE_WIDTH_CSS_PX) / 2, 1e-12, 'fixed face should center in extra width')
  assertAlmostEqual(wide.y, 500 - VU_NEEDLE_FACE_HEIGHT_CSS_PX, 1e-12, 'fixed face should bottom-align in extra height')
  assert.equal(wide.scale, 1)

  const retinaWide = resolveVUNeedleFaceLayout(2400, 1000, 2)
  assert.equal(retinaWide.width, VU_NEEDLE_FACE_WIDTH_CSS_PX * 2)
  assert.equal(retinaWide.height, VU_NEEDLE_FACE_HEIGHT_CSS_PX * 2)
  assert.equal(retinaWide.y, 1000 - VU_NEEDLE_FACE_HEIGHT_CSS_PX * 2)
  assert.equal(retinaWide.scale, 1)

  const small = resolveVUNeedleFaceLayout(280, 180)
  assert.equal(small.width, 280)
  assert.equal(small.height, 180)
  assertAlmostEqual(small.scale, 0.5, 1e-12, 'fixed face should only shrink when the canvas is smaller')

  const narrow = resolveVUNeedleFaceLayout(280, 360)
  assert.equal(narrow.width, 280)
  assert.equal(narrow.height, 180)
  assert.equal(narrow.y, 90)

  const retinaNarrow = resolveVUNeedleFaceLayout(560, 720, 2)
  assert.equal(retinaNarrow.width, 560)
  assert.equal(retinaNarrow.height, 360)
  assert.equal(retinaNarrow.y, 180)
})

test('VUMeter needle face renders a readable primary scale without redundant inner percentages', () => {
  const dataSource = {
    getPendingVUMeterSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => false,
    subscribeToSessionChanges: () => () => {},
  }
  const renderNeedleFace = (
    width: number,
    height: number,
    needleChannels: 'stereo' | 'combined',
  ): FakeCanvasRecorder => {
    const recorder = createFakeCanvasRecorder()
    const meter = new VUMeter(createFakeCanvas(recorder, width, height), {
      mode: 'needle',
      needleChannels,
      dataSource,
      nativeAnalyzer: null,
      labelColor: 'rgb(180, 200, 220)',
      scaleColor: 'rgb(90, 100, 110)',
      clipColor: 'rgb(250, 80, 70)',
    })

    try {
      ;(meter as unknown as { drawFrame: () => void }).drawFrame()
    } finally {
      meter.dispose()
    }
    return recorder
  }

  const full = renderNeedleFace(560, 360, 'stereo')
  const fullColdEndpoint = full.fillTexts.find((text) => text.text === '20' && text.font.startsWith('700 '))
  const fullMajor = full.fillTexts.find((text) => text.text === '+3')
  const fullIntermediate = full.fillTexts.find((text) => text.text === '5')
  const fullLeftLabel = full.fillTexts.find((text) => text.text === 'L')
  const fullRightLabel = full.fillTexts.find((text) => text.text === 'R')
  const fullReadoutValue = full.fillTexts.find((text) => text.text === '-∞')
  const fullReadoutUnit = full.fillTexts.find((text) => text.text === 'dB')

  assert.equal(fullMajor?.font, '700 26px "JetBrains Mono", monospace')
  assert.equal(fullMajor?.fillStyle, 'rgba(250, 80, 70, 1)')
  assert.equal(fullIntermediate?.font, '600 23.92px "JetBrains Mono", monospace')
  assert.equal(fullIntermediate?.fillStyle, 'rgba(180, 200, 220, 1)')
  assert.equal(fullLeftLabel?.font, '700 13.5px "JetBrains Mono", monospace')
  assert.equal(fullRightLabel?.font, '700 13.5px "JetBrains Mono", monospace')
  assert.equal(fullReadoutValue?.font, '600 19.5px "JetBrains Mono", monospace')
  assert.equal(fullReadoutUnit?.font, '600 11.5px "JetBrains Mono", monospace')
  assert.equal(full.fillTexts.some((text) => ['40', '60', '80', '100'].includes(text.text)), false)
  assert.equal(full.fillTexts.some((text) => text.font.startsWith('500 ')), false)
  assert.equal(
    full.fillRects.filter((rect) => rect.fillStyle === 'rgba(180, 200, 220, 0.055)').length,
    2,
  )
  assert.ok(full.arcs.some((arc) => arc.radius > 5))

  const fullScaleTicks = full.lineStrokes.slice(0, 12)
  const fullColdTickStart = fullScaleTicks[0]?.commands[0]
  const fullHotTickStart = fullScaleTicks[11]?.commands[0]
  assert.equal(fullColdTickStart?.kind, 'moveTo')
  assert.equal(fullHotTickStart?.kind, 'moveTo')
  assert.ok((fullColdEndpoint?.x ?? Number.POSITIVE_INFINITY) < (fullColdTickStart?.x ?? Number.NEGATIVE_INFINITY))
  assert.ok((fullMajor?.x ?? Number.NEGATIVE_INFINITY) > (fullHotTickStart?.x ?? Number.POSITIVE_INFINITY))

  const majorTick = full.lineStrokes.find((stroke) => stroke.strokeStyle === 'rgba(90, 100, 110, 0.96)')
  const minorTick = full.lineStrokes.find((stroke) => stroke.strokeStyle === 'rgba(90, 100, 110, 0.82)')
  assert.ok(majorTick)
  assert.ok(minorTick)
  assert.ok(majorTick.lineWidth > minorTick.lineWidth)

  const compact = renderNeedleFace(280, 180, 'combined')
  const compactColdEndpoint = compact.fillTexts.find((text) => text.text === '20' && text.font.startsWith('700 '))
  const compactMajor = compact.fillTexts.find((text) => text.text === '+3')
  const compactIntermediate = compact.fillTexts.find((text) => text.text === '5')
  const compactReadoutValue = compact.fillTexts.find((text) => text.text === '-∞')
  const compactReadoutUnit = compact.fillTexts.find((text) => text.text === 'dB')
  const compactPrimaryLabels = compact.fillTexts.filter((text) => (
    text.font === '700 13px "JetBrains Mono", monospace'
    || text.font === '600 11.96px "JetBrains Mono", monospace'
  ))

  assert.equal(compactMajor?.font, '700 13px "JetBrains Mono", monospace')
  assert.equal(compactIntermediate?.font, '600 11.96px "JetBrains Mono", monospace')
  assert.equal(compactReadoutValue?.font, '600 9.75px "JetBrains Mono", monospace')
  assert.equal(compactReadoutUnit?.font, '600 5.75px "JetBrains Mono", monospace')
  assert.equal(compact.fillTexts.some((text) => ['40', '60', '80', '100'].includes(text.text)), false)
  assert.equal(compactPrimaryLabels.length, 9)
  for (const label of compactPrimaryLabels) {
    const fontSize = Number(label.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    const halfLabelWidth = label.text.length * fontSize * 0.62 / 2
    assert.ok(label.x - halfLabelWidth >= 5.5)
    assert.ok(label.x + halfLabelWidth <= 274.5)
    assert.ok(label.y >= 0 && label.y <= 180)
  }

  const compactScaleTicks = compact.lineStrokes.slice(0, 12)
  const compactColdTickStart = compactScaleTicks[0]?.commands[0]
  const compactHotTickStart = compactScaleTicks[11]?.commands[0]
  assert.ok((compactColdEndpoint?.x ?? Number.POSITIVE_INFINITY) < (compactColdTickStart?.x ?? Number.NEGATIVE_INFINITY))
  assert.ok((compactMajor?.x ?? Number.NEGATIVE_INFINITY) > (compactHotTickStart?.x ?? Number.POSITIVE_INFINITY))
})

test('VUMeter shared needle helpers switch between stereo needles and combined RMS', () => {
  const stereo = resolveVUNeedleReadings({
    leftDb: -6,
    rightDb: -12,
    leftPeakDb: -3,
    rightPeakDb: -9,
    needleChannels: 'stereo',
  })
  const combined = resolveVUNeedleReadings({
    leftDb: -6,
    rightDb: -12,
    leftPeakDb: -3,
    rightPeakDb: -9,
    needleChannels: 'combined',
  })
  const expectedCombinedDb = stereoRmsDbAverage(-6, -12)

  assert.equal(stereo.length, 2)
  assert.equal(stereo[0]?.id, 'left')
  assert.equal(stereo[1]?.id, 'right')
  assert.equal(combined.length, 1)
  assert.equal(combined[0]?.id, 'combined')
  assertAlmostEqual(combined[0]?.db ?? 0, expectedCombinedDb, 1e-12, 'combined needle should average stereo RMS power')
  assert.equal(combined[0]?.peakDb, -3)
  assertAlmostEqual(combined[0]?.vu ?? 0, dbfsToClassicVu(expectedCombinedDb), 1e-12, 'combined needle should use classic VU mapping')
})

test('scopeSummary reports VU needle channel mode', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('vumeter', profile.scopeSettings.vumeter), 'BAR · HORIZONTAL · K-14')

  profile.scopeSettings.vumeter.mode = 'needle'
  assert.equal(scopeSummary('vumeter', profile.scopeSettings.vumeter), 'NEEDLE · STEREO · K-14')

  profile.scopeSettings.vumeter.needleChannels = 'combined'
  assert.equal(scopeSummary('vumeter', profile.scopeSettings.vumeter), 'NEEDLE · COMBINED · K-14')

  profile.scopeSettings.vumeter.referenceDb = -13.5
  assert.equal(scopeSummary('vumeter', profile.scopeSettings.vumeter), 'NEEDLE · COMBINED · -13.5 dBFS')
})

test('VUMeter dBFS-to-VU mapping honors custom references', () => {
  // Default (K-14)
  assert.equal(dbfsToClassicVu(-14), 0)
  // K-18 (broadcast)
  assert.equal(dbfsToClassicVu(-18, -18), 0)
  assert.equal(dbfsToClassicVu(-15, -18), 3)
  // K-10 (loud masters)
  assert.equal(dbfsToClassicVu(-10, -10), 0)
  assert.equal(dbfsToClassicVu(-30, -10), -20)
})

test('scopeSummary includes only waveform display modes', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Mono')

  profile.scopeSettings.waveform.mode = 'stereo'
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Stereo')

  profile.scopeSettings.waveform.multiband = true
  assert.equal(scopeSummary('waveform', profile.scopeSettings.waveform), 'Stereo · RGB')
})

test('scopeSummary exposes explicit vectorscope geometry and zoom names', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('vectorscope', profile.scopeSettings.vectorscope), 'XY (L/R)')

  profile.scopeSettings.vectorscope.mode = 'polar-unipolar'
  profile.scopeSettings.vectorscope.zoomDb = 6
  profile.scopeSettings.vectorscope.multiband = true
  assert.equal(
    scopeSummary('vectorscope', profile.scopeSettings.vectorscope),
    'Polar (Folded) · Zoom +6 dB · RGB',
  )

  profile.scopeSettings.vectorscope.mode = 'linear-bipolar'
  assert.equal(
    scopeSummary('vectorscope', profile.scopeSettings.vectorscope),
    'M/S Linear (Bipolar) · Zoom +6 dB · RGB',
  )
})

test('scopeSummary includes loudness readout source', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('lufsmeter', profile.scopeSettings.lufsmeter), 'Short-term LUFS')

  profile.scopeSettings.lufsmeter.readout = 'integrated'
  assert.equal(scopeSummary('lufsmeter', profile.scopeSettings.lufsmeter), 'Integrated LUFS')

  profile.scopeSettings.lufsmeter.readout = 'momentary'
  assert.equal(scopeSummary('lufsmeter', profile.scopeSettings.lufsmeter), 'Momentary LUFS')
})

test('scopeSummary includes spectrum peak mode when enabled', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'LOG · Extended · Fill · FFT 2048')

  profile.scopeSettings.spectrum.scaleMode = 'mel'
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'MEL · Extended · Fill · FFT 2048')
  profile.scopeSettings.spectrum.scaleMode = 'log'

  profile.scopeSettings.spectrum.peakInfoMode = 'on'
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'LOG · Extended · Fill · FFT 2048 · Peak')

  profile.scopeSettings.spectrum.peakInfoMode = 'following'
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'LOG · Extended · Fill · FFT 2048 · Peak Follow')
})

test('scopeSummary includes visual-scope rotation and mirroring', () => {
  const profile = createDefaultProfile('Default')

  assert.equal(scopeSummary('spectrogram', profile.scopeSettings.spectrogram), '0° · LOG · Extended · sharper')

  profile.scopeSettings.spectrogram.clarityMode = 'focused'
  assert.equal(scopeSummary('spectrogram', profile.scopeSettings.spectrogram), '0° · LOG · Extended · focused')
  profile.scopeSettings.spectrogram.clarityMode = 'sharper'

  profile.scopeSettings.spectrogram.rotation = 270
  profile.scopeSettings.spectrogram.mirrorHorizontal = true
  assert.equal(scopeSummary('spectrogram', profile.scopeSettings.spectrogram), '270° · LOG · Extended · sharper · Mirror')

  profile.scopeSettings.spectrum.rotation = 90
  profile.scopeSettings.spectrum.mirrorHorizontal = true
  assert.equal(scopeSummary('spectrum', profile.scopeSettings.spectrum), 'LOG · Extended · Fill · FFT 2048 · R90° · Mirror')
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

test('ScopePopoutDataSource preserves spectrogram stereo batches', () => {
  const dataSource = new ScopePopoutDataSource('spectrogram')
  const left = new Float32Array([0.5, -0.5])
  const right = new Float32Array([-0.5, 0.5])

  dataSource.pushAudioBatch([{ left, right }])

  assert.equal(dataSource.getPendingSpectrogramSamples().length, 0)
  const batch = dataSource.getPendingSpectrogramStereoSamples()
  assert.equal(batch.length, 1)
  assert.equal(batch[0]?.left, left)
  assert.equal(batch[0]?.right, right)
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
  assert.match(stylesSource, /\.bottom-bar__section--theme \{[\s\S]*min-width: 480px;/)
  assert.match(stylesSource, /\.bottom-bar__inline--theme \.settings-chip,[\s\S]*flex: 0 0 auto;/)
  assert.match(stylesSource, /\.bottom-bar__section-header \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-metadata \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-description \{/)
  assert.match(stylesSource, /\.bottom-bar__theme-credit--link \{/)
})

test('BottomBar keeps Window controls on one row', async () => {
  const componentSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'BottomBar.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')

  const windowSection = componentSource.match(
    /<section className="bottom-bar__section bottom-bar__section--window">([\s\S]*?)<div className="bottom-bar__divider" \/>/,
  )?.[1]
  assert.ok(windowSection)
  assert.equal(windowSection.match(/bottom-bar__inline--window/g)?.length, 1)
  assert.doesNotMatch(windowSection, /bottom-bar__inline--desktop-integration/)
  assert.match(stylesSource, /\.bottom-bar__section--window \{[\s\S]*min-width: 880px;/)
  assert.match(stylesSource, /\.bottom-bar__inline--window \{[\s\S]*gap: 8px;/)
})

test('BottomBar close button uses flat themed control backgrounds', async () => {
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')
  const closeBlock = [...stylesSource.matchAll(/^\.settings-panel__close \{([\s\S]*?)\n\}/gm)]
    .map((match) => match[1])
    .find((block) => block.includes('min-height: 34px;'))
  const closeHoverBlock = stylesSource.match(/\.settings-panel__close:hover \{([\s\S]*?)\n\}/)?.[1]

  assert.ok(closeBlock)
  assert.ok(closeHoverBlock)
  assert.match(closeBlock, /background: var\(--control-bg\);/)
  assert.match(closeHoverBlock, /background: var\(--control-bg-hover\);/)
  assert.doesNotMatch(closeBlock, /linear-gradient/)
  assert.doesNotMatch(closeHoverBlock, /linear-gradient/)
})

test('pin buttons use a persistent filled active state distinct from inactive hover', async () => {
  const toolbarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Toolbar.tsx'), 'utf8')
  const popoutSource = await readFile(join(process.cwd(), 'src', 'renderer', 'popouts', 'ScopePopoutWindow.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')
  const toolbarHoverBlock = stylesSource.match(
    /\.toolbar__icon-button--pin:hover:not\(:disabled\):not\(\.is-active\) \{([\s\S]*?)\n\}/,
  )?.[1]
  const toolbarActiveBlock = stylesSource.match(
    /\.toolbar__icon-button--pin\.is-active,\n\.toolbar__icon-button--pin\.is-active:hover:not\(:disabled\) \{([\s\S]*?)\n\}/,
  )?.[1]
  const popoutHoverBlock = stylesSource.match(
    /\.scope-popout__button--pin:hover:not\(:disabled\):not\(\.is-active\) \{([\s\S]*?)\n\}/,
  )?.[1]
  const popoutActiveBlock = stylesSource.match(
    /\.scope-popout__button--pin\.is-active,\n\.scope-popout__button--pin\.is-active:hover:not\(:disabled\) \{([\s\S]*?)\n\}/,
  )?.[1]

  assert.match(toolbarSource, /toolbar__icon-button toolbar__icon-button--pin/)
  assert.match(toolbarSource, /aria-pressed=\{isAlwaysOnTop\}/)
  assert.match(popoutSource, /scope-popout__button scope-popout__button--pin/)
  assert.match(popoutSource, /aria-pressed=\{isAlwaysOnTop\}/)
  assert.ok(toolbarHoverBlock)
  assert.ok(toolbarActiveBlock)
  assert.ok(popoutHoverBlock)
  assert.ok(popoutActiveBlock)

  assert.match(toolbarHoverBlock, /background: var\(--control-bg\);/)
  assert.match(popoutHoverBlock, /background: var\(--control-bg\);/)
  assert.match(toolbarActiveBlock, /border-color: var\(--accent\);/)
  assert.match(popoutActiveBlock, /border-color: var\(--accent\);/)
  assert.match(stylesSource, /\.toolbar__icon-button--pin\.is-active svg path \{\n  fill: currentColor;/)
  assert.match(stylesSource, /\.scope-popout__button--pin\.is-active svg path \{\n  fill: currentColor;/)
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

test('rolling capture exposes persisted duration controls and a native toolbar drag target', async () => {
  const bottomBarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'BottomBar.tsx'), 'utf8')
  const toolbarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Toolbar.tsx'), 'utf8')
  const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const trayBridgeSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'TrayControlBridge.tsx'), 'utf8')

  assert.match(bottomBarSource, /ROLLING_CAPTURE_DURATIONS\.map/)
  assert.match(bottomBarSource, /setRollingCaptureSeconds\(null\)/)
  assert.match(bottomBarSource, /revealRollingCaptureFolder/)
  assert.match(toolbarSource, /className=\{`toolbar__clip-chip/)
  assert.match(toolbarSource, /draggable=\{rollingCaptureStatus\.hasAudio\}/)
  assert.match(toolbarSource, /onDragStart=\{handleAudioClipDragStart\}/)
  assert.match(preloadSource, /ipcRenderer\.send\('audio-clips:start-drag', payload\)/)
  assert.match(mainSource, /event\.sender\.startDrag/)
  assert.match(mainSource, /Prism Captures/)
  assert.match(mainSource, /label: 'Rolling Capture'/)
  assert.match(mainSource, /type: 'set-rolling-capture'/)
  assert.match(trayBridgeSource, /audio\.setRollingCaptureSeconds\(command\.durationSeconds\)/)
  assert.match(trayBridgeSource, /rollingCaptureSeconds,/)
})

test('rolling capture uses a dedicated bounded audio-file drag preview', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const packageSource = await readFile(join(process.cwd(), 'package.json'), 'utf8')
  const icon1x = await readFile(join(process.cwd(), 'resources', 'drag', 'audio-clip.png'))
  const icon2x = await readFile(join(process.cwd(), 'resources', 'drag', 'audio-clip@2x.png'))
  const packageJson = JSON.parse(packageSource) as {
    build: {
      extraResources: Array<{ from: string; to: string }>
    }
  }

  const pngDimensions = (buffer: Buffer): [number, number] => {
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
  }

  assert.deepEqual(pngDimensions(icon1x), [32, 32])
  assert.deepEqual(pngDimensions(icon2x), [64, 64])
  assert.match(mainSource, /const AUDIO_CLIP_DRAG_ICON_FILENAME = 'audio-clip\.png'/)
  assert.match(mainSource, /const AUDIO_CLIP_DRAG_ICON_SIZE = 32/)
  assert.match(mainSource, /function getAudioClipDragIconPath\(\)/)
  assert.match(mainSource, /const iconPath = getAudioClipDragIconPath\(\)/)
  assert.match(mainSource, /icon\.resize\(\{[\s\S]*width: AUDIO_CLIP_DRAG_ICON_SIZE,[\s\S]*height: AUDIO_CLIP_DRAG_ICON_SIZE/)
  assert.doesNotMatch(mainSource, /function getAudioClipDragIcon\(\) \{\s*const iconPath = getStaticAppIconPath\(\)/)
  assert.match(mainSource, /event\.sender\.startDrag\(\{\s*file: filePath,\s*icon: getAudioClipDragIcon\(\),\s*\}\)/)
  assert.ok(packageJson.build.extraResources.some((entry) => {
    return entry.from === 'resources/drag/' && entry.to === 'drag/'
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
      supportsBlurredBackground: false,
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
      supportsBlurredBackground: false,
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
      supportsBlurredBackground: false,
    },
  )
})

test('resolveWindowCapabilities uses native drag regions on macOS while preserving geometry controls', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'darwin',
      argv: [],
      env: {},
    }),
    {
      displayServer: 'other',
      useNativeDragRegions: true,
      supportsProgrammaticReposition: true,
      supportsGeometryPersistence: true,
      supportsBlurredBackground: true,
    },
  )
})

test('resolveWindowCapabilities uses native drag regions on Windows while preserving geometry controls', () => {
  assert.deepEqual(
    resolveWindowCapabilities({
      platform: 'win32',
      argv: [],
      env: {},
    }),
    {
      displayServer: 'other',
      useNativeDragRegions: true,
      supportsProgrammaticReposition: true,
      supportsGeometryPersistence: true,
      supportsBlurredBackground: false,
    },
  )
})

test('resolveWindowCapabilities gates blurred backgrounds on the Windows 11 22H2 build', () => {
  const resolveForBuild = (osVersion?: string) => resolveWindowCapabilities({
    platform: 'win32',
    argv: [],
    env: {},
    osVersion,
  }).supportsBlurredBackground

  assert.equal(resolveForBuild('10.0.22621'), true)
  assert.equal(resolveForBuild('10.0.26200'), true)
  assert.equal(resolveForBuild('10.0.19045'), false)
  assert.equal(resolveForBuild(undefined), false)
  assert.equal(resolveForBuild('not-a-version'), false)
})

test('resolveMacWindowBlurMaterial selects neutral theme-aware macOS materials', () => {
  assert.equal(resolveMacWindowBlurMaterial(true), 'hud')
  assert.equal(resolveMacWindowBlurMaterial(false), 'content')
})

test('Wayland window controls use native drag regions and omit unsupported reposition/geometry paths', async () => {
  const toolbarSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Toolbar.tsx'), 'utf8')
  const appSource = await readFile(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8')
  const bridgeSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'ScopePopoutBridge.tsx'), 'utf8')
  const stripSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Strip.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')

  assert.match(toolbarSource, /WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE/)
  assert.match(toolbarSource, /disabled=\{!supportsProgrammaticReposition\}/)
  assert.match(toolbarSource, /useNativeDragRegions \? 'is-native-drag' : ''/)
  assert.match(appSource, /onMouseDown=\{useNativeDragRegions \? undefined : handleAltDragStart\}/)
  assert.match(bridgeSource, /bounds: supportsGeometryPersistence\s*\?\s*scopePopouts\[kind\]\?\.windowBounds\s*:\s*undefined/)
  assert.match(stripSource, /if \(!supportsGeometryPersistence\) \{\s*popOutScope\(kind\)/)
  assert.match(stylesSource, /\.toolbar\.is-native-drag \{/)
  assert.match(stylesSource, /\.scope-popout__header\.is-native-drag \{/)
})

test('main and detached windows keep frameless Prism chrome while enabling snap-compatible OS window semantics', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const appSource = await readFile(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8')
  const popoutSource = await readFile(join(process.cwd(), 'src', 'renderer', 'popouts', 'ScopePopoutWindow.tsx'), 'utf8')
  const nowPlayingSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'NowPlayingConfigWindow.tsx'), 'utf8')

  assert.match(mainSource, /function getFramelessWindowOptions\([\s\S]*?return \{[\s\S]*?frame: false,[\s\S]*?transparent: background\.mode === 'clear' \|\| transparentOnWindows,[\s\S]*?roundedCorners: false,[\s\S]*?hasShadow: false,[\s\S]*?thickFrame: background\.mode === 'solid',[\s\S]*?backgroundMaterial: 'none'[\s\S]*?resizable: true,[\s\S]*?maximizable: true,[\s\S]*?fullscreenable: true,[\s\S]*?skipTaskbar: false,[\s\S]*?\}/)
  assert.match(mainSource, /process\.platform === 'darwin' && background\.mode === 'blurred'[\s\S]*?vibrancy: resolveMacWindowBlurMaterial\(nativeTheme\.shouldUseDarkColors\),[\s\S]*?visualEffectState: 'active'/)
  assert.match(mainSource, /function applyNativeThemeSnapshot\([\s\S]*?nativeTheme\.themeSource = resolveNativeThemeSource\(activeTheme\)[\s\S]*?refreshMacBlurVibrancy\(\)/)
  assert.match(mainSource, /function refreshMacBlurVibrancy\(\): void \{[\s\S]*?process\.platform !== 'darwin'[\s\S]*?getEffectiveWindowBackground\(\)\.mode !== 'blurred'[\s\S]*?resolveMacWindowBlurMaterial\(nativeTheme\.shouldUseDarkColors\)[\s\S]*?getBackgroundCapableWindows\(\)[\s\S]*?window\.setVibrancy\(material\)/)
  assert.match(mainSource, /function createMainWindow\(restoreBounds\?: WindowBounds\): void \{[\s\S]*?\.\.\.getFramelessWindowOptions\(background\),/)
  assert.match(mainSource, /function createScopePopoutWindow\(kind: ScopeKind, rawBounds\?: WindowBounds\): BrowserWindow \| null \{[\s\S]*?\.\.\.getFramelessWindowOptions\(background\),/)
  assert.match(mainSource, /function createNowPlayingConfigWindow\(\): BrowserWindow \{[\s\S]*?\.\.\.getFramelessWindowOptions\(\),/)
  assert.match(popoutSource, /useWindowManagerDragRegions = getRendererWindowCapabilities\(\)\.useNativeDragRegions/)
  assert.match(nowPlayingSource, /useWindowManagerDragRegions = getRendererWindowCapabilities\(\)\.useNativeDragRegions/)
  // Blurred and clear windows drop the native thick frame on Windows, so the
  // JS resize overlay mounts for both; the now-playing config window always
  // keeps native semantics.
  assert.match(appSource, /windowBackgroundMode !== 'solid' && <WindowResizeOverlay \/>/)
  assert.match(popoutSource, /windowBackgroundMode !== 'solid' && <WindowResizeOverlay \/>/)
  assert.doesNotMatch(nowPlayingSource, /WindowResizeOverlay/)
})

test('detached scope interactions accept the first macOS click and hide chrome during measurement', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const scopeModuleSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'ScopeModule.tsx'), 'utf8')
  const popoutSource = await readFile(join(process.cwd(), 'src', 'renderer', 'popouts', 'ScopePopoutWindow.tsx'), 'utf8')
  const stylesSource = await readFile(join(process.cwd(), 'src', 'renderer', 'styles', 'globals.css'), 'utf8')
  const mainWindowFactorySource = mainSource.slice(
    mainSource.indexOf('function createMainWindow'),
    mainSource.indexOf('function createScopePopoutWindow'),
  )

  assert.match(mainSource, /function createScopePopoutWindow\([\s\S]*?process\.platform === 'darwin' \? \{ acceptFirstMouse: true \} : \{\}/)
  assert.doesNotMatch(mainWindowFactorySource, /acceptFirstMouse/)
  assert.match(scopeModuleSource, /onMeasurementActiveChange\?: \(active: boolean\) => void/)
  assert.match(scopeModuleSource, /onActiveChange: onMeasurementActiveChange/)
  assert.match(popoutSource, /measurementActive \? 'is-measuring' : ''/)
  assert.match(popoutSource, /onMeasurementActiveChange=\{setMeasurementActive\}/)
  assert.match(stylesSource, /\.scope-popout__chrome:has\(:focus-visible\)/)
  assert.doesNotMatch(stylesSource, /\.scope-popout__chrome:focus-within/)
  assert.match(stylesSource, /\.scope-popout__viewport \.scope-popout__chrome\.is-measuring \{[\s\S]*?max-height: 0;[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;[\s\S]*?transform: translateY\(-8px\);[\s\S]*?\}/)
})

test('main window hides its toolbar while a docked scope measurement is active', async () => {
  const appSource = await readFile(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8')
  const stripSource = await readFile(join(process.cwd(), 'src', 'renderer', 'components', 'Strip.tsx'), 'utf8')

  assert.match(stripSource, /onMeasurementActiveChange\?: \(active: boolean\) => void/)
  assert.match(stripSource, /onMeasurementActiveChange=\{onMeasurementActiveChange\}/)
  assert.match(appSource, /const \[measurementActive, setMeasurementActive\] = useState\(false\)/)
  assert.match(appSource, /toolbarVisible && !measurementActive \? 'is-visible' : ''/)
  assert.match(appSource, /<Strip onMeasurementActiveChange=\{setMeasurementActive\} \/>/)
})

test('programmatic top/bottom reposition flushes fresh bounds through persistence channels', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')

  assert.match(mainSource, /function sendMainWindowBoundsChanged\(window: BrowserWindow\): void \{[\s\S]*?window\.webContents\.send\('window:bounds-changed', toLogicalBounds\(window\)\)[\s\S]*?\}/)
  assert.match(mainSource, /function flushMainWindowBoundsChanged\(window: BrowserWindow\): void \{[\s\S]*?clearPendingMainWindowBoundsSave\(\)[\s\S]*?sendMainWindowBoundsChanged\(window\)[\s\S]*?\}/)
  assert.match(mainSource, /function sendScopePopoutBoundsChanged\(kind: ScopeKind, window: BrowserWindow\): void \{[\s\S]*?mainWindow\.webContents\.send\('scope-popout:bounds-changed', kind, toLogicalBounds\(window\)\)[\s\S]*?\}/)
  assert.match(mainSource, /function flushScopePopoutBoundsChanged\(kind: ScopeKind, window: BrowserWindow\): void \{[\s\S]*?popoutBoundsTimers\.delete\(kind\)[\s\S]*?suppressNextPopoutBoundsEvents\.delete\(kind\)[\s\S]*?sendScopePopoutBoundsChanged\(kind, window\)[\s\S]*?\}/)
  assert.match(mainSource, /applyLogicalBounds\(targetWindow, \{[\s\S]*?height: logicalBounds\.height,[\s\S]*?\}\)\s*flushRepositionedWindowBounds\(targetWindow\)\s*return/)
  assert.match(mainSource, /targetWindow\.setSize\(workArea\.width, height\)\s*flushRepositionedWindowBounds\(targetWindow\)/)
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

test('resolveMainWindowSettingsPanelHeight uses intrinsic scope-track height when the panel is stretched', () => {
  const globalWithStyle = globalThis as typeof globalThis & {
    getComputedStyle?: (element: Element) => CSSStyleDeclaration
  }
  const previousGetComputedStyle = globalWithStyle.getComputedStyle

  globalWithStyle.getComputedStyle = () => ({
    paddingTop: '10px',
    paddingBottom: '4px',
  }) as CSSStyleDeclaration

  try {
    const stretchedPanel = { scrollHeight: 640 } as HTMLElement
    const collapsedScopeTrack = { scrollHeight: 220.25 } as HTMLElement

    assert.equal(resolveMainWindowSettingsPanelHeight(stretchedPanel, collapsedScopeTrack), 235)
    assert.equal(resolveMainWindowSettingsPanelHeight(stretchedPanel, null), 640)
  } finally {
    if (previousGetComputedStyle) {
      globalWithStyle.getComputedStyle = previousGetComputedStyle
    } else {
      delete globalWithStyle.getComputedStyle
    }
  }
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

test('restored window bounds clamp back to a visible display margin', () => {
  const clamped = clampRestoredWindowBounds(
    { x: 1800, y: 1400, width: 420, height: 240 },
    [{ x: 0, y: 0, width: 800, height: 600 }],
    64,
  )

  assert.equal(clamped.x, 736)
  assert.equal(clamped.y, 536)
  assert.equal(clamped.width, 420)
  assert.equal(clamped.height, 240)
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
  const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  profile.windowBounds = { x: 10, y: 20, width: 900, height: 180 }
  const dirtyBounds = { x: 44, y: 55, width: 900, height: 180 }
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    }),
    getWindowBounds: async () => dirtyBounds,
    setWindowBounds: (bounds: WindowBounds) => {
      restoredBounds.push(bounds)
    },
  })

  try {
    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    const rawStored = fakeStorage.getItem('prism:settings')
    assert.ok(rawStored)
    const stored = JSON.parse(rawStored) as Record<string, unknown>
    fakeStorage.setItem('prism:settings', JSON.stringify({
      ...stored,
      windowBounds: dirtyBounds,
    }))
    restoredBounds.length = 0
    useSettingsStore.setState(previousSettingsState)

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

test('initializeProfiles migrates legacy spectrogram working state without discarding it', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  profile.scopeSettings.spectrogram.rotation = 90
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: { [DEFAULT_PROFILE_ID]: profile },
    }),
    getWindowBounds: async () => null,
  })

  try {
    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: { [DEFAULT_PROFILE_ID]: profile },
    })
    const rawStored = fakeStorage.getItem('prism:settings')
    assert.ok(rawStored)
    const stored = JSON.parse(rawStored) as Record<string, unknown>
    const signature = JSON.parse(stored.profileBaselineSignature as string) as Record<string, unknown>
    const signatureSettings = signature.scopeSettings as Record<string, Record<string, unknown>>
    const workingSettings = stored.scopeSettings as Record<string, Record<string, unknown>>

    delete signatureSettings.spectrogram.rotation
    delete signatureSettings.spectrogram.mirrorHorizontal
    signatureSettings.spectrogram.orientation = 'vertical'
    delete workingSettings.spectrogram.rotation
    delete workingSettings.spectrogram.mirrorHorizontal
    workingSettings.spectrogram.orientation = 'horizontal'
    fakeStorage.setItem('prism:settings', JSON.stringify({
      ...stored,
      profileBaselineSignature: JSON.stringify(signature),
      scopeSettings: workingSettings,
    }))
    useSettingsStore.setState(previousSettingsState)

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.savedProfileBaseline?.scopeSettings.spectrogram.rotation, 90)
    assert.equal(state.scopeSettings.spectrogram.rotation, 0)
    assert.equal(state.scopeSettings.spectrogram.mirrorHorizontal, false)
    assert.equal(state.hasUnsavedProfileChanges, true)
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

test('initializeProfiles ignores legacy persisted inline popouts and restores active profile popouts', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const savedPopoutBounds = { x: 140, y: 60, width: 420, height: 240 }
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => {
      const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
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
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    const staleProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
    staleProfile.scopePopouts.spectrum = {
      poppedOut: false,
      windowBounds: savedPopoutBounds,
    }
    fakeStorage.setItem('prism:settings', JSON.stringify({
      scopeOrder: staleProfile.scopeOrder,
      hiddenScopes: staleProfile.hiddenScopes,
      widthWeights: staleProfile.widthWeights,
      scopeSettings: staleProfile.scopeSettings,
      scopePopouts: staleProfile.scopePopouts,
    }))

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.scopePopouts.spectrum.poppedOut, true)
    assert.deepEqual(state.scopePopouts.spectrum.windowBounds, savedPopoutBounds)
    assert.equal(state.hasUnsavedProfileChanges, false)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('initializeProfiles restores saved popout open state while preserving matching dirty draft values', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const savedPopoutBounds = { x: 140, y: 60, width: 420, height: 240 }
  const dirtyPopoutBounds = { x: 180, y: 72, width: 440, height: 260 }
  const profile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  profile.scopePopouts.spectrum = {
    poppedOut: true,
    windowBounds: savedPopoutBounds,
  }
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    }),
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: profile,
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    const rawStored = fakeStorage.getItem('prism:settings')
    assert.ok(rawStored)
    const stored = JSON.parse(rawStored) as {
      activeProfileId?: string | null
      profileBaselineSignature?: string
      scopePopouts: ScopePopoutStateMap
    }
    assert.equal(stored.activeProfileId, DEFAULT_PROFILE_ID)
    assert.equal(typeof stored.profileBaselineSignature, 'string')

    fakeStorage.setItem('prism:settings', JSON.stringify({
      ...stored,
      scopeSettings: {
        ...profile.scopeSettings,
        spectrum: {
          ...profile.scopeSettings.spectrum,
          smoothing: 0.42,
        },
      },
      scopePopouts: {
        ...stored.scopePopouts,
        spectrum: {
          poppedOut: false,
          windowBounds: dirtyPopoutBounds,
        },
      },
    }))
    useSettingsStore.setState(previousSettingsState)

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.scopePopouts.spectrum.poppedOut, true)
    assert.deepEqual(state.scopePopouts.spectrum.windowBounds, dirtyPopoutBounds)
    assert.equal(state.scopeSettings.spectrum.smoothing, 0.42)
    assert.equal(state.hasUnsavedProfileChanges, true)
  } finally {
    useSettingsStore.setState(previousSettingsState)
    fakeWindow.restore()
    fakeStorage.restore()
  }
})

test('initializeProfiles discards persisted popout state when the saved profile baseline changed', async () => {
  const previousSettingsState = useSettingsStore.getState()
  const fakeStorage = installFakeLocalStorage()
  const savedPopoutBounds = { x: 140, y: 60, width: 420, height: 240 }
  const originalProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  const changedProfile = createDefaultProfile(DEFAULT_PROFILE_NAME)
  changedProfile.scopePopouts.spectrum = {
    poppedOut: true,
    windowBounds: savedPopoutBounds,
  }
  let snapshotProfile = originalProfile
  const fakeWindow = installFakeElectronWindow({
    getProfileSnapshot: async () => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: snapshotProfile,
      },
    }),
    getWindowBounds: async () => ({ x: 10, y: 20, width: 900, height: 180 }),
    setWindowBounds: () => {},
  })

  try {
    useSettingsStore.getState().applyExternalProfileSnapshot({
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: originalProfile,
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    const rawStored = fakeStorage.getItem('prism:settings')
    assert.ok(rawStored)
    const stored = JSON.parse(rawStored) as {
      scopePopouts: ScopePopoutStateMap
    }
    fakeStorage.setItem('prism:settings', JSON.stringify({
      ...stored,
      scopePopouts: {
        ...stored.scopePopouts,
        spectrum: {
          poppedOut: false,
          windowBounds: { x: 180, y: 72, width: 440, height: 260 },
        },
      },
    }))
    snapshotProfile = changedProfile
    useSettingsStore.setState(previousSettingsState)

    await useSettingsStore.getState().initializeProfiles()

    const state = useSettingsStore.getState()
    assert.equal(state.scopePopouts.spectrum.poppedOut, true)
    assert.deepEqual(state.scopePopouts.spectrum.windowBounds, savedPopoutBounds)
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

test('VUMeterBallistics keeps RMS finite across loud-then-silent sequences (NaN-drift regression)', () => {
  const sampleRate = 48000
  const meter = new VUMeterBallistics(sampleRate)
  const windowSamples = Math.round((sampleRate * VU_INTEGRATION_WINDOW_MS) / 1000)

  // Run loud audio long enough to fully populate the sliding-window buffer.
  meter.process([createFilledStereoChunk(0.7, 0.7, windowSamples * 2)], 100)

  // Then feed many windows of digital silence. Floating-point cancellation in
  // the running-sum slide-out used to drift sumSqL/sumSqR slightly below zero,
  // producing NaN through Math.sqrt. After the fix, the RMS must remain finite
  // and decay all the way to VU_METER_MIN_DB.
  let nowMs = 100
  for (let i = 0; i < 20; i += 1) {
    nowMs += 50
    meter.process([createFilledStereoChunk(0, 0, windowSamples)], nowMs)
  }

  const snapshot = meter.getSnapshot()
  assert.ok(Number.isFinite(snapshot.vuLDb), 'left VU must stay finite (no NaN)')
  assert.ok(Number.isFinite(snapshot.vuRDb), 'right VU must stay finite (no NaN)')
  assert.equal(snapshot.vuLDb, VU_METER_MIN_DB)
  assert.equal(snapshot.vuRDb, VU_METER_MIN_DB)
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

function createFakeWaveformNativeAnalyzer(options: {
  available?: boolean
  monoSummary?: Float32Array
  stereoSummary?: Float32Array
} = {}): WaveformNativeAnalyzer & {
  configs: Array<{ sampleRate: number; samplesPerColumn: number }>
  monoPushes: Float32Array[]
  stereoPushes: Array<{ left: Float32Array; right: Float32Array }>
  resetCount: number
} {
  return {
    configs: [],
    monoPushes: [],
    stereoPushes: [],
    resetCount: 0,
    isAvailable: () => options.available ?? true,
    configure(sampleRate, samplesPerColumn) {
      this.configs.push({ sampleRate, samplesPerColumn })
    },
    processMono(samples) {
      this.monoPushes.push(samples)
      return options.monoSummary ?? new Float32Array(0)
    },
    processStereo(left, right) {
      this.stereoPushes.push({ left, right })
      return options.stereoSummary ?? new Float32Array(0)
    },
    reset() {
      this.resetCount += 1
    },
  }
}

function createFakeVectorscopeNativeAnalyzer(options: {
  multibandAvailable?: boolean
  multibandData?: Float32Array
  multibandCount?: number
} = {}): VectorscopeNativeAnalyzer & {
  sampleRates: number[]
  multibandPushes: Array<{ left: Float32Array; right: Float32Array }>
  multibandRequests: number[]
  resetCount: number
} {
  const analyzer: VectorscopeNativeAnalyzer & {
    sampleRates: number[]
    multibandPushes: Array<{ left: Float32Array; right: Float32Array }>
    multibandRequests: number[]
    resetCount: number
  } = {
    sampleRates: [],
    multibandPushes: [],
    multibandRequests: [],
    resetCount: 0,
    isAvailable: () => true,
    isMultibandAvailable: () => options.multibandAvailable ?? true,
    setSampleRate(sampleRate) {
      this.sampleRates.push(sampleRate)
    },
    pushSamples() {},
    fillPoints() {
      return 0
    },
    reset() {
      this.resetCount += 1
    },
  }

  if (options.multibandAvailable !== false) {
    analyzer.pushMultibandSamples = (left, right) => {
      analyzer.multibandPushes.push({ left, right })
    }
    analyzer.getMultibandPoints = (maxPoints) => {
      analyzer.multibandRequests.push(maxPoints)
      const data = options.multibandData ?? new Float32Array(0)
      return {
        data,
        count: options.multibandCount ?? Math.floor(data.length / 6),
      }
    }
  }

  return analyzer
}

test('Waveform uses native multiband column summaries when available', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const nativeAnalyzer = createFakeWaveformNativeAnalyzer({
    monoSummary: new Float32Array([-0.5, 0.5, 1, 0, 0]),
  })
  const dataSource = {
    getPendingWaveformSamples: () => [new Float32Array([0.25])],
    getPendingWaveformStereoSamples: () => [],
    getSampleRate: () => 64,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const waveform = new Waveform(createFakeCanvas(recorder), {
    dataSource,
    multiband: true,
    nativeAnalyzer,
    bandColors: {
      low: '#ff0000',
      mid: '#00ff00',
      high: '#0000ff',
    },
  })

  try {
    ;(waveform as unknown as { drawFrame: () => void }).drawFrame()
    assert.equal(nativeAnalyzer.monoPushes.length, 1)
    assert.equal(nativeAnalyzer.configs.at(-1)?.samplesPerColumn, 1)
    assert.equal(
      recorder.fillRects.some((rect) => rect.fillStyle === 'rgba(235, 20, 0, 0.72)'),
      true,
    )
  } finally {
    waveform.dispose()
    dom.restore()
  }
})

test('Waveform falls back to JavaScript multiband when native is unavailable', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const nativeAnalyzer = createFakeWaveformNativeAnalyzer({ available: false })
  const dataSource = {
    getPendingWaveformSamples: () => [new Float32Array([0.75])],
    getPendingWaveformStereoSamples: () => [],
    getSampleRate: () => 64,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const waveform = new Waveform(createFakeCanvas(recorder), {
    dataSource,
    multiband: true,
    nativeAnalyzer,
  })

  try {
    ;(waveform as unknown as { drawFrame: () => void }).drawFrame()
    assert.equal(nativeAnalyzer.monoPushes.length, 0)
    assert.equal(recorder.fillRects.some((rect) => rect.width === 1), true)
  } finally {
    waveform.dispose()
    dom.restore()
  }
})

test('Waveform reconfigures and resets native multiband state on option changes', () => {
  const dom = installFakeCanvasDom()
  const nativeAnalyzer = createFakeWaveformNativeAnalyzer()
  const dataSource = {
    getPendingWaveformSamples: () => [],
    getPendingWaveformStereoSamples: () => [],
    getSampleRate: () => 128,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const waveform = new Waveform(createFakeCanvas(), {
    dataSource,
    multiband: true,
    nativeAnalyzer,
  })

  try {
    nativeAnalyzer.configs.length = 0
    nativeAnalyzer.resetCount = 0
    waveform.setOptions({ scrollSpeed: 2 })
    assert.equal(nativeAnalyzer.configs.at(-1)?.samplesPerColumn, 1)
    assert.equal(nativeAnalyzer.resetCount > 0, true)

    waveform.setOptions({ multiband: false })
    assert.equal(nativeAnalyzer.resetCount > 1, true)
  } finally {
    waveform.dispose()
    dom.restore()
  }
})

test('Waveform maps x4 to the old max scroll rate and x8 to faster headroom', () => {
  const dom = installFakeCanvasDom()
  const nativeAnalyzer = createFakeWaveformNativeAnalyzer()
  const dataSource = {
    getPendingWaveformSamples: () => [],
    getPendingWaveformStereoSamples: () => [],
    getSampleRate: () => 4096,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const waveform = new Waveform(createFakeCanvas(), {
    dataSource,
    nativeAnalyzer,
    scrollSpeed: 4,
  })

  try {
    assert.equal(nativeAnalyzer.configs.at(-1)?.samplesPerColumn, 8)

    nativeAnalyzer.configs.length = 0
    waveform.setOptions({ scrollSpeed: 8 })
    assert.equal(nativeAnalyzer.configs.at(-1)?.samplesPerColumn, 4)
  } finally {
    waveform.dispose()
    dom.restore()
  }
})

test('Vectorscope multiband uses native interleaved band points when available', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const nativeAnalyzer = createFakeVectorscopeNativeAnalyzer({
    multibandData: new Float32Array([0.1, 0.2, 0.2, 0.1, -0.1, 0.15]),
    multibandCount: 1,
  })
  const dataSource = {
    getPendingVectorscopeSamples: () => [{ left: new Float32Array([0.2]), right: new Float32Array([0.1]) }],
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(recorder), {
    dataSource,
    multiband: true,
    showGrid: false,
    displayPoints: 1,
    nativeAnalyzer,
    bandColors: {
      low: '#110000',
      mid: '#001100',
      high: '#000011',
    },
  })

  try {
    ;(vectorscope as unknown as { drawFrame: () => void }).drawFrame()
    assert.equal(nativeAnalyzer.multibandPushes.length, 1)
    assert.deepEqual(nativeAnalyzer.multibandRequests, [1])
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#110000'), true)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#001100'), true)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#000011'), true)
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
})

test('Vectorscope multiband falls back to JavaScript splitter when native multiband is missing', () => {
  const recorder = createFakeCanvasRecorder()
  const dom = installFakeCanvasDom(() => createFakeCanvas(recorder))
  const nativeAnalyzer = createFakeVectorscopeNativeAnalyzer({ multibandAvailable: false })
  const dataSource = {
    getPendingVectorscopeSamples: () => [createSineStereoChunk(440, 48000, 8)],
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const vectorscope = new Vectorscope(createFakeCanvas(recorder), {
    dataSource,
    multiband: true,
    showGrid: false,
    displayPoints: 8,
    nativeAnalyzer,
    bandColors: {
      low: '#210000',
      mid: '#002100',
      high: '#000021',
    },
  })

  try {
    ;(vectorscope as unknown as { drawFrame: () => void }).drawFrame()
    assert.equal(nativeAnalyzer.multibandPushes.length, 0)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#210000'), true)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#002100'), true)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === '#000021'), true)
  } finally {
    vectorscope.dispose()
    dom.restore()
  }
})

function createFakeVUMeterNativeAnalyzer(
  snapshotOverrides: Partial<VUMeterNativeSnapshot> = {},
  available = true,
): VUMeterNativeAnalyzer & {
  pushed: Array<{ left: Float32Array; right: Float32Array }>
  resetCount: number
  sampleRates: number[]
} {
  const analyzer = {
    pushed: [] as Array<{ left: Float32Array; right: Float32Array }>,
    resetCount: 0,
    sampleRates: [] as number[],
    snapshot: {
      vuLDb: -12,
      vuRDb: -13,
      barLDb: -10,
      barRDb: -12,
      peakLDb: -4,
      peakRDb: -5,
      correlation: 0.5,
      ...snapshotOverrides,
    } satisfies VUMeterNativeSnapshot,
    isAvailable: () => available,
    setSampleRate(sampleRate: number): void {
      this.sampleRates.push(sampleRate)
    },
    pushSamples(left: Float32Array, right: Float32Array): void {
      this.pushed.push({ left: new Float32Array(left), right: new Float32Array(right) })
    },
    getSnapshot(): VUMeterNativeSnapshot {
      return this.snapshot
    },
    reset(): void {
      this.resetCount += 1
    },
  }

  return analyzer
}

test('VUMeter draws from native DSP snapshots when available', () => {
  const recorder = createFakeCanvasRecorder()
  const dataSource = {
    getPendingVUMeterSamples: () => [],
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeVUMeterNativeAnalyzer({
    vuLDb: -12.4,
    vuRDb: -16.2,
    peakLDb: -3,
    peakRDb: -5,
    correlation: 0.25,
  })
  const meter = new VUMeter(createFakeCanvas(recorder), {
    dataSource,
    nativeAnalyzer,
    lineColor: 'rgb(255, 0, 96)',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    assert.equal(nativeAnalyzer.pushed.length, 0)
    assert.equal(recorder.fillTexts.some((text) => text.text === '-12.4'), true)
    assert.equal(recorder.fillTexts.some((text) => text.text === '-16.2'), true)
    assert.equal(
      recorder.fillRects.some((rect) => rect.fillStyle === 'rgba(255, 0, 96, 0.82)'),
      true,
    )
  } finally {
    meter.dispose()
  }
})

test('VUMeter concatenates queued chunks before pushing them to native DSP', () => {
  const chunkQueue: Array<{ left: Float32Array; right: Float32Array }> = [
    {
      left: new Float32Array([1, 2, 3]),
      right: new Float32Array([4, 5, 6]),
    },
    {
      left: new Float32Array([7, 8]),
      right: new Float32Array([9, 10]),
    },
  ]
  const dataSource = {
    getPendingVUMeterSamples: () => {
      const drained = chunkQueue.slice()
      chunkQueue.length = 0
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeVUMeterNativeAnalyzer()
  const meter = new VUMeter(createFakeCanvas(), { dataSource, nativeAnalyzer })

  try {
    ;(meter as unknown as { processAudio: () => void }).processAudio()

    assert.equal(nativeAnalyzer.pushed.length, 1)
    assert.deepEqual(Array.from(nativeAnalyzer.pushed[0]?.left ?? []), [1, 2, 3, 7, 8])
    assert.deepEqual(Array.from(nativeAnalyzer.pushed[0]?.right ?? []), [4, 5, 6, 9, 10])
  } finally {
    meter.dispose()
  }
})

test('VUMeter resets native DSP when the sample rate or session changes', () => {
  let sampleRate = 48000
  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: new Float32Array([0.1]), right: new Float32Array([0.2]) },
  ]
  let sessionListener: (() => void) | null = null
  const dataSource = {
    getPendingVUMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: (listener: () => void) => {
      sessionListener = listener
      return () => {}
    },
  }
  const nativeAnalyzer = createFakeVUMeterNativeAnalyzer()
  const meter = new VUMeter(createFakeCanvas(), { dataSource, nativeAnalyzer })
  const processAudio = (meter as unknown as { processAudio: () => void }).processAudio.bind(meter)

  try {
    processAudio()
    sampleRate = 96000
    pendingChunks = [{ left: new Float32Array([0.3]), right: new Float32Array([0.4]) }]
    processAudio()
    sessionListener?.()

    assert.deepEqual(nativeAnalyzer.sampleRates, [48000, 96000, 96000])
    assert.equal(nativeAnalyzer.resetCount, 3)
  } finally {
    meter.dispose()
  }
})

test('VUMeter drains audio and renders fallback state when native DSP is unavailable', () => {
  const recorder = createFakeCanvasRecorder()
  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: new Float32Array([0.5, 0.5, 0.5, 0.5]), right: new Float32Array([0.5, 0.5, 0.5, 0.5]) },
  ]
  const dataSource = {
    getPendingVUMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeVUMeterNativeAnalyzer({ vuLDb: -1, vuRDb: -1 }, false)
  const meter = new VUMeter(createFakeCanvas(recorder), {
    dataSource,
    nativeAnalyzer,
    lineColor: 'rgb(255, 0, 96)',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    assert.equal(nativeAnalyzer.pushed.length, 0)
    assert.equal(pendingChunks.length, 0)
    assert.equal(recorder.fillTexts.some((text) => text.text === '-6.0'), true)
  } finally {
    meter.dispose()
  }
})

function createFakeLUFSMeterNativeAnalyzer(
  snapshotOverrides: Partial<LUFSMeterNativeSnapshot> = {},
  available = true,
): LUFSMeterNativeAnalyzer & {
  pushed: Array<{ left: Float32Array; right: Float32Array }>
  resetCount: number
  sampleRates: number[]
} {
  const analyzer = {
    pushed: [] as Array<{ left: Float32Array; right: Float32Array }>,
    resetCount: 0,
    sampleRates: [] as number[],
    snapshot: {
      momentaryLUFS: -18.4,
      shortTermLUFS: -19.1,
      integratedLUFS: -20.2,
      vuLDb: -12,
      vuRDb: -13,
      barLDb: -10,
      barRDb: -12,
      truePeakLDb: -4,
      truePeakRDb: -5,
      maxTruePeakDb: -4,
      correlation: 0.5,
      ...snapshotOverrides,
    } satisfies LUFSMeterNativeSnapshot,
    isAvailable: () => available,
    setSampleRate(sampleRate: number): void {
      this.sampleRates.push(sampleRate)
    },
    pushSamples(left: Float32Array, right: Float32Array): void {
      this.pushed.push({ left: new Float32Array(left), right: new Float32Array(right) })
    },
    getSnapshot(): LUFSMeterNativeSnapshot {
      return this.snapshot
    },
    reset(): void {
      this.resetCount += 1
    },
  }

  return analyzer
}

test('LUFSMeter formats positive, negative, compact, and reset true-peak maxima', () => {
  assert.equal(formatMaxTruePeakDb(3), 'MAX TP +3.0 dBTP')
  assert.equal(formatMaxTruePeakDb(-4.25), 'MAX TP −4.3 dBTP')
  assert.equal(formatMaxTruePeakDb(3, true), '+3.0dBTP')
  assert.equal(formatMaxTruePeakDb(-60), 'MAX TP −∞ dBTP')
  assert.equal(formatMaxTruePeakDb(Number.NaN, true), '−∞dBTP')
})

test('loudness bridge decodes true-peak fields and accumulates legacy peak maxima', () => {
  const current = decodeLUFSMeterFrame({
    sampleRate: 96000,
    truePeakLDb: 1.25,
    truePeakRDb: -2,
    maxTruePeakDb: 2.5,
  })
  assert.ok(current)
  assert.equal(current.sampleRate, 96000)
  assert.equal(current.truePeakLDb, 1.25)
  assert.equal(current.truePeakRDb, -2)
  assert.equal(current.maxTruePeakDb, 2.5)

  const firstLegacy = decodeLUFSMeterFrame({ peakLDb: -3, peakRDb: -5 }, -60)
  assert.ok(firstLegacy)
  assert.equal(firstLegacy.truePeakLDb, -3)
  assert.equal(firstLegacy.truePeakRDb, -5)
  assert.equal(firstLegacy.maxTruePeakDb, -3)

  const quieterLegacy = decodeLUFSMeterFrame({ peakLDb: -9, peakRDb: -7 }, firstLegacy.maxTruePeakDb)
  assert.equal(quieterLegacy?.maxTruePeakDb, -3)

  const explicitReset = decodeLUFSMeterFrame({
    truePeakLDb: -60,
    truePeakRDb: -60,
    maxTruePeakDb: -60,
  }, 2.5)
  assert.equal(explicitReset?.maxTruePeakDb, -60)
})

test('LUFSMeter draws fast bars, true-peak markers, LUFS readout, and maximum dBTP footer', () => {
  const dom = installFakeCanvasDom()
  const recorder = createFakeCanvasRecorder()
  const leftChunk = new Float32Array(4800)
  const rightChunk = new Float32Array(4800)
  for (let index = 0; index < leftChunk.length; index += 1) {
    const sample = index % 2 === 0 ? 0.55 : -0.55
    leftChunk[index] = sample
    rightChunk[index] = sample * 0.75
  }

  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: leftChunk, right: rightChunk },
  ]
  const dataSource = {
    getPendingLUFSMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer({
    momentaryLUFS: -18.4,
    truePeakLDb: 3,
    truePeakRDb: -5,
    maxTruePeakDb: 3,
  })
  const meter = new LUFSMeter(createFakeCanvas(recorder), {
    dataSource,
    nativeAnalyzer,
    readout: 'momentary',
    lineColor: 'rgb(255, 0, 96)',
    trackColor: 'rgba(255, 0, 96, 0.08)',
    targetColor: 'rgb(1, 2, 3)',
    scaleColor: 'rgb(4, 5, 6)',
    labelColor: 'rgb(7, 8, 9)',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    assert.equal(nativeAnalyzer.pushed.length, 1)
    assert.equal(nativeAnalyzer.pushed[0]?.left.length, leftChunk.length)
    const trackRects = recorder.fillRects.filter((rect) => rect.fillStyle === 'rgba(255, 0, 96, 0.08)')
    assert.equal(trackRects.length >= 3, true)
    assert.equal(trackRects.some((rect) => rect.width > 12), true)
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === 'rgba(255, 0, 96, 0.88)'), true)
    assert.equal(
      recorder.fillRects.some((rect) => rect.fillStyle === 'rgb(255, 0, 96)' && rect.width > 12 && rect.width < 80),
      true,
    )
    // Readout tag pill: drawn with line color, fits to text width with padding,
    // and uses the compact tag height. Sized smaller than the LUFS level bar.
    assert.equal(
      recorder.fillRects.some((rect) =>
        rect.fillStyle === 'rgb(255, 0, 96)'
        && rect.width >= 40
        && rect.width <= 100
        && rect.height >= 14
        && rect.height <= 24,
      ),
      true,
    )
    assert.equal(recorder.fillRects.some((rect) => rect.fillStyle === 'rgb(1, 2, 3)'), true)

    for (const scaleLabel of ['0', '6', '12', '24', '36', '50']) {
      assert.equal(
        recorder.fillTexts.some((text) => text.text === scaleLabel && text.fillStyle === 'rgb(4, 5, 6)'),
        true,
      )
    }
    assert.equal(
      recorder.fillTexts.some((text) => text.text.endsWith('LUFS') && text.fillStyle === 'rgba(0, 0, 0, 0.9)'),
      true,
    )
    assert.equal(
      recorder.fillTexts.some((text) => text.text === 'MAX TP +3.0 dBTP' && text.fillStyle === 'rgb(7, 8, 9)'),
      true,
    )
  } finally {
    meter.dispose()
    dom.restore()
  }
})

test('LUFSMeter fits readout text inside narrow tags', () => {
  const dom = installFakeCanvasDom()
  const recorder = createFakeCanvasRecorder()
  const leftChunk = new Float32Array(4800)
  const rightChunk = new Float32Array(4800)
  leftChunk.fill(0.55)
  rightChunk.fill(0.55)

  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: leftChunk, right: rightChunk },
  ]
  const dataSource = {
    getPendingLUFSMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer({ momentaryLUFS: -8.1, maxTruePeakDb: 3 })
  const meter = new LUFSMeter(createFakeCanvas(recorder, 180, 360), {
    dataSource,
    nativeAnalyzer,
    readout: 'momentary',
    lineColor: 'rgb(255, 0, 96)',
    trackColor: 'rgba(255, 0, 96, 0.08)',
    targetColor: 'rgb(1, 2, 3)',
    scaleColor: 'rgb(4, 5, 6)',
    labelColor: 'rgb(7, 8, 9)',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    const tagRect = recorder.fillRects.find((rect) => (
      rect.fillStyle === 'rgb(255, 0, 96)' && rect.width > 50 && rect.height <= 34
    ))
    const readout = recorder.fillTexts.find((text) => text.text.endsWith('LUFS'))
    assert.ok(tagRect)
    assert.ok(readout)

    const fontSize = Number(readout.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    const estimatedTextWidth = readout.text.length * fontSize * 0.62
    assert.equal(estimatedTextWidth <= tagRect.width - 8, true)
    assert.equal(recorder.fillTexts.some((text) => text.text === 'MAX TP +3.0 dBTP'), true)
  } finally {
    meter.dispose()
    dom.restore()
  }
})

test('LUFSMeter centers wide layouts in a bounded viewport', () => {
  const dom = installFakeCanvasDom()
  const recorder = createFakeCanvasRecorder()
  const canvas = createFakeCssSizedCanvas(recorder, 522, 196)
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer({ shortTermLUFS: -8.7 })
  const meter = new LUFSMeter(canvas, {
    dataSource: {
      getPendingLUFSMeterSamples: () => [],
      getSampleRate: () => 48000,
      isPlaying: () => true,
      subscribeToSessionChanges: () => () => {},
    },
    nativeAnalyzer,
    lineColor: '#123456',
    trackColor: '#111111',
    targetColor: '#222222',
    scaleColor: '#333333',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    const tracks = recorder.fillRects.filter((rect) => rect.fillStyle === '#111111')
    const target = recorder.fillRects.find((rect) => rect.fillStyle === '#222222')
    const tag = recorder.fillRects.find((rect) => rect.fillStyle === '#123456' && rect.height <= 22)
    const readout = recorder.fillTexts.find((text) => text.text.endsWith('LUFS'))
    const viewportLeft = (canvas.width - 240) / 2
    const viewportRight = viewportLeft + 240

    assert.equal(tracks.length, 3)
    assert.ok(target)
    assert.ok(tag)
    assert.equal(tracks[0]?.x, 174)
    assert.equal(tracks[0]?.width, tracks[1]?.width)
    assert.ok(Math.abs((tracks[2]?.width ?? 0) - (tracks[0]?.width ?? 0) * 2) <= 3)
    assert.equal(target.x, tracks[0]?.x)
    assert.equal(target.x + target.width, (tracks[2]?.x ?? 0) + (tracks[2]?.width ?? 0))
    assert.equal(readout?.text, '-8.7LUFS')

    for (const rect of recorder.fillRects) {
      assert.ok(rect.x >= viewportLeft, `rectangle starts left of LUFS viewport: ${JSON.stringify(rect)}`)
      assert.ok(rect.x + rect.width <= viewportRight, `rectangle exceeds LUFS viewport: ${JSON.stringify(rect)}`)
    }
  } finally {
    meter.dispose()
    dom.restore()
  }
})

test('LUFSMeter keeps minimum-width layout and compact readout inside canvas bounds', () => {
  const dom = installFakeCanvasDom()
  const recorder = createFakeCanvasRecorder()
  const canvas = createFakeCssSizedCanvas(recorder, 112, 196)
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer({ shortTermLUFS: -8.7, maxTruePeakDb: 3 })
  const meter = new LUFSMeter(canvas, {
    dataSource: {
      getPendingLUFSMeterSamples: () => [],
      getSampleRate: () => 48000,
      isPlaying: () => true,
      subscribeToSessionChanges: () => () => {},
    },
    nativeAnalyzer,
    lineColor: '#123456',
    trackColor: '#111111',
    targetColor: '#222222',
    scaleColor: '#333333',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    const tracks = recorder.fillRects.filter((rect) => rect.fillStyle === '#111111')
    const tag = recorder.fillRects.find((rect) => (
      rect.fillStyle === '#123456'
      && rect.height > 2
      && rect.height <= 22
    ))
    const readout = recorder.fillTexts.find((text) => text.text === '-8.7')

    assert.deepEqual(tracks.map((rect) => rect.width), [6, 6, 12])
    assert.ok(tag)
    assert.equal(readout?.text, '-8.7')
    const truePeakReadout = recorder.fillTexts.find((text) => text.text.endsWith('dBTP'))
    assert.equal(truePeakReadout?.text, '+3.0dBTP')
    const truePeakFontSize = Number(truePeakReadout?.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    const truePeakWidth = (truePeakReadout?.text.length ?? 0) * truePeakFontSize * 0.62
    assert.ok((truePeakReadout?.x ?? 0) - truePeakWidth / 2 >= 0)
    assert.ok((truePeakReadout?.x ?? 0) + truePeakWidth / 2 <= canvas.width)

    for (const rect of recorder.fillRects) {
      assert.ok(rect.x >= 0, `rectangle starts before canvas: ${JSON.stringify(rect)}`)
      assert.ok(rect.y >= 0, `rectangle starts above canvas: ${JSON.stringify(rect)}`)
      assert.ok(rect.width > 0, `rectangle has non-positive width: ${JSON.stringify(rect)}`)
      assert.ok(rect.height > 0, `rectangle has non-positive height: ${JSON.stringify(rect)}`)
      assert.ok(rect.x + rect.width <= canvas.width, `rectangle exceeds canvas width: ${JSON.stringify(rect)}`)
      assert.ok(rect.y + rect.height <= canvas.height, `rectangle exceeds canvas height: ${JSON.stringify(rect)}`)
    }

    const fontSize = Number(readout?.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    const estimatedTextWidth = (readout?.text.length ?? 0) * fontSize * 0.62
    assert.ok((readout?.x ?? 0) >= tag.x)
    assert.ok((readout?.x ?? 0) + estimatedTextWidth <= tag.x + tag.width)
  } finally {
    meter.dispose()
    dom.restore()
  }
})

test('LUFSMeter keeps equivalent CSS geometry across canvas backing ratios', () => {
  const dom = installFakeCanvasDom()

  const renderAtRatio = (pixelRatio: number): {
    tracks: FakeCanvasRecorder['fillRects']
    tag: FakeCanvasRecorder['fillRects'][number]
  } => {
    const recorder = createFakeCanvasRecorder()
    const canvas = createFakeCssSizedCanvas(recorder, 522, 196, pixelRatio)
    const meter = new LUFSMeter(canvas, {
      dataSource: {
        getPendingLUFSMeterSamples: () => [],
        getSampleRate: () => 48000,
        isPlaying: () => true,
        subscribeToSessionChanges: () => () => {},
      },
      nativeAnalyzer: createFakeLUFSMeterNativeAnalyzer({ shortTermLUFS: -8.7 }),
      lineColor: '#123456',
      trackColor: '#111111',
      targetColor: '#222222',
      scaleColor: '#333333',
    })

    ;(meter as unknown as { drawFrame: () => void }).drawFrame()
    meter.dispose()

    const tracks = recorder.fillRects
      .filter((rect) => rect.fillStyle === '#111111')
      .map((rect) => ({
        ...rect,
        x: rect.x / pixelRatio,
        y: rect.y / pixelRatio,
        width: rect.width / pixelRatio,
        height: rect.height / pixelRatio,
      }))
    const rawTag = recorder.fillRects.find((rect) => rect.fillStyle === '#123456' && rect.height <= 22 * pixelRatio)
    assert.ok(rawTag)
    const tag = {
      ...rawTag,
      x: rawTag.x / pixelRatio,
      y: rawTag.y / pixelRatio,
      width: rawTag.width / pixelRatio,
      height: rawTag.height / pixelRatio,
    }
    return { tracks, tag }
  }

  try {
    const baseline = renderAtRatio(1)
    for (const pixelRatio of [1.25, 2]) {
      const result = renderAtRatio(pixelRatio)
      assert.equal(result.tracks.length, baseline.tracks.length)
      for (let index = 0; index < baseline.tracks.length; index += 1) {
        assertAlmostEqual(result.tracks[index]?.x ?? 0, baseline.tracks[index]?.x ?? 0, 2, `track ${index} x at ${pixelRatio}x`)
        assertAlmostEqual(result.tracks[index]?.width ?? 0, baseline.tracks[index]?.width ?? 0, 2, `track ${index} width at ${pixelRatio}x`)
      }
      assertAlmostEqual(result.tag.x, baseline.tag.x, 2, `readout tag x at ${pixelRatio}x`)
      assertAlmostEqual(result.tag.width, baseline.tag.width, 2, `readout tag width at ${pixelRatio}x`)
    }
  } finally {
    dom.restore()
  }
})

test('LUFSMeter concatenates queued chunks before pushing them to native DSP', () => {
  const chunkQueue: Array<{ left: Float32Array; right: Float32Array }> = [
    {
      left: new Float32Array([1, 2, 3]),
      right: new Float32Array([4, 5, 6]),
    },
    {
      left: new Float32Array([7, 8]),
      right: new Float32Array([9, 10]),
    },
  ]
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
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer()
  const meter = new LUFSMeter(createFakeCanvas(), { dataSource, nativeAnalyzer })

  try {
    ;(meter as unknown as { processAudio: () => void }).processAudio()

    assert.equal(nativeAnalyzer.pushed.length, 1)
    assert.deepEqual(Array.from(nativeAnalyzer.pushed[0]?.left ?? []), [1, 2, 3, 7, 8])
    assert.deepEqual(Array.from(nativeAnalyzer.pushed[0]?.right ?? []), [4, 5, 6, 9, 10])
  } finally {
    meter.dispose()
  }
})

test('LUFSMeter resets native DSP when the sample rate or session changes', () => {
  let sampleRate = 48000
  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: new Float32Array([0.1]), right: new Float32Array([0.2]) },
  ]
  let sessionListener: (() => void) | null = null
  const dataSource = {
    getPendingLUFSMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => sampleRate,
    isPlaying: () => true,
    subscribeToSessionChanges: (listener: () => void) => {
      sessionListener = listener
      return () => {}
    },
  }
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer()
  const meter = new LUFSMeter(createFakeCanvas(), { dataSource, nativeAnalyzer })
  const processAudio = (meter as unknown as { processAudio: () => void }).processAudio.bind(meter)

  try {
    processAudio()
    sampleRate = 96000
    pendingChunks = [{ left: new Float32Array([0.3]), right: new Float32Array([0.4]) }]
    processAudio()
    sessionListener?.()

    assert.deepEqual(nativeAnalyzer.sampleRates, [48000, 96000, 96000])
    assert.equal(nativeAnalyzer.resetCount, 3)
  } finally {
    meter.dispose()
  }
})

test('LUFSMeter drains audio and renders silence when native DSP is unavailable', () => {
  const dom = installFakeCanvasDom()
  const recorder = createFakeCanvasRecorder()
  let pendingChunks: Array<{ left: Float32Array; right: Float32Array }> = [
    { left: new Float32Array([0.9, 0.9]), right: new Float32Array([0.9, 0.9]) },
  ]
  const dataSource = {
    getPendingLUFSMeterSamples: () => {
      const drained = pendingChunks
      pendingChunks = []
      return drained
    },
    getSampleRate: () => 48000,
    isPlaying: () => true,
    subscribeToSessionChanges: () => () => {},
  }
  const nativeAnalyzer = createFakeLUFSMeterNativeAnalyzer({ momentaryLUFS: -5 }, false)
  const meter = new LUFSMeter(createFakeCanvas(recorder), {
    dataSource,
    nativeAnalyzer,
    readout: 'momentary',
    lineColor: 'rgb(255, 0, 96)',
  })

  try {
    ;(meter as unknown as { drawFrame: () => void }).drawFrame()

    assert.equal(nativeAnalyzer.pushed.length, 0)
    assert.equal(pendingChunks.length, 0)
    assert.equal(
      recorder.fillTexts.some((text) => text.text === '-∞LUFS'),
      true,
    )
  } finally {
    meter.dispose()
    dom.restore()
  }
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

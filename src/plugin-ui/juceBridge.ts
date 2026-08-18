/**
 * Bridge between the JUCE 8 plugin host (C++) and this webview UI.
 *
 * - C++ -> JS: emits "spectrumFrame" (~display rate) and "prismRestoreSettings".
 * - JS -> C++: emits "prismConfig" (settings + DSP params) and "prismReady".
 *
 * JUCE injects `window.__JUCE__` into pages loaded by the webview (including the
 * Vite dev server) when native integration is enabled. When it's absent (e.g. a
 * plain browser), a synthetic generator drives the UI so it's developable.
 */

export interface SpectrumFrame {
  /** Host sample rate in Hz. */
  sampleRate: number
  /** Mid (mono) magnitudes in dB, length = fftSize/2. */
  magnitudes: Float32Array
  /** Side magnitudes in dB (same length); empty if unavailable. */
  side: Float32Array
  /** Smoothed max(L, R) magnitudes in dBFS (same length). */
  channelMax: Float32Array
}

interface SpectrumFramePayload {
  sampleRate?: number
  magnitudes?: string
  side?: string
  channelMax?: string
}

type JuceBackend = {
  addEventListener: (eventId: string, fn: (payload: unknown) => void) => number
  removeEventListener?: (id: number) => void
  emitEvent?: (eventId: string, payload: unknown) => void
}

declare global {
  interface Window {
    __JUCE__?: { backend?: JuceBackend; initialisationData?: unknown }
  }
}

const HOST_WAIT_TIMEOUT_MS = 4000
const HOST_POLL_INTERVAL_MS = 50

/** Resolves to the JUCE backend once available, or null if no host (timeout). */
let backendPromise: Promise<JuceBackend | null> | null = null

function ensureBackend(): Promise<JuceBackend | null> {
  if (backendPromise) return backendPromise
  backendPromise = new Promise((resolve) => {
    const existing = window.__JUCE__?.backend
    if (existing && typeof existing.addEventListener === 'function') {
      resolve(existing)
      return
    }
    let waited = 0
    const timer = setInterval(() => {
      const backend = window.__JUCE__?.backend
      if (backend && typeof backend.addEventListener === 'function') {
        clearInterval(timer)
        resolve(backend)
        return
      }
      waited += HOST_POLL_INTERVAL_MS
      if (waited >= HOST_WAIT_TIMEOUT_MS) {
        clearInterval(timer)
        resolve(null)
      }
    }, HOST_POLL_INTERVAL_MS)
  })
  return backendPromise
}

/** Fire-and-forget event to C++ (no-op when running without a host). */
export function emitToHost(eventId: string, payload: unknown): void {
  void ensureBackend().then((backend) => backend?.emitEvent?.(eventId, payload))
}

/** Subscribe to a C++ event. Returns an unsubscribe function. */
export function onHostEvent(eventId: string, handler: (payload: unknown) => void): () => void {
  let listenerId: number | null = null
  let cancelled = false
  void ensureBackend().then((backend) => {
    if (!backend || cancelled) return
    listenerId = backend.addEventListener(eventId, handler)
  })
  return () => {
    cancelled = true
    if (listenerId !== null) {
      window.__JUCE__?.backend?.removeEventListener?.(listenerId)
    }
  }
}

export function base64ToFloat32Array(b64: string): Float32Array {
  if (!b64) return new Float32Array(0)
  const binary = atob(b64)
  const byteLength = binary.length
  const bytes = new Uint8Array(byteLength)
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer, 0, byteLength >> 2)
}

export function decodeSpectrumFrame(payload: unknown): SpectrumFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, magnitudes, side, channelMax } = payload as SpectrumFramePayload
  if (typeof magnitudes !== 'string' || magnitudes.length === 0) return null
  const decodedMagnitudes = base64ToFloat32Array(magnitudes)
  const decodedChannelMax = typeof channelMax === 'string'
    ? base64ToFloat32Array(channelMax)
    : new Float32Array(0)
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    magnitudes: decodedMagnitudes,
    side: typeof side === 'string' ? base64ToFloat32Array(side) : new Float32Array(0),
    channelMax: decodedChannelMax.length > 0 ? decodedChannelMax : decodedMagnitudes,
  }
}

export interface SpectrumBridgeHandlers {
  onFrame: (frame: SpectrumFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectSpectrumBridge(handlers: SpectrumBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic spectrum (browser dev mode)')
    const binCount = 1024
    const sampleRate = 48000
    const mid = new Float32Array(binCount)
    const side = new Float32Array(binCount).fill(-100)
    const channelMax = new Float32Array(binCount)
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.05
      for (let i = 0; i < binCount; i += 1) {
        const t = i / binCount
        const peak1 = Math.exp(-Math.pow((t - (0.15 + 0.05 * Math.sin(phase))) * 12, 2)) * 70
        const peak2 = Math.exp(-Math.pow((t - 0.5) * 18, 2)) * 50
        mid[i] = -100 + peak1 + peak2 + Math.random() * 6
        side[i] = -100 + peak2 * 0.4 + Math.random() * 4
        channelMax[i] = mid[i]
      }
      handlers.onFrame({ sampleRate, magnitudes: mid, side, channelMax })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('spectrumFrame', (payload) => {
        const frame = decodeSpectrumFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// VU meter frames (event "vumeterFrame": scalar snapshot, no base64).

export interface VUMeterFrame {
  sampleRate: number
  vuLDb: number
  vuRDb: number
  barLDb: number
  barRDb: number
  peakLDb: number
  peakRDb: number
  correlation: number
}

function decodeVUMeterFrame(payload: unknown): VUMeterFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const num = (key: string, fallback: number): number =>
    typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : fallback
  return {
    sampleRate: num('sampleRate', 48000) > 0 ? num('sampleRate', 48000) : 48000,
    vuLDb: num('vuLDb', -60),
    vuRDb: num('vuRDb', -60),
    barLDb: num('barLDb', -60),
    barRDb: num('barRDb', -60),
    peakLDb: num('peakLDb', -60),
    peakRDb: num('peakRDb', -60),
    correlation: num('correlation', 0),
  }
}

export interface VUMeterBridgeHandlers {
  onFrame: (frame: VUMeterFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectVUMeterBridge(handlers: VUMeterBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic VU meter (browser dev mode)')
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.04
      const level = (offset: number): number => -40 + (Math.sin(phase + offset) * 0.5 + 0.5) * 42
      const vuL = level(0)
      const vuR = level(0.7)
      handlers.onFrame({
        sampleRate: 48000,
        vuLDb: vuL,
        vuRDb: vuR,
        barLDb: vuL,
        barRDb: vuR,
        peakLDb: vuL + 3,
        peakRDb: vuR + 3,
        correlation: Math.sin(phase * 0.3),
      })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('vumeterFrame', (payload) => {
        const frame = decodeVUMeterFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (vumeter)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// Loudness meter frames (event "lufsmeterFrame": scalar snapshot, no base64).

export interface LUFSMeterFrame {
  sampleRate: number
  momentaryLUFS: number
  shortTermLUFS: number
  integratedLUFS: number
  vuLDb: number
  vuRDb: number
  barLDb: number
  barRDb: number
  truePeakLDb: number
  truePeakRDb: number
  maxTruePeakDb: number
  correlation: number
}

export function decodeLUFSMeterFrame(
  payload: unknown,
  previousMaxTruePeakDb = -60,
): LUFSMeterFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const num = (key: string, fallback: number): number =>
    typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : fallback
  const truePeakLDb = num('truePeakLDb', num('peakLDb', -60))
  const truePeakRDb = num('truePeakRDb', num('peakRDb', -60))
  const explicitMaximum = typeof p.maxTruePeakDb === 'number' && Number.isFinite(p.maxTruePeakDb)
    ? p.maxTruePeakDb
    : null
  return {
    sampleRate: num('sampleRate', 48000) > 0 ? num('sampleRate', 48000) : 48000,
    momentaryLUFS: num('momentaryLUFS', -70),
    shortTermLUFS: num('shortTermLUFS', -70),
    integratedLUFS: num('integratedLUFS', -70),
    vuLDb: num('vuLDb', -60),
    vuRDb: num('vuRDb', -60),
    barLDb: num('barLDb', -60),
    barRDb: num('barRDb', -60),
    truePeakLDb,
    truePeakRDb,
    maxTruePeakDb: explicitMaximum ?? Math.max(
      Number.isFinite(previousMaxTruePeakDb) ? previousMaxTruePeakDb : -60,
      truePeakLDb,
      truePeakRDb,
    ),
    correlation: num('correlation', 0),
  }
}

export interface LUFSMeterBridgeHandlers {
  onFrame: (frame: LUFSMeterFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectLUFSMeterBridge(handlers: LUFSMeterBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null
  let maxTruePeakDb = -60
  let previousSampleRate = 0

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic LUFS meter (browser dev mode)')
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.04
      const lufs = (offset: number): number => -24 + Math.sin(phase + offset) * 6
      const vuL = -36 + (Math.sin(phase) * 0.5 + 0.5) * 30
      const vuR = -36 + (Math.sin(phase + 0.7) * 0.5 + 0.5) * 30
      const truePeakLDb = vuL + 3
      const truePeakRDb = vuR + 3
      maxTruePeakDb = Math.max(maxTruePeakDb, truePeakLDb, truePeakRDb)
      handlers.onFrame({
        sampleRate: 48000,
        momentaryLUFS: lufs(0),
        shortTermLUFS: lufs(0.5),
        integratedLUFS: -23,
        vuLDb: vuL,
        vuRDb: vuR,
        barLDb: vuL,
        barRDb: vuR,
        truePeakLDb,
        truePeakRDb,
        maxTruePeakDb,
        correlation: Math.sin(phase * 0.3),
      })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('lufsmeterFrame', (payload) => {
        let frame = decodeLUFSMeterFrame(payload, maxTruePeakDb)
        if (frame && previousSampleRate > 0 && Math.abs(frame.sampleRate - previousSampleRate) > 1) {
          frame = decodeLUFSMeterFrame(payload, -60)
        }
        if (frame) {
          previousSampleRate = frame.sampleRate
          maxTruePeakDb = frame.maxTruePeakDb
          handlers.onFrame(frame)
        }
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (lufsmeter)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// Vectorscope frames (event "vectorscopeFrame"): a point cloud, either standard
// (x, y base64) or multiband (data base64, 6 floats/point), flagged by `multiband`.

export interface VectorscopeFrame {
  sampleRate: number
  multiband: boolean
  count: number
  x?: Float32Array
  y?: Float32Array
  data?: Float32Array
}

interface VectorscopeFramePayload {
  sampleRate?: number
  multiband?: boolean
  count?: number
  x?: string
  y?: string
  data?: string
}

function decodeVectorscopeFrame(payload: unknown): VectorscopeFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, multiband, count, x, y, data } = payload as VectorscopeFramePayload
  const frame: VectorscopeFrame = {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    multiband: Boolean(multiband),
    count: typeof count === 'number' ? count : 0,
  }
  if (frame.multiband) {
    if (typeof data !== 'string') return null
    frame.data = base64ToFloat32Array(data)
  } else {
    if (typeof x !== 'string' || typeof y !== 'string') return null
    frame.x = base64ToFloat32Array(x)
    frame.y = base64ToFloat32Array(y)
  }
  return frame
}

export interface VectorscopeBridgeHandlers {
  onFrame: (frame: VectorscopeFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectVectorscopeBridge(handlers: VectorscopeBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic vectorscope (browser dev mode)')
    const count = 2048
    const x = new Float32Array(count)
    const y = new Float32Array(count)
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.03
      for (let i = 0; i < count; i += 1) {
        const t = (i / count) * Math.PI * 2
        x[i] = Math.sin(t * 3 + phase) * 0.7
        y[i] = Math.sin(t * 2 + phase * 1.3) * 0.7
      }
      handlers.onFrame({ sampleRate: 48000, multiband: false, count, x, y })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('vectorscopeFrame', (payload) => {
        const frame = decodeVectorscopeFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (vectorscope)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// Spectrogram frames (event "spectrogramFrame"): the new display+heat columns
// produced since the last frame, base64-encoded, tagged with rowCount/columnCount.

export interface SpectrogramFrame {
  sampleRate: number
  display: Float32Array
  heat: Float32Array
  columnCount: number
  rowCount: number
}

interface SpectrogramFramePayload {
  sampleRate?: number
  display?: string
  heat?: string
  columnCount?: number
  rowCount?: number
}

function decodeSpectrogramFrame(payload: unknown): SpectrogramFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, display, heat, columnCount, rowCount } = payload as SpectrogramFramePayload
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    display: typeof display === 'string' ? base64ToFloat32Array(display) : new Float32Array(0),
    heat: typeof heat === 'string' ? base64ToFloat32Array(heat) : new Float32Array(0),
    columnCount: typeof columnCount === 'number' ? columnCount : 0,
    rowCount: typeof rowCount === 'number' ? rowCount : 0,
  }
}

export interface SpectrogramBridgeHandlers {
  onFrame: (frame: SpectrogramFrame) => void
  onConnected?: (usingMock: boolean) => void
  /** Lets the dev mock size its columns to the canvas-derived rowCount. */
  getRowCount?: () => number
}

export function connectSpectrogramBridge(handlers: SpectrogramBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic spectrogram (browser dev mode)')
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.08
      const rowCount = handlers.getRowCount?.() ?? 0
      if (rowCount > 0) {
        const columnCount = 2
        const display = new Float32Array(rowCount * columnCount)
        const heat = new Float32Array(rowCount * columnCount)
        for (let c = 0; c < columnCount; c += 1) {
          for (let r = 0; r < rowCount; r += 1) {
            const t = r / rowCount
            const band = Math.exp(-Math.pow((t - (0.3 + 0.2 * Math.sin(phase))) * 6, 2))
            const v = Math.min(1, band + Math.random() * 0.15)
            display[c * rowCount + r] = v
            heat[c * rowCount + r] = v
          }
        }
        handlers.onFrame({ sampleRate: 48000, display, heat, columnCount, rowCount })
      }
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('spectrogramFrame', (payload) => {
        const frame = decodeSpectrogramFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (spectrogram)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// Waveform frames (event "waveformFrame"): per-column summaries (base64), stride 10
// in stereo mode / stride 5 in mono, flagged by `stereo`.

export interface WaveformFrame {
  sampleRate: number
  stereo: boolean
  columnCount: number
  summaries: Float32Array
}

interface WaveformFramePayload {
  sampleRate?: number
  stereo?: boolean
  columnCount?: number
  summaries?: string
}

function decodeWaveformFrame(payload: unknown): WaveformFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, stereo, columnCount, summaries } = payload as WaveformFramePayload
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    stereo: Boolean(stereo),
    columnCount: typeof columnCount === 'number' ? columnCount : 0,
    summaries: typeof summaries === 'string' ? base64ToFloat32Array(summaries) : new Float32Array(0),
  }
}

export interface WaveformBridgeHandlers {
  onFrame: (frame: WaveformFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectWaveformBridge(handlers: WaveformBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic waveform (browser dev mode)')
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.12
      const columns = 2
      // Emit both mono (stride 5) and stereo (stride 10) so the dev mock works in
      // either mode (the analyzer serves whichever the visualizer asks for).
      const mono = new Float32Array(columns * 5)
      const stereo = new Float32Array(columns * 10)
      for (let c = 0; c < columns; c += 1) {
        const amp = 0.3 + 0.6 * Math.abs(Math.sin(phase + c * 0.4))
        const m = c * 5
        mono[m] = -amp; mono[m + 1] = amp; mono[m + 2] = amp * 0.5; mono[m + 3] = amp * 0.7; mono[m + 4] = amp * 0.3
        const s = c * 10
        stereo[s] = -amp; stereo[s + 1] = amp; stereo[s + 2] = amp * 0.5; stereo[s + 3] = amp * 0.7; stereo[s + 4] = amp * 0.3
        const ampR = amp * 0.85
        stereo[s + 5] = -ampR; stereo[s + 6] = ampR; stereo[s + 7] = ampR * 0.5; stereo[s + 8] = ampR * 0.7; stereo[s + 9] = ampR * 0.3
      }
      handlers.onFrame({ sampleRate: 48000, stereo: false, columnCount: columns, summaries: mono })
      handlers.onFrame({ sampleRate: 48000, stereo: true, columnCount: columns, summaries: stereo })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('waveformFrame', (payload) => {
        const frame = decodeWaveformFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (waveform)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

// ---------------------------------------------------------------------------
// Oscilloscope frames (event "oscilloscopeFrame": { sampleRate, samples, pitch }).

export interface OscilloscopeFrame {
  sampleRate: number
  /** Already-triggered display window of time-domain samples. */
  samples: Float32Array
  detectedPitch: number
}

interface OscilloscopeFramePayload {
  sampleRate?: number
  samples?: string
  pitch?: number
}

function decodeOscilloscopeFrame(payload: unknown): OscilloscopeFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, samples, pitch } = payload as OscilloscopeFramePayload
  if (typeof samples !== 'string' || samples.length === 0) return null
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    samples: base64ToFloat32Array(samples),
    detectedPitch: typeof pitch === 'number' ? pitch : 0,
  }
}

export interface OscilloscopeBridgeHandlers {
  onFrame: (frame: OscilloscopeFrame) => void
  onConnected?: (usingMock: boolean) => void
}

export function connectOscilloscopeBridge(handlers: OscilloscopeBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host — using synthetic oscilloscope (browser dev mode)')
    const count = 2048
    const samples = new Float32Array(count)
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.08
      for (let i = 0; i < count; i += 1) {
        const t = (i / count) * Math.PI * 2 * 3
        samples[i] = Math.sin(t + phase) * 0.7 + Math.sin(t * 2 + phase) * 0.15
      }
      handlers.onFrame({ sampleRate: 48000, samples, detectedPitch: 220 })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('oscilloscopeFrame', (payload) => {
        const frame = decodeOscilloscopeFrame(payload)
        if (frame) handlers.onFrame(frame)
      })
      handlers.onConnected?.(false)
      console.log('[prism-plugin] connected to JUCE host (oscilloscope)')
    } else {
      startMock()
    }
  })

  return () => {
    disposed = true
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) window.__JUCE__?.backend?.removeEventListener?.(listenerId)
  }
}

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
}

interface SpectrumFramePayload {
  sampleRate?: number
  magnitudes?: string
  side?: string
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

function decodeFrame(payload: unknown): SpectrumFrame | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { sampleRate, magnitudes, side } = payload as SpectrumFramePayload
  if (typeof magnitudes !== 'string' || magnitudes.length === 0) return null
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    magnitudes: base64ToFloat32Array(magnitudes),
    side: typeof side === 'string' ? base64ToFloat32Array(side) : new Float32Array(0),
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
      }
      handlers.onFrame({ sampleRate, magnitudes: mid, side })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  void ensureBackend().then((backend) => {
    if (disposed) return
    if (backend) {
      listenerId = backend.addEventListener('spectrumFrame', (payload) => {
        const frame = decodeFrame(payload)
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

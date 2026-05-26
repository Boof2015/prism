/**
 * Bridge between the JUCE 8 plugin host (C++) and this webview UI.
 *
 * The C++ side (plugin/Source/PluginEditor.cpp) computes spectrum magnitudes off
 * the realtime thread and emits a "spectrumFrame" event ~60x/sec via
 * juce::WebBrowserComponent::emitEventIfBrowserIsVisible(). JUCE injects
 * `window.__JUCE__` into any page loaded by the webview (including the Vite dev
 * server) when native integration is enabled, so we subscribe to that here.
 *
 * When `window.__JUCE__` is absent (e.g. opening the dev server in a normal
 * browser), we fall back to a synthetic generator so the UI is still developable
 * outside a DAW.
 */

export interface SpectrumFrame {
  /** Host sample rate in Hz. */
  sampleRate: number
  /** Smoothed magnitudes in dB, length = fftSize/2 (1024 for a 2048 FFT). */
  magnitudes: Float32Array
}

/** Raw payload as it arrives from C++ across the JUCE var bridge. */
interface SpectrumFramePayload {
  sampleRate?: number
  /** base64 of little-endian Float32 magnitude bytes. */
  magnitudes?: string
}

type JuceBackend = {
  addEventListener: (eventId: string, fn: (payload: unknown) => void) => number
  removeEventListener?: (id: number) => void
}

declare global {
  interface Window {
    __JUCE__?: {
      backend?: JuceBackend
      initialisationData?: unknown
    }
  }
}

const SPECTRUM_EVENT_ID = 'spectrumFrame'
const HOST_WAIT_TIMEOUT_MS = 3000
const HOST_POLL_INTERVAL_MS = 50

/** Decode a base64 string of little-endian Float32 bytes into a Float32Array. */
function base64ToFloat32Array(b64: string): Float32Array {
  const binary = atob(b64)
  const byteLength = binary.length
  const bytes = new Uint8Array(byteLength)
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  // byteLength is a multiple of 4 (Float32) when produced by the C++ side.
  return new Float32Array(bytes.buffer, 0, byteLength >> 2)
}

function decodeFrame(payload: unknown): SpectrumFrame | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const { sampleRate, magnitudes } = payload as SpectrumFramePayload
  if (typeof magnitudes !== 'string' || magnitudes.length === 0) {
    return null
  }
  return {
    sampleRate: typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000,
    magnitudes: base64ToFloat32Array(magnitudes),
  }
}

export interface SpectrumBridgeHandlers {
  /** Called for every decoded frame (from the host or the mock generator). */
  onFrame: (frame: SpectrumFrame) => void
  /** Called once we know whether a real JUCE host is present. */
  onConnected?: (usingMock: boolean) => void
}

/**
 * Connect to the JUCE host. Resolves to a disposer that detaches the listener
 * (or stops the mock generator).
 */
export function connectSpectrumBridge(handlers: SpectrumBridgeHandlers): () => void {
  let disposed = false
  let listenerId: number | null = null
  let mockRaf: number | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let waited = 0

  const attachToHost = (backend: JuceBackend): void => {
    listenerId = backend.addEventListener(SPECTRUM_EVENT_ID, (payload) => {
      const frame = decodeFrame(payload)
      if (frame) {
        handlers.onFrame(frame)
      }
    })
    handlers.onConnected?.(false)
    console.log('[prism-plugin] connected to JUCE host')
  }

  const startMock = (): void => {
    handlers.onConnected?.(true)
    console.warn('[prism-plugin] no JUCE host detected — using synthetic spectrum (browser dev mode)')
    const binCount = 1024
    const sampleRate = 48000
    const data = new Float32Array(binCount)
    let phase = 0
    const tick = (): void => {
      if (disposed) return
      phase += 0.05
      for (let i = 0; i < binCount; i += 1) {
        const t = i / binCount
        // A couple of moving peaks over a -100 dB noise floor.
        const peak1 = Math.exp(-Math.pow((t - (0.15 + 0.05 * Math.sin(phase))) * 12, 2)) * 70
        const peak2 = Math.exp(-Math.pow((t - 0.5) * 18, 2)) * 50
        const noise = Math.random() * 6
        data[i] = -100 + peak1 + peak2 + noise
      }
      handlers.onFrame({ sampleRate, magnitudes: data })
      mockRaf = requestAnimationFrame(tick)
    }
    mockRaf = requestAnimationFrame(tick)
  }

  const tryConnect = (): void => {
    if (disposed) return
    const backend = window.__JUCE__?.backend
    if (backend && typeof backend.addEventListener === 'function') {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      attachToHost(backend)
      return
    }
    waited += HOST_POLL_INTERVAL_MS
    if (waited >= HOST_WAIT_TIMEOUT_MS) {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      startMock()
    }
  }

  // Try immediately, then poll briefly (the __JUCE__ script may inject slightly late).
  tryConnect()
  if (listenerId === null && mockRaf === null) {
    pollTimer = setInterval(tryConnect, HOST_POLL_INTERVAL_MS)
  }

  return () => {
    disposed = true
    if (pollTimer) clearInterval(pollTimer)
    if (mockRaf !== null) cancelAnimationFrame(mockRaf)
    if (listenerId !== null) {
      window.__JUCE__?.backend?.removeEventListener?.(listenerId)
    }
  }
}

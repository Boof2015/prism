import type { PitchSettings } from '../../types/moduleInstance'

export interface DetectedPitch { hz: number; power: number }
type Listener = (peaks: Array<DetectedPitch | undefined>) => void
interface PendingRequest { owner: symbol; samples: Float32Array; sampleRate: number; settings: PitchSettings }

// Hard application-wide budget: no combination of Pitch instances may run
// more than roughly three analyses per second.
const MIN_ANALYSIS_INTERVAL_MS = 333
const worker = new Worker(new URL('../workers/pitchDetection.worker.ts', import.meta.url), { type: 'module' })
const listeners = new Map<symbol, Listener>()
const pending = new Map<symbol, PendingRequest>()
let active: { id: number; owner: symbol } | undefined
let nextId = 1
let nextAllowedAt = 0
let timer: number | undefined

function dispatchNext(): void {
  if (active || pending.size === 0) return
  const delay = Math.max(0, nextAllowedAt - performance.now())
  if (delay > 0) {
    if (timer === undefined) timer = window.setTimeout(() => { timer = undefined; dispatchNext() }, delay)
    return
  }
  const request = pending.values().next().value as PendingRequest | undefined
  if (!request) return
  pending.delete(request.owner)
  const id = nextId++
  active = { id, owner: request.owner }
  nextAllowedAt = performance.now() + MIN_ANALYSIS_INTERVAL_MS
  worker.postMessage({ id, samples: request.samples, sampleRate: request.sampleRate, settings: request.settings }, [request.samples.buffer])
}

worker.onmessage = (event: MessageEvent<{ id: number; peaks: Array<DetectedPitch | undefined> }>): void => {
  if (!active || active.id !== event.data.id) return
  const owner = active.owner
  active = undefined
  listeners.get(owner)?.(event.data.peaks)
  dispatchNext()
}

export function createPitchAnalysisClient(listener: Listener): {
  submit: (samples: Float32Array, sampleRate: number, settings: PitchSettings) => void
  dispose: () => void
} {
  const owner = Symbol('pitch-analysis')
  listeners.set(owner, listener)
  return {
    submit: (samples, sampleRate, settings) => {
      // Replace stale queued work from this tile. One shared worker and the global
      // interval cap keep duplicate Pitch modules from degrading other scopes.
      pending.set(owner, { owner, samples, sampleRate, settings: { ...settings } })
      dispatchNext()
    },
    dispose: () => {
      listeners.delete(owner)
      pending.delete(owner)
    },
  }
}

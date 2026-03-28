import { create } from 'zustand'
import { isVisualizerFrameTarget, type VisualizerFrameTarget } from '../../types/performance'

const STORAGE_KEY = 'prism:performance'
const SYNC_CHANNEL_NAME = 'prism:performance'

interface PersistedPerformanceState {
  frameTarget: VisualizerFrameTarget
}

interface PerformanceState {
  frameTarget: VisualizerFrameTarget
  dockedRenderFps: number
  setFrameTarget: (target: VisualizerFrameTarget) => void
  setDockedRenderFps: (fps: number) => void
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function getStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  return localStorage
}

export function normalizePerformancePreferences(raw: unknown): PersistedPerformanceState {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PersistedPerformanceState>
    : {}

  return {
    frameTarget: isVisualizerFrameTarget(parsed.frameTarget) ? parsed.frameTarget : 'display-sync',
  }
}

export function loadPerformancePreferences(storage = getStorage()): PersistedPerformanceState {
  if (!storage) {
    return normalizePerformancePreferences(null)
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      return normalizePerformancePreferences(null)
    }

    return normalizePerformancePreferences(JSON.parse(raw))
  } catch {
    return normalizePerformancePreferences(null)
  }
}

function persistPerformancePreferences(target: VisualizerFrameTarget, storage = getStorage()): void {
  if (!storage) return

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ frameTarget: target }))
  } catch {
    // Ignore localStorage write failures.
  }
}

const storedPreferences = loadPerformancePreferences()

export const usePerformanceStore = create<PerformanceState>((set) => ({
  frameTarget: storedPreferences.frameTarget,
  dockedRenderFps: 0,

  setFrameTarget: (target: VisualizerFrameTarget) => {
    persistPerformancePreferences(target)
    broadcastFrameTarget(target)
    set((state) => {
      if (state.frameTarget === target) return state
      return { ...state, frameTarget: target }
    })
  },

  setDockedRenderFps: (fps: number) => {
    const nextFps = Number.isFinite(fps) && fps > 0 ? fps : 0
    set((state) => {
      if (state.dockedRenderFps === nextFps) return state
      return { ...state, dockedRenderFps: nextFps }
    })
  },
}))

let syncChannel: BroadcastChannel | null = null
let syncBound = false

function getSyncChannel(): BroadcastChannel | null {
  if (syncChannel !== null || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return syncChannel
  }

  syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME)
  return syncChannel
}

function applyExternalFrameTarget(raw: unknown): void {
  if (!isVisualizerFrameTarget(raw)) return
  if (usePerformanceStore.getState().frameTarget === raw) return
  usePerformanceStore.setState({ frameTarget: raw })
}

function broadcastFrameTarget(target: VisualizerFrameTarget): void {
  getSyncChannel()?.postMessage({ frameTarget: target })
}

function bindCrossWindowSync(): void {
  if (syncBound || typeof window === 'undefined') {
    return
  }

  syncBound = true

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || typeof event.newValue !== 'string') return

      try {
        const parsed = JSON.parse(event.newValue) as PersistedPerformanceState
        applyExternalFrameTarget(parsed.frameTarget)
      } catch {
        // Ignore invalid sync payloads.
      }
    })
  }

  getSyncChannel()?.addEventListener('message', (event: MessageEvent<{ frameTarget?: unknown }>) => {
    applyExternalFrameTarget(event.data?.frameTarget)
  })
}

bindCrossWindowSync()

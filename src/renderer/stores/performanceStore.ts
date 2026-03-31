import { create } from 'zustand'
import {
  isVisualizerFrameTarget,
  type PerformanceMemoryLogRecord,
  type PerformanceMemorySnapshot,
  type VisualizerFrameTarget,
} from '../../types/performance'

const STORAGE_KEY = 'prism:performance'
const SYNC_CHANNEL_NAME = 'prism:performance'

interface PersistedPerformanceState {
  frameTarget: VisualizerFrameTarget
}

interface PerformanceState {
  frameTarget: VisualizerFrameTarget
  dockedRenderFps: number
  memorySample: PerformanceMemorySnapshot | null
  memoryHistory: PerformanceMemorySnapshot[]
  rendererMemoryDeltaMb: number
  appMemoryDeltaMb: number
  setFrameTarget: (target: VisualizerFrameTarget) => void
  setDockedRenderFps: (fps: number) => void
  startMemoryMonitoring: () => void
  stopMemoryMonitoring: () => void
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
const MEMORY_SAMPLE_INTERVAL_MS = 5000
const MEMORY_HISTORY_LIMIT = 720

interface ChromiumPerformanceMemory {
  jsHeapSizeLimit: number
  totalJSHeapSize: number
  usedJSHeapSize: number
}

let memoryMonitorTimer: ReturnType<typeof setInterval> | null = null
let memoryMonitorRefCount = 0
let memoryMonitorInFlight = false
let contextStoreAccessorsPromise: Promise<{
  getAudioState: () => {
    isCapturing: boolean
    captureStatus: 'idle' | 'connecting' | 'capturing' | 'error'
  }
  getSettingsState: () => {
    scopeOrder: string[]
    hiddenScopes: Set<string>
    scopePopouts: Record<string, { poppedOut?: boolean }>
  }
}> | null = null

function isMainWindowContext(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const params = new URLSearchParams(window.location.search)
  return params.get('window') !== 'scope-popout'
}

function bytesToMegabytes(value: number | undefined): number {
  return Math.round((((value ?? 0) / (1024 * 1024)) * 10)) / 10
}

async function collectMemorySnapshot(): Promise<PerformanceMemorySnapshot | null> {
  if (typeof window === 'undefined' || typeof window.electronAPI?.getPerformanceMemorySnapshot !== 'function') {
    return null
  }

  const snapshot = await window.electronAPI.getPerformanceMemorySnapshot()
  const performanceWithMemory = performance as Performance & { memory?: ChromiumPerformanceMemory }
  const heap = performanceWithMemory.memory
  return {
    ...snapshot,
    jsHeapUsedMb: heap ? bytesToMegabytes(heap.usedJSHeapSize) : null,
    jsHeapLimitMb: heap ? bytesToMegabytes(heap.jsHeapSizeLimit) : null,
  }
}

async function getContextStoreAccessors(): Promise<{
  getAudioState: () => {
    isCapturing: boolean
    captureStatus: 'idle' | 'connecting' | 'capturing' | 'error'
  }
  getSettingsState: () => {
    scopeOrder: string[]
    hiddenScopes: Set<string>
    scopePopouts: Record<string, { poppedOut?: boolean }>
  }
} | null> {
  if (typeof window === 'undefined') {
    return null
  }

  if (!contextStoreAccessorsPromise) {
    contextStoreAccessorsPromise = Promise.all([
      import('./audioStore'),
      import('./settingsStore'),
    ]).then(([audioStoreModule, settingsStoreModule]) => ({
      getAudioState: () => audioStoreModule.useAudioStore.getState(),
      getSettingsState: () => settingsStoreModule.useSettingsStore.getState(),
    }))
  }

  return contextStoreAccessorsPromise
}

async function sampleMemory(): Promise<void> {
  if (memoryMonitorInFlight) {
    return
  }

  memoryMonitorInFlight = true
  try {
    const snapshot = await collectMemorySnapshot()
    if (!snapshot) {
      return
    }

    const contextStoreAccessors = await getContextStoreAccessors()
    let logRecord: PerformanceMemoryLogRecord | null = null
    usePerformanceStore.setState((state) => {
      const baseline = state.memoryHistory[0] ?? snapshot
      const nextHistory = [...state.memoryHistory, snapshot]
      if (nextHistory.length > MEMORY_HISTORY_LIMIT) {
        nextHistory.splice(0, nextHistory.length - MEMORY_HISTORY_LIMIT)
      }

      const baselineRendererMb = baseline.rendererPrivateMb ?? baseline.rendererMb
      const currentRendererMb = snapshot.rendererPrivateMb ?? snapshot.rendererMb
      const rendererDeltaMb = Math.round((currentRendererMb - baselineRendererMb) * 10) / 10
      const rendererTotalDeltaMb = Math.round((snapshot.rendererTotalMb - baseline.rendererTotalMb) * 10) / 10
      const appDeltaMb = Math.round((snapshot.appMb - baseline.appMb) * 10) / 10
      const settingsState = contextStoreAccessors?.getSettingsState()
      const audioState = contextStoreAccessors?.getAudioState()
      const visibleScopes = settingsState
        ? settingsState.scopeOrder.filter((kind) => !settingsState.hiddenScopes.has(kind))
        : []
      const poppedOutScopes = settingsState
        ? settingsState.scopeOrder.filter((kind) => settingsState.scopePopouts[kind]?.poppedOut)
        : []

      logRecord = {
        ...snapshot,
        elapsedSeconds: Math.round(((snapshot.capturedAt - baseline.capturedAt) / 100)) / 10,
        rendererDeltaMb,
        rendererTotalDeltaMb,
        appDeltaMb,
        frameTarget: state.frameTarget,
        dockedRenderFps: state.dockedRenderFps,
        isCapturing: audioState?.isCapturing ?? false,
        captureStatus: audioState?.captureStatus ?? 'idle',
        visibleScopes,
        poppedOutScopes,
      }

      return {
        memorySample: snapshot,
        memoryHistory: nextHistory,
        rendererMemoryDeltaMb: rendererDeltaMb,
        appMemoryDeltaMb: appDeltaMb,
      }
    })

    if (logRecord && typeof window !== 'undefined' && typeof window.electronAPI?.appendPerformanceMemoryLog === 'function') {
      void window.electronAPI.appendPerformanceMemoryLog(logRecord)
    }
  } finally {
    memoryMonitorInFlight = false
  }
}

function ensureMemoryMonitor(): void {
  if (memoryMonitorTimer || !isMainWindowContext()) {
    return
  }

  void sampleMemory()
  memoryMonitorTimer = setInterval(() => {
    void sampleMemory()
  }, MEMORY_SAMPLE_INTERVAL_MS)
}

function releaseMemoryMonitor(): void {
  if (memoryMonitorRefCount > 0) {
    return
  }

  if (memoryMonitorTimer) {
    clearInterval(memoryMonitorTimer)
    memoryMonitorTimer = null
  }
}

export const usePerformanceStore = create<PerformanceState>((set) => ({
  frameTarget: storedPreferences.frameTarget,
  dockedRenderFps: 0,
  memorySample: null,
  memoryHistory: [],
  rendererMemoryDeltaMb: 0,
  appMemoryDeltaMb: 0,

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

  startMemoryMonitoring: () => {
    memoryMonitorRefCount += 1
    ensureMemoryMonitor()
  },

  stopMemoryMonitoring: () => {
    memoryMonitorRefCount = Math.max(0, memoryMonitorRefCount - 1)
    releaseMemoryMonitor()
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

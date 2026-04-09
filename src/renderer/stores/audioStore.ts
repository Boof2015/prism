import { create } from 'zustand'
import { audioCapture, type CaptureManagerStatus } from '../audio/AudioCapture'
import type {
  CaptureBackendKind,
  CaptureBackendSupport,
  CaptureMode,
  CaptureSourceDescriptor,
} from '../../types/capture'
import { useUiStore } from './uiStore'

const STORAGE_KEY = 'prism:audio'
const INPUT_GAIN_MIN_DB = -12
const INPUT_GAIN_MAX_DB = 12
const INPUT_GAIN_STEP_DB = 0.5

export interface PersistedAudioState {
  inputGainDb: number
}

interface AudioState {
  systemSources: CaptureSourceDescriptor[]
  devices: MediaDeviceInfo[]
  selectedSystemSourceId: string | null
  selectedDeviceId: string | null
  captureMode: CaptureMode
  activeBackendKind: CaptureBackendKind | null
  backendSupport: CaptureBackendSupport | null
  isCapturing: boolean
  captureStatus: 'idle' | 'connecting' | 'capturing' | 'error'
  captureError: string | null
  captureNotice: string | null
  sampleRate: number
  channelCount: number
  inputGainDb: number
  setInputGain: (db: number) => void
  clearCaptureNotice: () => void
  refreshSystemSources: () => Promise<void>
  refreshDevices: () => Promise<void>
  refreshBackendSupport: () => Promise<void>
  selectSystemSource: (sourceId: string | null) => Promise<void>
  selectDevice: (deviceId: string | null) => Promise<void>
  setCaptureMode: (mode: CaptureMode) => void
  startCapture: () => Promise<void>
  stopCapture: () => void
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function applyCaptureStatus(status: CaptureManagerStatus): Partial<AudioState> {
  return {
    captureMode: status.captureMode,
    activeBackendKind: status.activeBackendKind,
    backendSupport: status.backendSupport,
    sampleRate: status.sampleRate,
    channelCount: status.channelCount,
    isCapturing: status.isCapturing,
  }
}

function buildSystemCaptureFallbackMessage(reason: string | null): string {
  if (!reason) {
    return 'System output capture is unavailable. Prism switched to Default Input.'
  }

  return `System output capture is unavailable: ${reason} Prism switched to Default Input.`
}

function showSystemCaptureFallbackBanner(message: string): void {
  useUiStore.getState().showBanner({
    tone: 'info',
    message,
    actions: [],
  })
}

function describeInputDevice(deviceId: string, devices: MediaDeviceInfo[]): string {
  const matchingDevice = devices.find((device) => device.deviceId === deviceId)
  if (matchingDevice?.label) {
    return matchingDevice.label
  }

  return `Input ${deviceId.slice(0, 8)}`
}

function describeSystemSource(sourceId: string, sources: CaptureSourceDescriptor[]): string {
  return sources.find((source) => source.id === sourceId)?.label ?? 'The selected output device'
}

function getStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  return localStorage
}

export function normalizeInputGainDb(raw: unknown): number {
  const normalized = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  const clamped = Math.min(INPUT_GAIN_MAX_DB, Math.max(INPUT_GAIN_MIN_DB, normalized))
  const rounded = Math.round(clamped / INPUT_GAIN_STEP_DB) * INPUT_GAIN_STEP_DB
  return Object.is(rounded, -0) ? 0 : rounded
}

export function normalizeAudioPreferences(raw: unknown): PersistedAudioState {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PersistedAudioState>
    : {}

  return {
    inputGainDb: normalizeInputGainDb(parsed.inputGainDb),
  }
}

export function loadAudioPreferences(storage = getStorage()): PersistedAudioState {
  if (!storage) {
    return normalizeAudioPreferences(null)
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      return normalizeAudioPreferences(null)
    }

    return normalizeAudioPreferences(JSON.parse(raw))
  } catch {
    return normalizeAudioPreferences(null)
  }
}

function persistAudioPreferences(inputGainDb: number, storage = getStorage()): void {
  if (!storage) return

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ inputGainDb }))
  } catch {
    // Ignore localStorage write failures.
  }
}

const storedPreferences = loadAudioPreferences()
audioCapture.setInputGain(storedPreferences.inputGainDb)

export const useAudioStore = create<AudioState>((set, get) => ({
  systemSources: [],
  devices: [],
  selectedSystemSourceId: audioCapture.getSelectedSystemSourceId(),
  selectedDeviceId: null,
  captureMode: 'system',
  activeBackendKind: null,
  backendSupport: null,
  isCapturing: false,
  captureStatus: 'idle',
  captureError: null,
  captureNotice: null,
  sampleRate: 48000,
  channelCount: 2,
  inputGainDb: storedPreferences.inputGainDb,

  setInputGain: (db: number) => {
    const nextInputGainDb = normalizeInputGainDb(db)
    if (get().inputGainDb === nextInputGainDb) {
      return
    }

    persistAudioPreferences(nextInputGainDb)
    audioCapture.setInputGain(nextInputGainDb)
    set({ inputGainDb: nextInputGainDb })
  },

  clearCaptureNotice: () => {
    set({ captureNotice: null })
  },

  refreshSystemSources: async () => {
    const previousSelectedSystemSourceId = get().selectedSystemSourceId
    const previousSources = get().systemSources
    const systemSources = await audioCapture.listSources('system')
    const fallbackSourceId = systemSources[0]?.id ?? null
    const nextSelectedSystemSourceId = previousSelectedSystemSourceId
      && systemSources.some((source) => source.id === previousSelectedSystemSourceId)
      ? previousSelectedSystemSourceId
      : fallbackSourceId
    const shouldShowFallbackNotice = Boolean(
      previousSelectedSystemSourceId
      && previousSelectedSystemSourceId !== nextSelectedSystemSourceId
      && get().captureMode === 'system',
    )

    audioCapture.setSelectedSystemSourceId(nextSelectedSystemSourceId)
    set((state) => ({
      ...state,
      systemSources,
      selectedSystemSourceId: nextSelectedSystemSourceId,
      captureNotice: shouldShowFallbackNotice
        ? `${describeSystemSource(previousSelectedSystemSourceId!, previousSources)} is unavailable. Prism switched to Default Output.`
        : state.captureNotice,
    }))
  },

  refreshDevices: async () => {
    const previousSelectedDeviceId = get().selectedDeviceId
    const previousDevices = get().devices
    const devices = await audioCapture.listDevices()
    const nextSelectedDeviceId = previousSelectedDeviceId
      && devices.some((device) => device.deviceId === previousSelectedDeviceId)
      ? previousSelectedDeviceId
      : null
    const shouldShowFallbackNotice = Boolean(
      previousSelectedDeviceId
      && previousSelectedDeviceId !== nextSelectedDeviceId
      && get().captureMode === 'device',
    )

    audioCapture.setSelectedDeviceId(nextSelectedDeviceId)
    set((state) => ({
      ...state,
      devices,
      selectedDeviceId: nextSelectedDeviceId,
      captureNotice: shouldShowFallbackNotice
        ? `${describeInputDevice(previousSelectedDeviceId!, previousDevices)} is unavailable. Prism switched to Default Input.`
        : state.captureNotice,
    }))
  },

  refreshBackendSupport: async () => {
    const backendSupport = await audioCapture.refreshBackendSupport()
    set({ backendSupport })
    await get().refreshSystemSources()
  },

  selectSystemSource: async (sourceId: string | null) => {
    audioCapture.setSelectedSystemSourceId(sourceId)
    audioCapture.setCaptureMode('system')
    set({
      selectedSystemSourceId: audioCapture.getSelectedSystemSourceId(),
      captureMode: 'system',
      captureError: null,
      captureNotice: null,
    })
  },

  selectDevice: async (deviceId: string | null) => {
    audioCapture.setSelectedDeviceId(deviceId)
    audioCapture.setCaptureMode('device')
    set({
      selectedDeviceId: deviceId,
      captureMode: 'device',
      captureError: null,
      captureNotice: null,
    })
  },

  setCaptureMode: (mode: CaptureMode) => {
    audioCapture.setCaptureMode(mode)
    set({ captureMode: mode })
  },

  startCapture: async () => {
    set({ captureStatus: 'connecting', captureError: null })
    try {
      const { captureMode } = get()
      audioCapture.setCaptureMode(captureMode)
      await get().refreshBackendSupport()
      await get().refreshDevices()

      const { selectedDeviceId, selectedSystemSourceId, backendSupport } = get()

      const startDefaultInputFallback = async (reason: string | null): Promise<void> => {
        const message = buildSystemCaptureFallbackMessage(reason)
        audioCapture.setSelectedDeviceId(null)
        audioCapture.setCaptureMode('device')
        set({
          selectedDeviceId: null,
          captureMode: 'device',
          captureNotice: message,
        })
        showSystemCaptureFallbackBanner(message)
        await audioCapture.startDevice(undefined)
      }

      if (captureMode === 'system') {
        if (!backendSupport?.nativeBackend.available) {
          await startDefaultInputFallback(backendSupport?.nativeBackend.reason ?? null)
        } else {
          try {
            await audioCapture.startSystemAudio(selectedSystemSourceId ?? undefined)
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Native system capture failed.'
            await startDefaultInputFallback(reason)
          }
        }
      } else {
        await audioCapture.startDevice(selectedDeviceId ?? undefined)
      }

      const status = audioCapture.getStatus()
      set((state) => ({
        ...state,
        ...applyCaptureStatus(status),
        captureStatus: 'capturing',
        captureError: null,
      }))
    } catch (err) {
      console.error('Failed to start audio capture:', err)
      const message = err instanceof Error ? err.message : 'Unknown audio capture error'
      set({
        isCapturing: false,
        captureStatus: 'error',
        captureError: message,
      })
    }
  },

  stopCapture: () => {
    audioCapture.stop()
    set({ isCapturing: false, captureStatus: 'idle', captureError: null })
  },
}))

audioCapture.subscribeStatus((status) => {
  useAudioStore.setState((state) => ({
    ...state,
    ...applyCaptureStatus(status),
  }))
})

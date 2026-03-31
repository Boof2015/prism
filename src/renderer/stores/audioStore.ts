import { create } from 'zustand'
import { audioCapture, type CaptureManagerStatus } from '../audio/AudioCapture'
import type {
  CaptureBackendKind,
  CaptureBackendPolicy,
  CaptureBackendSupport,
  CaptureMode,
  CaptureSourceDescriptor,
} from '../../types/capture'

interface AudioState {
  systemSources: CaptureSourceDescriptor[]
  devices: MediaDeviceInfo[]
  selectedSystemSourceId: string | null
  selectedDeviceId: string | null
  captureMode: CaptureMode
  capturePolicy: CaptureBackendPolicy
  activeBackendKind: CaptureBackendKind | null
  activeBackendReason: string | null
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
  setCapturePolicy: (policy: CaptureBackendPolicy) => Promise<void>
  startCapture: () => Promise<void>
  stopCapture: () => void
}

function applyCaptureStatus(status: CaptureManagerStatus): Partial<AudioState> {
  return {
    captureMode: status.captureMode,
    capturePolicy: status.backendPolicy,
    activeBackendKind: status.activeBackendKind,
    activeBackendReason: status.activeBackendReason,
    backendSupport: status.backendSupport,
    sampleRate: status.sampleRate,
    channelCount: status.channelCount,
    isCapturing: status.isCapturing,
  }
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

export const useAudioStore = create<AudioState>((set, get) => ({
  systemSources: [],
  devices: [],
  selectedSystemSourceId: audioCapture.getSelectedSystemSourceId(),
  selectedDeviceId: null,
  captureMode: 'system',
  capturePolicy: 'auto',
  activeBackendKind: null,
  activeBackendReason: null,
  backendSupport: null,
  isCapturing: false,
  captureStatus: 'idle',
  captureError: null,
  captureNotice: null,
  sampleRate: 48000,
  channelCount: 2,
  inputGainDb: 0,

  setInputGain: (db: number) => {
    audioCapture.setInputGain(db)
    set({ inputGainDb: db })
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

  setCapturePolicy: async (policy: CaptureBackendPolicy) => {
    audioCapture.setBackendPolicy(policy)
    set({ capturePolicy: policy })
    await get().refreshBackendSupport()

    const { isCapturing, captureMode } = get()
    if (isCapturing && captureMode === 'system') {
      await get().startCapture()
    }
  },

  startCapture: async () => {
    set({ captureStatus: 'connecting', captureError: null })
    try {
      const { captureMode, capturePolicy } = get()
      audioCapture.setCaptureMode(captureMode)
      audioCapture.setBackendPolicy(capturePolicy)
      await get().refreshBackendSupport()
      await get().refreshDevices()

      const { selectedDeviceId, selectedSystemSourceId } = get()

      if (captureMode === 'system') {
        await audioCapture.startSystemAudio(selectedSystemSourceId ?? undefined)
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

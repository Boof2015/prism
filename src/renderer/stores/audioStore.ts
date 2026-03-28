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
  sampleRate: number
  channelCount: number
  inputGainDb: number
  setInputGain: (db: number) => void
  refreshSystemSources: () => Promise<void>
  refreshDevices: () => Promise<void>
  refreshBackendSupport: () => Promise<void>
  selectSystemSource: (sourceId: string | null) => Promise<void>
  selectDevice: (deviceId: string) => Promise<void>
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
  sampleRate: 48000,
  channelCount: 2,
  inputGainDb: 0,

  setInputGain: (db: number) => {
    audioCapture.setInputGain(db)
    set({ inputGainDb: db })
  },

  refreshSystemSources: async () => {
    const systemSources = await audioCapture.listSources('system')
    const fallbackSourceId = systemSources[0]?.id ?? null
    const currentSelectedSystemSourceId = get().selectedSystemSourceId
    const nextSelectedSystemSourceId = currentSelectedSystemSourceId && systemSources.some((source) => source.id === currentSelectedSystemSourceId)
      ? currentSelectedSystemSourceId
      : fallbackSourceId

    audioCapture.setSelectedSystemSourceId(nextSelectedSystemSourceId)
    set({
      systemSources,
      selectedSystemSourceId: nextSelectedSystemSourceId,
    })
  },

  refreshDevices: async () => {
    const devices = await audioCapture.listDevices()
    set({ devices })
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
    })
  },

  selectDevice: async (deviceId: string) => {
    audioCapture.setSelectedDeviceId(deviceId)
    audioCapture.setCaptureMode('device')
    set({ selectedDeviceId: deviceId, captureMode: 'device' })
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

      const { selectedDeviceId, selectedSystemSourceId } = get()

      if (captureMode === 'system') {
        await audioCapture.startSystemAudio(selectedSystemSourceId ?? undefined)
      } else {
        await audioCapture.startDevice(selectedDeviceId ?? undefined)
      }

      const status = audioCapture.getStatus()
      set({
        ...applyCaptureStatus(status),
        captureStatus: 'capturing',
        captureError: null,
      })
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

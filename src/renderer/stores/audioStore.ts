import { create } from 'zustand'
import { audioCapture, type CaptureMode } from '../audio/AudioCapture'

interface AudioState {
  devices: MediaDeviceInfo[]
  selectedDeviceId: string | null
  captureMode: CaptureMode
  isCapturing: boolean
  captureStatus: 'idle' | 'connecting' | 'capturing' | 'error'
  captureError: string | null
  sampleRate: number
  refreshDevices: () => Promise<void>
  selectDevice: (deviceId: string) => Promise<void>
  setCaptureMode: (mode: CaptureMode) => void
  startCapture: () => Promise<void>
  stopCapture: () => void
}

export const useAudioStore = create<AudioState>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  captureMode: 'system',
  isCapturing: false,
  captureStatus: 'idle',
  captureError: null,
  sampleRate: 48000,

  refreshDevices: async () => {
    const devices = await audioCapture.listDevices()
    set({ devices })
  },

  selectDevice: async (deviceId: string) => {
    set({ selectedDeviceId: deviceId, captureMode: 'device' })
    audioCapture.setSelectedDeviceId(deviceId)
  },

  setCaptureMode: (mode: CaptureMode) => {
    set({ captureMode: mode })
  },

  startCapture: async () => {
    set({ captureStatus: 'connecting', captureError: null })
    try {
      const { captureMode, selectedDeviceId } = get()
      if (captureMode === 'system') {
        await audioCapture.start()
      } else {
        await audioCapture.startDevice(selectedDeviceId ?? undefined)
      }
      set({
        isCapturing: true,
        captureStatus: 'capturing',
        captureError: null,
        sampleRate: audioCapture.getSampleRate(),
        captureMode: audioCapture.getCaptureMode(),
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

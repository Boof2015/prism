import { create } from 'zustand'
import { audioCapture, type CaptureMode } from '../audio/AudioCapture'

interface AudioState {
  devices: MediaDeviceInfo[]
  selectedDeviceId: string | null
  captureMode: CaptureMode
  isCapturing: boolean
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
  sampleRate: 48000,

  refreshDevices: async () => {
    const devices = await audioCapture.listDevices()
    set({ devices })
  },

  selectDevice: async (deviceId: string) => {
    set({ selectedDeviceId: deviceId, captureMode: 'device' })
    audioCapture.setSelectedDeviceId(deviceId)

    // If currently capturing, restart with new device
    if (get().isCapturing) {
      await get().startCapture()
    }
  },

  setCaptureMode: (mode: CaptureMode) => {
    set({ captureMode: mode })
  },

  startCapture: async () => {
    try {
      const { captureMode, selectedDeviceId } = get()
      if (captureMode === 'system') {
        await audioCapture.startSystemAudio()
      } else {
        await audioCapture.startDevice(selectedDeviceId ?? undefined)
      }
      set({
        isCapturing: true,
        sampleRate: audioCapture.getSampleRate(),
        captureMode: audioCapture.getCaptureMode(),
      })
    } catch (err) {
      console.error('Failed to start audio capture:', err)
      set({ isCapturing: false })
    }
  },

  stopCapture: () => {
    audioCapture.stop()
    set({ isCapturing: false })
  },
}))

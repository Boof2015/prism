import assert from 'node:assert/strict'
import test from 'node:test'
import { audioCapture } from '../src/renderer/audio/AudioCapture'
import { useAudioStore } from '../src/renderer/stores/audioStore'
import { useUiStore } from '../src/renderer/stores/uiStore'
import type { CaptureBackendSupport } from '../src/types/capture'

const initialAudioState = {
  ...useAudioStore.getState(),
}

const initialUiState = {
  ...useUiStore.getState(),
}

function createBackendSupport(available: boolean, reason: string | null): CaptureBackendSupport {
  return {
    nativeBackend: {
      kind: 'native-linux',
      available,
      reason,
    },
    deviceInput: {
      kind: 'device-input',
      available: true,
      reason: null,
    },
  }
}

function resetStores(): void {
  useAudioStore.setState({
    ...initialAudioState,
    systemSources: [],
    devices: [],
    selectedSystemSourceId: '__default_system_output__',
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
    inputGainDb: 0,
  })

  useUiStore.setState({
    ...initialUiState,
    banner: null,
    settingsOpen: false,
  })
}

function installAudioCaptureHarness(options: {
  support: CaptureBackendSupport
  startSystemAudio?: (deviceId?: string) => Promise<void>
}): { restore: () => void; calls: { startSystemAudio: number; startDevice: number } } {
  const originalMethods = {
    refreshBackendSupport: audioCapture.refreshBackendSupport,
    listSources: audioCapture.listSources,
    listDevices: audioCapture.listDevices,
    startSystemAudio: audioCapture.startSystemAudio,
    startDevice: audioCapture.startDevice,
    getStatus: audioCapture.getStatus,
    setCaptureMode: audioCapture.setCaptureMode,
    setSelectedDeviceId: audioCapture.setSelectedDeviceId,
    setSelectedSystemSourceId: audioCapture.setSelectedSystemSourceId,
  }

  const calls = {
    startSystemAudio: 0,
    startDevice: 0,
  }

  let captureMode: 'system' | 'device' = 'system'
  let selectedDeviceId: string | null = null
  let selectedSystemSourceId = '__default_system_output__'
  let activeBackendKind: 'device-input' | 'native-linux' | null = null
  let isCapturing = false

  audioCapture.refreshBackendSupport = async () => options.support
  audioCapture.listSources = async () => [
    { id: '__default_system_output__', label: 'Default Output', kind: 'system', isDefault: true },
  ]
  audioCapture.listDevices = async () => []
  audioCapture.startSystemAudio = async (deviceId?: string) => {
    calls.startSystemAudio += 1
    if (options.startSystemAudio) {
      await options.startSystemAudio(deviceId)
    } else {
      captureMode = 'system'
      activeBackendKind = 'native-linux'
      isCapturing = true
    }
  }
  audioCapture.startDevice = async (deviceId?: string) => {
    calls.startDevice += 1
    captureMode = 'device'
    selectedDeviceId = deviceId ?? null
    activeBackendKind = 'device-input'
    isCapturing = true
  }
  audioCapture.getStatus = () => ({
    captureMode,
    activeBackendKind,
    backendSupport: options.support,
    sampleRate: 48000,
    channelCount: 2,
    isCapturing,
  })
  audioCapture.setCaptureMode = (mode) => {
    captureMode = mode
  }
  audioCapture.setSelectedDeviceId = (id) => {
    selectedDeviceId = id
  }
  audioCapture.setSelectedSystemSourceId = (id) => {
    selectedSystemSourceId = id ?? '__default_system_output__'
  }

  return {
    restore: () => {
      audioCapture.refreshBackendSupport = originalMethods.refreshBackendSupport
      audioCapture.listSources = originalMethods.listSources
      audioCapture.listDevices = originalMethods.listDevices
      audioCapture.startSystemAudio = originalMethods.startSystemAudio
      audioCapture.startDevice = originalMethods.startDevice
      audioCapture.getStatus = originalMethods.getStatus
      audioCapture.setCaptureMode = originalMethods.setCaptureMode
      audioCapture.setSelectedDeviceId = originalMethods.setSelectedDeviceId
      audioCapture.setSelectedSystemSourceId = originalMethods.setSelectedSystemSourceId

      void selectedDeviceId
      void selectedSystemSourceId
    },
    calls,
  }
}

test('audio store auto-switches to device input when native system capture is unavailable on startup', async () => {
  resetStores()
  const harness = installAudioCaptureHarness({
    support: createBackendSupport(false, 'PulseAudio is unavailable.'),
  })

  try {
    await useAudioStore.getState().startCapture()

    const state = useAudioStore.getState()
    assert.equal(harness.calls.startSystemAudio, 0)
    assert.equal(harness.calls.startDevice, 1)
    assert.equal(state.captureMode, 'device')
    assert.equal(state.captureStatus, 'capturing')
    assert.equal(state.captureError, null)
    assert.equal(state.activeBackendKind, 'device-input')
    assert.match(state.captureNotice ?? '', /switched to Default Input/i)

    const banner = useUiStore.getState().banner
    assert.ok(banner)
    assert.equal(banner?.tone, 'info')
    assert.match(banner?.message ?? '', /PulseAudio is unavailable/i)
  } finally {
    harness.restore()
    resetStores()
  }
})

test('audio store falls back to device input when native system capture fails at start time', async () => {
  resetStores()
  const harness = installAudioCaptureHarness({
    support: createBackendSupport(true, null),
    startSystemAudio: async () => {
      throw new Error('PulseAudio monitor stream failed.')
    },
  })

  try {
    await useAudioStore.getState().startCapture()

    const state = useAudioStore.getState()
    assert.equal(harness.calls.startSystemAudio, 1)
    assert.equal(harness.calls.startDevice, 1)
    assert.equal(state.captureMode, 'device')
    assert.equal(state.captureStatus, 'capturing')
    assert.equal(state.captureError, null)
    assert.match(state.captureNotice ?? '', /PulseAudio monitor stream failed/i)

    const banner = useUiStore.getState().banner
    assert.ok(banner)
    assert.match(banner?.message ?? '', /PulseAudio monitor stream failed/i)
  } finally {
    harness.restore()
    resetStores()
  }
})

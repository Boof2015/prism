import assert from 'node:assert/strict'
import test from 'node:test'
import { audioCapture } from '../src/renderer/audio/AudioCapture'
import {
  loadAudioPreferences,
  normalizeAudioPreferences,
  useAudioStore,
} from '../src/renderer/stores/audioStore'
import { useUiStore } from '../src/renderer/stores/uiStore'
import type { CaptureBackendSupport } from '../src/types/capture'

type GlobalWithStorage = typeof globalThis & {
  localStorage?: Storage
}

const initialAudioState = {
  ...useAudioStore.getState(),
}

const initialUiState = {
  ...useUiStore.getState(),
}

function installFakeLocalStorage(): {
  getSetCount: () => number
  getItem: (key: string) => string | null
  restore: () => void
} {
  const storage = new Map<string, string>()
  let setCount = 0
  const globalWithStorage = globalThis as GlobalWithStorage
  const previousLocalStorage = globalWithStorage.localStorage

  globalWithStorage.localStorage = {
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      setCount += 1
      storage.set(key, value)
    },
    removeItem(key: string): void {
      storage.delete(key)
    },
    clear(): void {
      storage.clear()
    },
    key(index: number): string | null {
      return [...storage.keys()][index] ?? null
    },
    get length(): number {
      return storage.size
    },
  } as Storage

  return {
    getSetCount: () => setCount,
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    restore(): void {
      if (previousLocalStorage === undefined) {
        delete globalWithStorage.localStorage
        return
      }

      globalWithStorage.localStorage = previousLocalStorage
    },
  }
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
  audioCapture.setInputGain(0)
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
    setInputGain: audioCapture.setInputGain,
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
      audioCapture.setInputGain = originalMethods.setInputGain

      void selectedDeviceId
      void selectedSystemSourceId
    },
    calls,
  }
}

test('loadAudioPreferences falls back to 0 dB when storage is unavailable', () => {
  assert.deepEqual(loadAudioPreferences(null), { inputGainDb: 0 })
})

test('loadAudioPreferences falls back to 0 dB when stored JSON is invalid', () => {
  const storage = {
    getItem: () => '{not valid json',
    setItem: () => {},
  }

  assert.deepEqual(loadAudioPreferences(storage), { inputGainDb: 0 })
})

test('normalizeAudioPreferences clamps out-of-range trim values', () => {
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: -18 }), { inputGainDb: -12 })
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 18 }), { inputGainDb: 12 })
})

test('normalizeAudioPreferences rounds trim values to 0.5 dB steps', () => {
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 6.24 }), { inputGainDb: 6 })
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 6.26 }), { inputGainDb: 6.5 })
})

test('audio store persists normalized trim values and forwards them to audioCapture', () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const originalSetInputGain = audioCapture.setInputGain
  const forwardedValues: number[] = []

  audioCapture.setInputGain = (db: number) => {
    forwardedValues.push(db)
  }

  try {
    useAudioStore.getState().setInputGain(6.26)

    assert.equal(useAudioStore.getState().inputGainDb, 6.5)
    assert.deepEqual(forwardedValues, [6.5])
    assert.equal(fakeStorage.getItem('prism:audio'), JSON.stringify({ inputGainDb: 6.5 }))
    assert.equal(fakeStorage.getSetCount(), 1)

    useAudioStore.getState().setInputGain(6.49)

    assert.deepEqual(forwardedValues, [6.5])
    assert.equal(fakeStorage.getSetCount(), 1)

    useAudioStore.getState().setInputGain(0)

    assert.equal(useAudioStore.getState().inputGainDb, 0)
    assert.deepEqual(forwardedValues, [6.5, 0])
    assert.equal(fakeStorage.getItem('prism:audio'), JSON.stringify({ inputGainDb: 0 }))
    assert.equal(fakeStorage.getSetCount(), 2)
  } finally {
    audioCapture.setInputGain = originalSetInputGain
    fakeStorage.restore()
    resetStores()
  }
})

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

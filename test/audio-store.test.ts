import assert from 'node:assert/strict'
import test from 'node:test'
import { audioCapture } from '../src/renderer/audio/AudioCapture'
import {
  loadAudioPreferences,
  normalizeAudioPreferences,
  normalizeRollingCaptureSeconds,
  startAudioDeviceWatcher,
  useAudioStore,
  type PersistedAudioState,
} from '../src/renderer/stores/audioStore'
import { useUiStore } from '../src/renderer/stores/uiStore'
import type { CaptureBackendSupport, CaptureSourceDescriptor } from '../src/types/capture'
import {
  createDefaultCaptureChannelRouting,
  getCaptureRoutingStorageKey,
  normalizeCaptureChannelRouting,
} from '../src/types/capture'

type GlobalWithStorage = typeof globalThis & {
  localStorage?: Storage
}

type StartDeviceOptions = {
  forceDeviceRestart?: boolean
  channelRouting?: { left: number; right: number }
}

type HarnessSourceProvider<T> = T[] | (() => T[] | Promise<T[]>)

const DEFAULT_SYSTEM_SOURCE_ID = '__default_system_output__'

function audioPreferences(overrides: Partial<PersistedAudioState> = {}): PersistedAudioState {
  return {
    inputGainDb: 0,
    captureMode: 'system',
    selectedSystemSourceId: DEFAULT_SYSTEM_SOURCE_ID,
    selectedDeviceId: null,
    selectedDawSourceId: null,
    rollingCaptureSeconds: null,
    channelRoutingBySource: {},
    ...overrides,
  }
}

function storedAudioPreferences(overrides: Partial<PersistedAudioState> = {}): string {
  return JSON.stringify(audioPreferences(overrides))
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
    dawBridge: {
      kind: 'daw-bridge',
      available: true,
      reason: null,
    },
  }
}

function defaultSystemSource(): CaptureSourceDescriptor {
  return {
    id: DEFAULT_SYSTEM_SOURCE_ID,
    label: 'Default Output',
    kind: 'system',
    isDefault: true,
  }
}

function systemSource(
  id: string,
  label: string,
  isDefault = false,
): CaptureSourceDescriptor {
  return {
    id,
    label,
    kind: 'system',
    isDefault,
    sampleRate: 48000,
    channelCount: 2,
  }
}

function mediaDevice(deviceId: string, label: string, isDefault = false): CaptureSourceDescriptor {
  return {
    id: deviceId,
    kind: 'device',
    label,
    isDefault,
    sampleRate: 48000,
    channelCount: 2,
    channels: [
      { index: 0, label: 'Channel 1' },
      { index: 1, label: 'Channel 2' },
    ],
    channelRoutingAvailable: false,
  }
}

function getDefaultSystemSourceId(sources: CaptureSourceDescriptor[]): string | null {
  return sources.find((source) => source.id !== DEFAULT_SYSTEM_SOURCE_ID && source.isDefault)?.id ?? null
}

function getDefaultInputDeviceId(devices: CaptureSourceDescriptor[]): string | null {
  return devices.find((device) => device.id !== 'default' && device.isDefault)?.id
    ?? devices.find((device) => device.id !== 'default')?.id
    ?? devices[0]?.id
    ?? null
}

async function resolveHarnessSources<T>(provider: HarnessSourceProvider<T> | undefined, fallback: T[]): Promise<T[]> {
  if (!provider) {
    return fallback
  }

  return typeof provider === 'function'
    ? provider()
    : provider
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await flushPromises()
}

function installFakeDeviceWatcherEnvironment(): {
  dispatchDeviceChange: () => void
  getIntervalCount: () => number
  getListenerCount: () => number
  runIntervals: () => void
  restore: () => void
} {
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: Window
    navigator?: Navigator
  }
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const intervals = new Map<number, () => void>()
  const deviceChangeListeners = new Set<() => void>()
  let nextIntervalId = 1

  const fakeWindow = {
    setInterval(callback: () => void): number {
      const id = nextIntervalId
      nextIntervalId += 1
      intervals.set(id, callback)
      return id
    },
    clearInterval(id: number): void {
      intervals.delete(id)
    },
  } as unknown as Window

  const fakeMediaDevices = {
    addEventListener(type: string, listener: EventListener): void {
      if (type === 'devicechange') {
        deviceChangeListeners.add(listener as () => void)
      }
    },
    removeEventListener(type: string, listener: EventListener): void {
      if (type === 'devicechange') {
        deviceChangeListeners.delete(listener as () => void)
      }
    },
    enumerateDevices: async () => [],
  } as unknown as MediaDevices

  const fakeNavigator = {
    mediaDevices: fakeMediaDevices,
  } as Navigator

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: fakeNavigator,
  })

  return {
    dispatchDeviceChange(): void {
      for (const listener of deviceChangeListeners) {
        listener()
      }
    },
    getIntervalCount(): number {
      return intervals.size
    },
    getListenerCount(): number {
      return deviceChangeListeners.size
    },
    runIntervals(): void {
      for (const callback of [...intervals.values()]) {
        callback()
      }
    },
    restore(): void {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', previousWindowDescriptor)
      } else {
        delete globalWithWindow.window
      }

      if (previousNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
      } else {
        delete globalWithWindow.navigator
      }
    },
  }
}

function resetStores(): void {
  audioCapture.setSelectedSystemSourceId(DEFAULT_SYSTEM_SOURCE_ID)
  audioCapture.setSelectedDeviceId(null)
  audioCapture.setSelectedDawSourceId(null)
  audioCapture.setCaptureMode('system')
  audioCapture.setInputGain(0)
  audioCapture.setRollingCaptureSeconds(null)
  useAudioStore.setState({
    ...initialAudioState,
    systemSources: [],
    devices: [],
    selectedSystemSourceId: '__default_system_output__',
    selectedDeviceId: null,
    selectedDawSourceId: null,
    dawSources: [],
    captureMode: 'system',
    activeBackendKind: null,
    backendSupport: null,
    isCapturing: false,
    captureStatus: 'idle',
    captureError: null,
    captureNotice: null,
    sampleRate: 48000,
    channelCount: 2,
    sourceChannelCount: 2,
    channelRoutingAvailable: false,
    activeChannelRouting: { left: 0, right: 1 },
    channelRoutingBySource: {},
    activeSourceId: null,
    activeSourceLabel: null,
    inputGainDb: 0,
    rollingCaptureSeconds: null,
    rollingCaptureStatus: audioCapture.getRollingCaptureStatus(),
  })

  useUiStore.setState({
    ...initialUiState,
    banner: null,
    settingsOpen: false,
  })
}

function installAudioCaptureHarness(options: {
  support: CaptureBackendSupport
  systemSources?: HarnessSourceProvider<CaptureSourceDescriptor>
  devices?: HarnessSourceProvider<CaptureSourceDescriptor>
  startSystemAudio?: (deviceId?: string) => Promise<void>
  startDevice?: (deviceId?: string, options?: StartDeviceOptions) => Promise<void>
}): {
  restore: () => void
  calls: {
    listDevices: number
    listSources: number
    startDevice: number
    startDeviceRequests: Array<{ deviceId: string | null; forceDeviceRestart: boolean }>
    startSystemAudio: number
    startSystemAudioDeviceIds: Array<string | undefined>
  }
} {
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
    listDevices: 0,
    listSources: 0,
    startSystemAudio: 0,
    startDevice: 0,
    startSystemAudioDeviceIds: [] as Array<string | undefined>,
    startDeviceRequests: [] as Array<{ deviceId: string | null; forceDeviceRestart: boolean }>,
  }

  let captureMode: 'system' | 'device' = 'system'
  let selectedDeviceId: string | null = null
  let selectedSystemSourceId = DEFAULT_SYSTEM_SOURCE_ID
  let activeBackendKind: 'device-input' | 'native-linux' | null = null
  let isCapturing = false
  let activeSourceId: string | null = null
  let activeSourceLabel: string | null = null

  audioCapture.refreshBackendSupport = async () => options.support
  audioCapture.listSources = async () => {
    calls.listSources += 1
    return resolveHarnessSources(options.systemSources, [defaultSystemSource()])
  }
  audioCapture.listDevices = async () => {
    calls.listDevices += 1
    return resolveHarnessSources(options.devices, [])
  }
  audioCapture.startSystemAudio = async (deviceId?: string) => {
    calls.startSystemAudio += 1
    calls.startSystemAudioDeviceIds.push(deviceId)
    if (options.startSystemAudio) {
      await options.startSystemAudio(deviceId)
    } else {
      const systemSources = await resolveHarnessSources(options.systemSources, [defaultSystemSource()])
      const requestedSourceId = deviceId && deviceId !== DEFAULT_SYSTEM_SOURCE_ID
        ? deviceId
        : getDefaultSystemSourceId(systemSources)
      const requestedSource = systemSources.find((source) => source.id === requestedSourceId) ?? null
      captureMode = 'system'
      activeBackendKind = 'native-linux'
      activeSourceId = requestedSource?.id ?? null
      activeSourceLabel = requestedSource?.label ?? null
      isCapturing = true
    }
  }
  audioCapture.startDevice = async (deviceId?: string, startOptions?: StartDeviceOptions) => {
    calls.startDevice += 1
    calls.startDeviceRequests.push({
      deviceId: deviceId ?? null,
      forceDeviceRestart: startOptions?.forceDeviceRestart === true,
    })
    if (options.startDevice) {
      await options.startDevice(deviceId, startOptions)
    } else {
      const devices = await resolveHarnessSources(options.devices, [])
      const resolvedDeviceId = deviceId ?? getDefaultInputDeviceId(devices)
      const resolvedDevice = devices.find((device) => device.id === resolvedDeviceId) ?? null
      captureMode = 'device'
      selectedDeviceId = deviceId ?? null
      activeBackendKind = 'device-input'
      activeSourceId = resolvedDevice?.id ?? resolvedDeviceId
      activeSourceLabel = resolvedDevice?.label ?? null
      isCapturing = true
    }
  }
  audioCapture.getStatus = () => ({
    captureMode,
    activeBackendKind,
    backendSupport: options.support,
    sampleRate: 48000,
    channelCount: 2,
    sourceChannelCount: 2,
    channelRoutingAvailable: false,
    channelRouting: { left: 0, right: 1 },
    isCapturing,
    activeSourceId: isCapturing ? activeSourceId : null,
    activeSourceLabel: isCapturing ? activeSourceLabel : null,
    waiting: false,
  })
  audioCapture.setCaptureMode = (mode) => {
    captureMode = mode
  }
  audioCapture.setSelectedDeviceId = (id) => {
    selectedDeviceId = id
  }
  audioCapture.setSelectedSystemSourceId = (id) => {
    selectedSystemSourceId = id ?? DEFAULT_SYSTEM_SOURCE_ID
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
  assert.deepEqual(loadAudioPreferences(null), audioPreferences())
})

test('loadAudioPreferences falls back to 0 dB when stored JSON is invalid', () => {
  const storage = {
    getItem: () => '{not valid json',
    setItem: () => {},
  }

  assert.deepEqual(loadAudioPreferences(storage), audioPreferences())
})

test('loadAudioPreferences keeps legacy trim-only preferences compatible', () => {
  const storage = {
    getItem: () => JSON.stringify({ inputGainDb: 6.26 }),
    setItem: () => {},
  }

  assert.deepEqual(loadAudioPreferences(storage), audioPreferences({ inputGainDb: 6.5 }))
})

test('normalizeAudioPreferences defaults invalid persisted selector values', () => {
  assert.deepEqual(normalizeAudioPreferences({
    inputGainDb: 3,
    captureMode: 'surround',
    selectedSystemSourceId: '',
    selectedDeviceId: '',
  }), audioPreferences({ inputGainDb: 3 }))
})

test('normalizeAudioPreferences preserves valid persisted selector values', () => {
  assert.deepEqual(normalizeAudioPreferences({
    inputGainDb: -3,
    captureMode: 'device',
    selectedSystemSourceId: 'speaker',
    selectedDeviceId: 'mic-1',
    rollingCaptureSeconds: 30,
  }), audioPreferences({
    inputGainDb: -3,
    captureMode: 'device',
    selectedSystemSourceId: 'speaker',
    selectedDeviceId: 'mic-1',
    rollingCaptureSeconds: 30,
  }))
})

test('normalizeAudioPreferences preserves DAW mode and its stable bridge UUID', () => {
  assert.deepEqual(normalizeAudioPreferences({
    captureMode: 'daw',
    selectedDawSourceId: 'bridge-stable-uuid',
  }), audioPreferences({
    captureMode: 'daw',
    selectedDawSourceId: 'bridge-stable-uuid',
  }))
})

test('channel routes default safely and allow one source to feed both sides', () => {
  assert.deepEqual(createDefaultCaptureChannelRouting(1), { left: 0, right: 0 })
  assert.deepEqual(createDefaultCaptureChannelRouting(16), { left: 0, right: 1 })
  assert.deepEqual(normalizeCaptureChannelRouting({ left: 7, right: 7 }, 16), {
    left: 7,
    right: 7,
  })
  assert.deepEqual(normalizeCaptureChannelRouting({ left: 99, right: -1 }, 2), {
    left: 0,
    right: 1,
  })
  assert.deepEqual(normalizeCaptureChannelRouting({ left: 1, right: 99 }, 2), {
    left: 0,
    right: 1,
  })
})

test('normalizeAudioPreferences keeps valid per-device routes and drops malformed entries', () => {
  assert.deepEqual(normalizeAudioPreferences({
    channelRoutingBySource: {
      'system:output-uid': { left: 7, right: 9 },
      'device:input-uid': { left: 3, right: 3 },
      broken: { left: -1, right: 2 },
    },
  }).channelRoutingBySource, {
    'system:output-uid': { left: 7, right: 9 },
    'device:input-uid': { left: 3, right: 3 },
  })
})

test('audio store persists routes by direction and physical device UID', () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const originalSetChannelRouting = audioCapture.setChannelRouting
  const forwarded: Array<{ left: number; right: number }> = []
  audioCapture.setChannelRouting = (routing) => {
    forwarded.push(routing)
    return routing
  }

  const output = {
    ...systemSource('output-uid', '16ch Output', true),
    channelCount: 16,
    channels: Array.from({ length: 16 }, (_, index) => ({ index, label: `Output ${index + 1}` })),
    channelRoutingAvailable: true,
  }
  const input = {
    ...mediaDevice('input-uid', '8ch Input', true),
    channelCount: 8,
    channels: Array.from({ length: 8 }, (_, index) => ({ index, label: `Input ${index + 1}` })),
    channelRoutingAvailable: true,
  }

  try {
    useAudioStore.setState({
      systemSources: [defaultSystemSource(), output],
      devices: [input],
      captureMode: 'system',
      selectedSystemSourceId: DEFAULT_SYSTEM_SOURCE_ID,
      isCapturing: true,
      activeSourceId: output.id,
    })
    useAudioStore.getState().setChannelRouting({ left: 7, right: 9 })

    useAudioStore.setState({
      captureMode: 'device',
      selectedDeviceId: null,
      activeSourceId: input.id,
    })
    useAudioStore.getState().setChannelRouting({ left: 3, right: 3 })

    const expectedRoutes = {
      [getCaptureRoutingStorageKey('system', output.id)]: { left: 7, right: 9 },
      [getCaptureRoutingStorageKey('device', input.id)]: { left: 3, right: 3 },
    }
    assert.deepEqual(useAudioStore.getState().channelRoutingBySource, expectedRoutes)
    assert.deepEqual(forwarded, [{ left: 7, right: 9 }, { left: 3, right: 3 }])
    assert.deepEqual(
      JSON.parse(fakeStorage.getItem('prism:audio') ?? '{}').channelRoutingBySource,
      expectedRoutes,
    )
  } finally {
    audioCapture.setChannelRouting = originalSetChannelRouting
    fakeStorage.restore()
    resetStores()
  }
})

test('normalizeRollingCaptureSeconds accepts only supported durations', () => {
  assert.equal(normalizeRollingCaptureSeconds(5), 5)
  assert.equal(normalizeRollingCaptureSeconds(60), 60)
  assert.equal(normalizeRollingCaptureSeconds(15), null)
  assert.equal(normalizeRollingCaptureSeconds('10'), null)
})

test('rolling capture opt-in does not allocate a buffer while capture is idle', () => {
  resetStores()
  try {
    audioCapture.setRollingCaptureSeconds(60)

    const enabledStatus = audioCapture.getRollingCaptureStatus()
    assert.equal(enabledStatus.durationSeconds, 60)
    assert.equal(enabledStatus.allocatedBytes, 0)
    assert.equal(enabledStatus.hasAudio, false)

    audioCapture.setRollingCaptureSeconds(null)
    assert.equal(audioCapture.getRollingCaptureStatus().allocatedBytes, 0)
  } finally {
    resetStores()
  }
})

test('normalizeAudioPreferences clamps out-of-range trim values', () => {
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: -18 }), audioPreferences({ inputGainDb: -12 }))
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 18 }), audioPreferences({ inputGainDb: 12 }))
})

test('normalizeAudioPreferences rounds trim values to 0.5 dB steps', () => {
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 6.24 }), audioPreferences({ inputGainDb: 6 }))
  assert.deepEqual(normalizeAudioPreferences({ inputGainDb: 6.26 }), audioPreferences({ inputGainDb: 6.5 }))
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
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({ inputGainDb: 6.5 }))
    assert.equal(fakeStorage.getSetCount(), 1)

    useAudioStore.getState().setInputGain(6.49)

    assert.deepEqual(forwardedValues, [6.5])
    assert.equal(fakeStorage.getSetCount(), 1)

    useAudioStore.getState().setInputGain(0)

    assert.equal(useAudioStore.getState().inputGainDb, 0)
    assert.deepEqual(forwardedValues, [6.5, 0])
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({ inputGainDb: 0 }))
    assert.equal(fakeStorage.getSetCount(), 2)
  } finally {
    audioCapture.setInputGain = originalSetInputGain
    fakeStorage.restore()
    resetStores()
  }
})

test('audio store persists rolling capture opt-in and forwards duration changes', () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const originalSetRollingCaptureSeconds = audioCapture.setRollingCaptureSeconds
  const forwardedValues: Array<number | null> = []

  audioCapture.setRollingCaptureSeconds = (duration) => {
    forwardedValues.push(duration)
  }

  try {
    useAudioStore.getState().setRollingCaptureSeconds(30)

    assert.equal(useAudioStore.getState().rollingCaptureSeconds, 30)
    assert.deepEqual(forwardedValues, [30])
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      rollingCaptureSeconds: 30,
    }))

    useAudioStore.getState().setRollingCaptureSeconds(null)

    assert.equal(useAudioStore.getState().rollingCaptureSeconds, null)
    assert.deepEqual(forwardedValues, [30, null])
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences())
  } finally {
    audioCapture.setRollingCaptureSeconds = originalSetRollingCaptureSeconds
    fakeStorage.restore()
    resetStores()
  }
})

test('audio store persists custom output source selections', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()

  try {
    await useAudioStore.getState().selectSystemSource('headphones')

    const state = useAudioStore.getState()
    assert.equal(state.captureMode, 'system')
    assert.equal(state.selectedSystemSourceId, 'headphones')
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'system',
      selectedSystemSourceId: 'headphones',
    }))
  } finally {
    fakeStorage.restore()
    resetStores()
  }
})

test('audio store persists input source selections', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()

  try {
    await useAudioStore.getState().selectDevice('mic-1')

    const state = useAudioStore.getState()
    assert.equal(state.captureMode, 'device')
    assert.equal(state.selectedDeviceId, 'mic-1')
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'device',
      selectedDeviceId: 'mic-1',
    }))
  } finally {
    fakeStorage.restore()
    resetStores()
  }
})

test('audio store persists a Bridge stable UUID while selecting its live connection key', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const originalSetSelectedDawSourceId = audioCapture.setSelectedDawSourceId
  const selections: Array<[string | null, string | null]> = []
  audioCapture.setSelectedDawSourceId = (stableId, liveId = null) => {
    selections.push([stableId, liveId])
  }

  try {
    useAudioStore.setState({
      dawSources: [{
        id: 'bridge-stable-uuid:live-key',
        persistentId: 'bridge-stable-uuid',
        label: 'Drums',
        kind: 'daw',
      }],
    })
    await useAudioStore.getState().selectDawSource('bridge-stable-uuid:live-key')

    assert.equal(useAudioStore.getState().captureMode, 'daw')
    assert.equal(useAudioStore.getState().selectedDawSourceId, 'bridge-stable-uuid')
    assert.deepEqual(selections, [['bridge-stable-uuid', 'bridge-stable-uuid:live-key']])
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'daw',
      selectedDawSourceId: 'bridge-stable-uuid',
    }))
  } finally {
    audioCapture.setSelectedDawSourceId = originalSetSelectedDawSourceId
    fakeStorage.restore()
    resetStores()
  }
})

test('audio store auto-switches to device input when native system capture is unavailable on startup', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
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
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'device',
      selectedDeviceId: null,
    }))

    const banner = useUiStore.getState().banner
    assert.ok(banner)
    assert.equal(banner?.tone, 'info')
    assert.match(banner?.message ?? '', /PulseAudio is unavailable/i)
  } finally {
    fakeStorage.restore()
    harness.restore()
    resetStores()
  }
})

test('audio store falls back to device input when native system capture fails at start time', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
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
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'device',
      selectedDeviceId: null,
    }))

    const banner = useUiStore.getState().banner
    assert.ok(banner)
    assert.match(banner?.message ?? '', /PulseAudio monitor stream failed/i)
  } finally {
    fakeStorage.restore()
    harness.restore()
    resetStores()
  }
})

test('audio store does not restart capture when refreshed output devices are unchanged', async () => {
  resetStores()
  const support = createBackendSupport(true, null)
  const sources = [
    defaultSystemSource(),
    systemSource('speaker', 'Speakers', true),
  ]
  const harness = installAudioCaptureHarness({
    support,
    systemSources: sources,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      systemSources: sources,
      selectedSystemSourceId: DEFAULT_SYSTEM_SOURCE_ID,
      captureMode: 'system',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'native-linux',
      activeSourceId: 'speaker',
      activeSourceLabel: 'Speakers',
    })

    await useAudioStore.getState().refreshSystemSources({ rebindActiveCapture: true })

    assert.equal(harness.calls.startSystemAudio, 0)
    assert.equal(useAudioStore.getState().activeSourceId, 'speaker')
  } finally {
    harness.restore()
    resetStores()
  }
})

test('audio store rebinds system capture when Default Output resolves to a new device', async () => {
  resetStores()
  const support = createBackendSupport(true, null)
  let sources = [
    defaultSystemSource(),
    systemSource('speaker', 'Speakers', true),
    systemSource('headphones', 'Headphones', false),
  ]
  const harness = installAudioCaptureHarness({
    support,
    systemSources: () => sources,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      systemSources: sources,
      selectedSystemSourceId: DEFAULT_SYSTEM_SOURCE_ID,
      captureMode: 'system',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'native-linux',
      activeSourceId: 'speaker',
      activeSourceLabel: 'Speakers',
    })

    sources = [
      defaultSystemSource(),
      systemSource('speaker', 'Speakers', false),
      systemSource('headphones', 'Headphones', true),
    ]

    await useAudioStore.getState().refreshSystemSources({ rebindActiveCapture: true })

    assert.equal(harness.calls.startSystemAudio, 1)
    assert.deepEqual(harness.calls.startSystemAudioDeviceIds, [DEFAULT_SYSTEM_SOURCE_ID])
    assert.equal(useAudioStore.getState().activeSourceId, 'headphones')
    assert.equal(useAudioStore.getState().captureStatus, 'capturing')
  } finally {
    harness.restore()
    resetStores()
  }
})

test('audio store keeps explicit output selections pinned when the OS default changes', async () => {
  resetStores()
  const support = createBackendSupport(true, null)
  let sources = [
    defaultSystemSource(),
    systemSource('speaker', 'Speakers', true),
    systemSource('headphones', 'Headphones', false),
  ]
  const harness = installAudioCaptureHarness({
    support,
    systemSources: () => sources,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      systemSources: sources,
      selectedSystemSourceId: 'headphones',
      captureMode: 'system',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'native-linux',
      activeSourceId: 'headphones',
      activeSourceLabel: 'Headphones',
    })

    sources = [
      defaultSystemSource(),
      systemSource('speaker', 'Speakers', false),
      systemSource('headphones', 'Headphones', false),
      systemSource('monitor', 'Monitor', true),
    ]

    await useAudioStore.getState().refreshSystemSources({ rebindActiveCapture: true })

    assert.equal(harness.calls.startSystemAudio, 0)
    assert.equal(useAudioStore.getState().selectedSystemSourceId, 'headphones')
    assert.equal(useAudioStore.getState().activeSourceId, 'headphones')
  } finally {
    harness.restore()
    resetStores()
  }
})

test('audio store falls back to Default Output when an explicit output disappears', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const support = createBackendSupport(true, null)
  let sources = [
    defaultSystemSource(),
    systemSource('speaker', 'Speakers', false),
    systemSource('headphones', 'Headphones', true),
  ]
  const harness = installAudioCaptureHarness({
    support,
    systemSources: () => sources,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      systemSources: sources,
      selectedSystemSourceId: 'speaker',
      captureMode: 'system',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'native-linux',
      activeSourceId: 'speaker',
      activeSourceLabel: 'Speakers',
    })

    sources = [
      defaultSystemSource(),
      systemSource('headphones', 'Headphones', true),
    ]

    await useAudioStore.getState().refreshSystemSources({ rebindActiveCapture: true })

    const state = useAudioStore.getState()
    assert.equal(harness.calls.startSystemAudio, 1)
    assert.equal(state.selectedSystemSourceId, DEFAULT_SYSTEM_SOURCE_ID)
    assert.equal(state.activeSourceId, 'headphones')
    assert.match(state.captureNotice ?? '', /Speakers is unavailable/i)
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'system',
      selectedSystemSourceId: DEFAULT_SYSTEM_SOURCE_ID,
    }))
  } finally {
    fakeStorage.restore()
    harness.restore()
    resetStores()
  }
})

test('audio store persists Default Input when an explicit input disappears', async () => {
  resetStores()
  const fakeStorage = installFakeLocalStorage()
  const support = createBackendSupport(true, null)
  let devices = [
    mediaDevice('mic-1', 'Mic 1'),
    mediaDevice('mic-2', 'Mic 2'),
  ]
  const harness = installAudioCaptureHarness({
    support,
    devices: () => devices,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      devices,
      selectedDeviceId: 'mic-1',
      captureMode: 'device',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'device-input',
      activeSourceId: 'mic-1',
      activeSourceLabel: 'Mic 1',
    })

    devices = [
      mediaDevice('mic-2', 'Mic 2', true),
    ]

    await useAudioStore.getState().refreshDevices({ rebindActiveCapture: true })

    const state = useAudioStore.getState()
    assert.equal(harness.calls.startDevice, 1)
    assert.deepEqual(harness.calls.startDeviceRequests, [{
      deviceId: null,
      forceDeviceRestart: true,
    }])
    assert.equal(state.selectedDeviceId, null)
    assert.equal(state.activeSourceId, 'mic-2')
    assert.match(state.captureNotice ?? '', /Mic 1 is unavailable/i)
    assert.equal(fakeStorage.getItem('prism:audio'), storedAudioPreferences({
      captureMode: 'device',
      selectedDeviceId: null,
    }))
  } finally {
    fakeStorage.restore()
    harness.restore()
    resetStores()
  }
})

test('audio store forces default input reacquisition when the default input signature changes', async () => {
  resetStores()
  const support = createBackendSupport(true, null)
  let devices = [
    mediaDevice('default', 'Default - Mic 1', true),
    mediaDevice('mic-1', 'Mic 1'),
  ]
  const harness = installAudioCaptureHarness({
    support,
    devices: () => devices,
  })

  try {
    useAudioStore.setState({
      backendSupport: support,
      devices,
      selectedDeviceId: null,
      captureMode: 'device',
      captureStatus: 'capturing',
      isCapturing: true,
      activeBackendKind: 'device-input',
      activeSourceId: 'mic-1',
      activeSourceLabel: 'Mic 1',
    })

    devices = [
    mediaDevice('default', 'Default - Mic 2', true),
    mediaDevice('mic-2', 'Mic 2'),
    ]

    await useAudioStore.getState().refreshDevices({ rebindActiveCapture: true })

    assert.equal(harness.calls.startDevice, 1)
    assert.deepEqual(harness.calls.startDeviceRequests, [{
      deviceId: null,
      forceDeviceRestart: true,
    }])
    assert.equal(useAudioStore.getState().activeSourceId, 'mic-2')
  } finally {
    harness.restore()
    resetStores()
  }
})

test('audio device watcher coalesces refreshes and cleans up timers and listeners', async () => {
  resetStores()
  const support = createBackendSupport(true, null)
  const pendingSources = deferred<CaptureSourceDescriptor[]>()
  const harness = installAudioCaptureHarness({
    support,
    systemSources: () => pendingSources.promise,
    devices: [],
  })
  const fakeEnvironment = installFakeDeviceWatcherEnvironment()

  try {
    const stopWatcher = startAudioDeviceWatcher()
    await flushPromises()

    assert.ok(fakeEnvironment.getIntervalCount() >= 1)
    assert.equal(fakeEnvironment.getListenerCount(), 1)
    assert.equal(harness.calls.listSources, 1)

    fakeEnvironment.runIntervals()
    fakeEnvironment.runIntervals()
    assert.equal(harness.calls.listSources, 1)

    pendingSources.resolve([defaultSystemSource()])
    await flushAsyncWork()
    fakeEnvironment.runIntervals()
    await flushAsyncWork()

    assert.equal(harness.calls.listSources, 2)

    stopWatcher()

    assert.equal(fakeEnvironment.getIntervalCount(), 0)
    assert.equal(fakeEnvironment.getListenerCount(), 0)
  } finally {
    fakeEnvironment.restore()
    harness.restore()
    resetStores()
  }
})

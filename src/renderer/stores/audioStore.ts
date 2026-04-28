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
const DEFAULT_SYSTEM_SOURCE_ID = '__default_system_output__'
const AUDIO_DEVICE_WATCHER_POLL_MS = 5000

export interface PersistedAudioState {
  inputGainDb: number
  captureMode: CaptureMode
  selectedSystemSourceId: string
  selectedDeviceId: string | null
}

interface RefreshSourceOptions {
  rebindActiveCapture?: boolean
}

interface StartCaptureOptions {
  forceDeviceRestart?: boolean
  skipSourceRefresh?: boolean
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
  activeSourceId: string | null
  activeSourceLabel: string | null
  inputGainDb: number
  setInputGain: (db: number) => void
  clearCaptureNotice: () => void
  refreshSystemSources: (options?: RefreshSourceOptions) => Promise<void>
  refreshDevices: (options?: RefreshSourceOptions) => Promise<void>
  refreshBackendSupport: (options?: RefreshSourceOptions) => Promise<void>
  selectSystemSource: (sourceId: string | null) => Promise<void>
  selectDevice: (deviceId: string | null) => Promise<void>
  setCaptureMode: (mode: CaptureMode) => void
  startCapture: (options?: StartCaptureOptions) => Promise<void>
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
    activeSourceId: status.activeSourceId,
    activeSourceLabel: status.activeSourceLabel,
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

function areCaptureSourcesEqual(
  left: CaptureSourceDescriptor[],
  right: CaptureSourceDescriptor[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((source, index) => {
    const candidate = right[index]
    return source.id === candidate.id
      && source.label === candidate.label
      && source.kind === candidate.kind
      && source.isDefault === candidate.isDefault
      && source.sampleRate === candidate.sampleRate
      && source.channelCount === candidate.channelCount
  })
}

function areMediaDevicesEqual(left: MediaDeviceInfo[], right: MediaDeviceInfo[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((device, index) => {
    const candidate = right[index]
    return device.deviceId === candidate.deviceId
      && device.kind === candidate.kind
      && device.label === candidate.label
      && device.groupId === candidate.groupId
  })
}

function getResolvedDefaultSystemSourceId(sources: CaptureSourceDescriptor[]): string | null {
  return sources.find((source) => (
    source.kind === 'system'
    && source.id !== DEFAULT_SYSTEM_SOURCE_ID
    && source.isDefault === true
  ))?.id ?? null
}

function getDefaultInputSignature(devices: MediaDeviceInfo[]): string | null {
  const defaultDevice = devices.find((device) => device.deviceId === 'default') ?? devices[0] ?? null
  if (!defaultDevice) {
    return null
  }

  return [
    defaultDevice.deviceId,
    defaultDevice.label,
    defaultDevice.groupId,
    defaultDevice.kind,
  ].join('\0')
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

function normalizeCaptureMode(raw: unknown): CaptureMode {
  return raw === 'device' ? 'device' : 'system'
}

function normalizeSystemSourceId(raw: unknown): string {
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw
    : DEFAULT_SYSTEM_SOURCE_ID
}

function normalizeDeviceId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw
    : null
}

export function normalizeAudioPreferences(raw: unknown): PersistedAudioState {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<PersistedAudioState>
    : {}

  return {
    inputGainDb: normalizeInputGainDb(parsed.inputGainDb),
    captureMode: normalizeCaptureMode(parsed.captureMode),
    selectedSystemSourceId: normalizeSystemSourceId(parsed.selectedSystemSourceId),
    selectedDeviceId: normalizeDeviceId(parsed.selectedDeviceId),
  }
}

function buildAudioPreferences(
  inputGainDb: number,
  captureMode: CaptureMode,
  selectedSystemSourceId: string | null,
  selectedDeviceId: string | null,
): PersistedAudioState {
  return normalizeAudioPreferences({
    inputGainDb,
    captureMode,
    selectedSystemSourceId,
    selectedDeviceId,
  })
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

function persistAudioPreferences(preferences: PersistedAudioState, storage = getStorage()): void {
  if (!storage) return

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeAudioPreferences(preferences)))
  } catch {
    // Ignore localStorage write failures.
  }
}

const storedPreferences = loadAudioPreferences()
audioCapture.setInputGain(storedPreferences.inputGainDb)
audioCapture.setSelectedSystemSourceId(storedPreferences.selectedSystemSourceId)
audioCapture.setSelectedDeviceId(storedPreferences.selectedDeviceId)
audioCapture.setCaptureMode(storedPreferences.captureMode)

export const useAudioStore = create<AudioState>((set, get) => ({
  systemSources: [],
  devices: [],
  selectedSystemSourceId: audioCapture.getSelectedSystemSourceId(),
  selectedDeviceId: audioCapture.getSelectedDeviceId(),
  captureMode: audioCapture.getCaptureMode(),
  activeBackendKind: null,
  backendSupport: null,
  isCapturing: false,
  captureStatus: 'idle',
  captureError: null,
  captureNotice: null,
  sampleRate: 48000,
  channelCount: 2,
  activeSourceId: null,
  activeSourceLabel: null,
  inputGainDb: storedPreferences.inputGainDb,

  setInputGain: (db: number) => {
    const nextInputGainDb = normalizeInputGainDb(db)
    const currentState = get()
    if (currentState.inputGainDb === nextInputGainDb) {
      return
    }

    persistAudioPreferences(buildAudioPreferences(
      nextInputGainDb,
      currentState.captureMode,
      currentState.selectedSystemSourceId,
      currentState.selectedDeviceId,
    ))
    audioCapture.setInputGain(nextInputGainDb)
    set({ inputGainDb: nextInputGainDb })
  },

  clearCaptureNotice: () => {
    set({ captureNotice: null })
  },

  refreshSystemSources: async (options: RefreshSourceOptions = {}) => {
    const systemSources = await audioCapture.listSources('system')
    const currentState = get()
    const previousSelectedSystemSourceId = currentState.selectedSystemSourceId
    const previousSources = currentState.systemSources
    const fallbackSourceId = systemSources[0]?.id ?? null
    const nextSelectedSystemSourceId = previousSelectedSystemSourceId
      && systemSources.some((source) => source.id === previousSelectedSystemSourceId)
      ? previousSelectedSystemSourceId
      : fallbackSourceId
    const shouldShowFallbackNotice = Boolean(
      previousSelectedSystemSourceId
      && previousSelectedSystemSourceId !== nextSelectedSystemSourceId
      && currentState.captureMode === 'system',
    )
    const sourceListChanged = !areCaptureSourcesEqual(previousSources, systemSources)
    const selectedSourceChanged = previousSelectedSystemSourceId !== nextSelectedSystemSourceId
    const nextCaptureNotice = shouldShowFallbackNotice
      ? `${describeSystemSource(previousSelectedSystemSourceId!, previousSources)} is unavailable. Prism switched to Default Output.`
      : currentState.captureNotice

    if (selectedSourceChanged) {
      audioCapture.setSelectedSystemSourceId(nextSelectedSystemSourceId)
      persistAudioPreferences(buildAudioPreferences(
        currentState.inputGainDb,
        currentState.captureMode,
        nextSelectedSystemSourceId,
        currentState.selectedDeviceId,
      ))
    }

    if (
      sourceListChanged
      || selectedSourceChanged
      || nextCaptureNotice !== currentState.captureNotice
    ) {
      set((state) => ({
        ...state,
        systemSources,
        selectedSystemSourceId: nextSelectedSystemSourceId,
        captureNotice: nextCaptureNotice,
      }))
    }

    const defaultSystemSourceId = getResolvedDefaultSystemSourceId(systemSources)
    const selectedDefaultOutput = nextSelectedSystemSourceId === DEFAULT_SYSTEM_SOURCE_ID
    const explicitSourceBecameUnavailable = Boolean(
      previousSelectedSystemSourceId
      && previousSelectedSystemSourceId !== DEFAULT_SYSTEM_SOURCE_ID
      && previousSelectedSystemSourceId !== nextSelectedSystemSourceId,
    )
    const defaultOutputChanged = Boolean(
      selectedDefaultOutput
      && currentState.activeSourceId
      && defaultSystemSourceId
      && currentState.activeSourceId !== defaultSystemSourceId,
    )

    if (
      options.rebindActiveCapture === true
      && currentState.captureMode === 'system'
      && currentState.captureStatus === 'capturing'
      && currentState.isCapturing
      && (explicitSourceBecameUnavailable || defaultOutputChanged)
    ) {
      await get().startCapture({ skipSourceRefresh: true })
    }
  },

  refreshDevices: async (options: RefreshSourceOptions = {}) => {
    const devices = await audioCapture.listDevices()
    const currentState = get()
    const previousSelectedDeviceId = currentState.selectedDeviceId
    const previousDevices = currentState.devices
    const nextSelectedDeviceId = previousSelectedDeviceId
      && devices.some((device) => device.deviceId === previousSelectedDeviceId)
      ? previousSelectedDeviceId
      : null
    const shouldShowFallbackNotice = Boolean(
      previousSelectedDeviceId
      && previousSelectedDeviceId !== nextSelectedDeviceId
      && currentState.captureMode === 'device',
    )
    const deviceListChanged = !areMediaDevicesEqual(previousDevices, devices)
    const selectedDeviceChanged = previousSelectedDeviceId !== nextSelectedDeviceId
    const nextCaptureNotice = shouldShowFallbackNotice
      ? `${describeInputDevice(previousSelectedDeviceId!, previousDevices)} is unavailable. Prism switched to Default Input.`
      : currentState.captureNotice

    if (selectedDeviceChanged) {
      audioCapture.setSelectedDeviceId(nextSelectedDeviceId)
      persistAudioPreferences(buildAudioPreferences(
        currentState.inputGainDb,
        currentState.captureMode,
        currentState.selectedSystemSourceId,
        nextSelectedDeviceId,
      ))
    }

    if (
      deviceListChanged
      || selectedDeviceChanged
      || nextCaptureNotice !== currentState.captureNotice
    ) {
      set((state) => ({
        ...state,
        devices,
        selectedDeviceId: nextSelectedDeviceId,
        captureNotice: nextCaptureNotice,
      }))
    }

    const defaultInputChanged = getDefaultInputSignature(previousDevices)
      !== getDefaultInputSignature(devices)
    const selectedDefaultInput = nextSelectedDeviceId === null
    const explicitDeviceBecameUnavailable = Boolean(
      previousSelectedDeviceId
      && previousSelectedDeviceId !== nextSelectedDeviceId,
    )

    if (
      options.rebindActiveCapture === true
      && currentState.captureMode === 'device'
      && currentState.captureStatus === 'capturing'
      && currentState.isCapturing
      && (
        explicitDeviceBecameUnavailable
        || (selectedDefaultInput && defaultInputChanged)
      )
    ) {
      await get().startCapture({
        forceDeviceRestart: selectedDefaultInput,
        skipSourceRefresh: true,
      })
    }
  },

  refreshBackendSupport: async (options: RefreshSourceOptions = {}) => {
    const backendSupport = await audioCapture.refreshBackendSupport()
    set({ backendSupport })
    await get().refreshSystemSources(options)
  },

  selectSystemSource: async (sourceId: string | null) => {
    audioCapture.setSelectedSystemSourceId(sourceId)
    audioCapture.setCaptureMode('system')
    const currentState = get()
    const nextSelectedSystemSourceId = audioCapture.getSelectedSystemSourceId()
    persistAudioPreferences(buildAudioPreferences(
      currentState.inputGainDb,
      'system',
      nextSelectedSystemSourceId,
      currentState.selectedDeviceId,
    ))
    set({
      selectedSystemSourceId: nextSelectedSystemSourceId,
      captureMode: 'system',
      captureError: null,
      captureNotice: null,
    })
  },

  selectDevice: async (deviceId: string | null) => {
    audioCapture.setSelectedDeviceId(deviceId)
    audioCapture.setCaptureMode('device')
    const currentState = get()
    persistAudioPreferences(buildAudioPreferences(
      currentState.inputGainDb,
      'device',
      currentState.selectedSystemSourceId,
      deviceId,
    ))
    set({
      selectedDeviceId: deviceId,
      captureMode: 'device',
      captureError: null,
      captureNotice: null,
    })
  },

  setCaptureMode: (mode: CaptureMode) => {
    audioCapture.setCaptureMode(mode)
    const currentState = get()
    persistAudioPreferences(buildAudioPreferences(
      currentState.inputGainDb,
      mode,
      currentState.selectedSystemSourceId,
      currentState.selectedDeviceId,
    ))
    set({ captureMode: mode })
  },

  startCapture: async (options: StartCaptureOptions = {}) => {
    set({ captureStatus: 'connecting', captureError: null })
    try {
      const { captureMode } = get()
      audioCapture.setCaptureMode(captureMode)
      if (options.skipSourceRefresh !== true) {
        await get().refreshBackendSupport({ rebindActiveCapture: false })
        await get().refreshDevices({ rebindActiveCapture: false })
      }

      const { selectedDeviceId, selectedSystemSourceId, backendSupport } = get()

      const startDefaultInputFallback = async (reason: string | null): Promise<void> => {
        const message = buildSystemCaptureFallbackMessage(reason)
        audioCapture.setSelectedDeviceId(null)
        audioCapture.setCaptureMode('device')
        const currentState = get()
        persistAudioPreferences(buildAudioPreferences(
          currentState.inputGainDb,
          'device',
          currentState.selectedSystemSourceId,
          null,
        ))
        set({
          selectedDeviceId: null,
          captureMode: 'device',
          captureNotice: message,
        })
        showSystemCaptureFallbackBanner(message)
        await audioCapture.startDevice(undefined, { forceDeviceRestart: true })
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
        await audioCapture.startDevice(selectedDeviceId ?? undefined, {
          forceDeviceRestart: options.forceDeviceRestart === true,
        })
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
        activeSourceId: null,
        activeSourceLabel: null,
      })
    }
  },

  stopCapture: () => {
    audioCapture.stop()
    set({
      isCapturing: false,
      captureStatus: 'idle',
      captureError: null,
      activeSourceId: null,
      activeSourceLabel: null,
    })
  },
}))

interface AudioDeviceWatcher {
  refCount: number
  dispose: () => void
}

let audioDeviceWatcher: AudioDeviceWatcher | null = null

function createAudioDeviceWatcher(): AudioDeviceWatcher {
  let disposed = false
  let outputRefreshPromise: Promise<void> | null = null
  let inputRefreshPromise: Promise<void> | null = null
  let outputPollTimer: number | null = null
  let inputPollTimer: number | null = null

  const refreshOutputDevices = (): void => {
    if (disposed || outputRefreshPromise) {
      return
    }

    outputRefreshPromise = useAudioStore.getState()
      .refreshSystemSources({ rebindActiveCapture: true })
      .catch((error) => {
        console.error('Failed to refresh output devices:', error)
      })
      .finally(() => {
        outputRefreshPromise = null
      })
  }

  const refreshInputDevices = (): void => {
    if (disposed || inputRefreshPromise) {
      return
    }

    inputRefreshPromise = useAudioStore.getState()
      .refreshDevices({ rebindActiveCapture: true })
      .catch((error) => {
        console.error('Failed to refresh input devices:', error)
      })
      .finally(() => {
        inputRefreshPromise = null
      })
  }

  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  const handleDeviceChange = (): void => {
    refreshInputDevices()
  }

  if (typeof mediaDevices?.addEventListener === 'function') {
    mediaDevices.addEventListener('devicechange', handleDeviceChange)
  }

  if (typeof window !== 'undefined') {
    outputPollTimer = window.setInterval(refreshOutputDevices, AUDIO_DEVICE_WATCHER_POLL_MS)
    inputPollTimer = window.setInterval(refreshInputDevices, AUDIO_DEVICE_WATCHER_POLL_MS)
  }

  refreshOutputDevices()
  refreshInputDevices()

  return {
    refCount: 1,
    dispose: () => {
      disposed = true

      if (outputPollTimer !== null && typeof window !== 'undefined') {
        window.clearInterval(outputPollTimer)
        outputPollTimer = null
      }

      if (inputPollTimer !== null && typeof window !== 'undefined') {
        window.clearInterval(inputPollTimer)
        inputPollTimer = null
      }

      if (typeof mediaDevices?.removeEventListener === 'function') {
        mediaDevices.removeEventListener('devicechange', handleDeviceChange)
      }
    },
  }
}

export function startAudioDeviceWatcher(): () => void {
  if (!audioDeviceWatcher) {
    audioDeviceWatcher = createAudioDeviceWatcher()
  } else {
    audioDeviceWatcher.refCount += 1
  }

  let didRelease = false
  return () => {
    if (didRelease || !audioDeviceWatcher) {
      return
    }

    didRelease = true
    audioDeviceWatcher.refCount -= 1
    if (audioDeviceWatcher.refCount <= 0) {
      audioDeviceWatcher.dispose()
      audioDeviceWatcher = null
    }
  }
}

audioCapture.subscribeStatus((status) => {
  useAudioStore.setState((state) => ({
    ...state,
    ...applyCaptureStatus(status),
  }))
})

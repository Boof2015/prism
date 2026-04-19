/**
 * AudioCapture — backend manager for Prism's live capture pipeline.
 * System output capture flows through native platform backends while
 * input-device capture continues to use browser media devices.
 */

import { audioRouter } from './AudioRouter'
import { nativeVisualizerTransport } from './NativeVisualizerTransport'
import { applyInputGainToStereoSamples, inputGainDbToLinear } from './inputGain'
import type {
  CaptureBackendKind,
  CaptureBackendSupport,
  CaptureBackendSupportEntry,
  CaptureMode,
  CaptureSourceDescriptor,
} from '../../types/capture'
import { resolveNativeBackendKind } from '../../types/capture'
import type {
  NativeCaptureDrainResult,
  NativeCaptureStartResult,
  NativeSystemCaptureAPI,
} from '../../types/nativeCapture'

export type { CaptureMode } from '../../types/capture'

interface CaptureChunk {
  left: Float32Array
  right: Float32Array
  channelCount: number
  capturedAt: number
  sequence: number
}

interface CaptureBackendStatus {
  kind: CaptureBackendKind
  active: boolean
  available: boolean
  reason: string | null
  sampleRate: number
  channelCount: number
}

interface CaptureBackendStartRequest {
  deviceId?: string
}

interface CaptureBackend {
  readonly kind: CaptureBackendKind
  start(request?: CaptureBackendStartRequest): Promise<void>
  stop(): Promise<void>
  listSources(): Promise<CaptureSourceDescriptor[]>
  subscribe(listener: (chunk: CaptureChunk) => void): () => void
  getStatus(): CaptureBackendStatus
}

const NATIVE_BACKLOG_CATCH_UP_CHUNK_THRESHOLD = 4
const NATIVE_BACKLOG_LIVE_WINDOW_MS = 50

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true
}

function resolveNativeCapturePollDelay(chunkCount: number, queueDepth = 0): number {
  if (isDocumentHidden()) {
    return 16
  }
  return chunkCount > 0 || queueDepth > 0 ? 0 : 2
}

function trimNativeChunksToLiveWindow(chunks: NativeCaptureDrainResult['chunks']): NativeCaptureDrainResult['chunks'] {
  if (chunks.length <= 1) {
    return chunks
  }

  const latestChunk = chunks[chunks.length - 1]
  const latestCapturedAt = latestChunk?.capturedAtMilliseconds ?? NaN
  if (!Number.isFinite(latestCapturedAt)) {
    return latestChunk ? [latestChunk] : []
  }

  const firstLiveChunkIndex = chunks.findIndex((chunk) => (
    Number.isFinite(chunk.capturedAtMilliseconds)
      ? latestCapturedAt - chunk.capturedAtMilliseconds <= NATIVE_BACKLOG_LIVE_WINDOW_MS
      : false
  ))

  if (firstLiveChunkIndex === -1) {
    return latestChunk ? [latestChunk] : []
  }

  return chunks.slice(firstLiveChunkIndex)
}

function selectNativeChunksForDelivery(
  result: NativeCaptureDrainResult,
  trimBacklog: boolean,
): NativeCaptureDrainResult['chunks'] {
  if (!trimBacklog) {
    return result.chunks
  }

  const shouldCatchUp = result.queueDepth > 0 || result.chunks.length > NATIVE_BACKLOG_CATCH_UP_CHUNK_THRESHOLD
  if (!shouldCatchUp) {
    return result.chunks
  }

  return trimNativeChunksToLiveWindow(result.chunks)
}

function resolvePlatform(): string {
  if (typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined') {
    return window.electronAPI.platform
  }

  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    return process.platform
  }

  return 'linux'
}

export function createDefaultBackendSupport(platform = resolvePlatform()): CaptureBackendSupport {
  return {
    nativeBackend: {
      kind: resolveNativeBackendKind(platform),
      available: false,
      reason: 'Native system audio capture is not available in this build.',
    },
    deviceInput: {
      kind: 'device-input',
      available: true,
      reason: null,
    },
  }
}

export interface CaptureManagerStatus {
  captureMode: CaptureMode
  activeBackendKind: CaptureBackendKind | null
  backendSupport: CaptureBackendSupport | null
  sampleRate: number
  channelCount: number
  isCapturing: boolean
}

type StatusListener = (status: CaptureManagerStatus) => void

const DEFAULT_SYSTEM_SOURCE_ID = '__default_system_output__'

function toDeviceSourceDescriptor(device: MediaDeviceInfo): CaptureSourceDescriptor {
  return {
    id: device.deviceId,
    label: device.label || `Input ${device.deviceId.slice(0, 8)}`,
    kind: 'device',
  }
}

function getDefaultSystemSourceDescriptor(): CaptureSourceDescriptor {
  return {
    id: DEFAULT_SYSTEM_SOURCE_ID,
    label: 'Default Output',
    kind: 'system',
    isDefault: true,
  }
}

class DeviceInputCaptureRuntime {
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletLoaded = false
  private chunkListeners = new Set<(chunk: CaptureChunk) => void>()
  private active = false
  private currentDeviceId: string | null = null
  private sequence = 0
  private sampleRate = 48000
  private channelCount = 2
  private inputGainLinear = 1

  setInputGain(db: number): void {
    this.inputGainLinear = inputGainDbToLinear(db)
    this.syncGainNode()
  }

  subscribe(listener: (chunk: CaptureChunk) => void): () => void {
    this.chunkListeners.add(listener)
    return () => {
      this.chunkListeners.delete(listener)
    }
  }

  async startDevice(deviceId?: string): Promise<void> {
    await this.ensureContext()

    const requestedDeviceId = deviceId ?? null
    if (this.currentDeviceId !== requestedDeviceId || !this.stream || !this.sourceNode) {
      const nextStream = await this.requestDeviceStream(deviceId)
      this.attachStream(nextStream, requestedDeviceId)
    }

    this.sequence = 0
    this.active = true
    if (this.audioContext && this.audioContext.state !== 'running') {
      await this.audioContext.resume()
    }
  }

  async stop(): Promise<void> {
    this.active = false
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend()
    }
  }

  async listDeviceSources(): Promise<CaptureSourceDescriptor[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => toDeviceSourceDescriptor(device))
  }

  getStatus(kind: CaptureBackendKind): CaptureBackendStatus {
    return {
      kind,
      active: this.active,
      available: true,
      reason: null,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
    }
  }

  private async ensureContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' })
      this.sampleRate = Math.max(1, Math.floor(this.audioContext.sampleRate))
    }

    if (!this.workletLoaded) {
      await this.audioContext.audioWorklet.addModule('./capture-worklet.js')
      this.workletLoaded = true
    }

    if (!this.gainNode) {
      this.gainNode = this.audioContext.createGain()
    }
    this.syncGainNode()

    if (!this.workletNode) {
      this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
      })

      this.workletNode.port.onmessage = (event: MessageEvent<{
        left: Float32Array
        right: Float32Array
        channelCount?: number
      }>) => {
        if (!this.active) return

        const chunk: CaptureChunk = {
          left: event.data.left,
          right: event.data.right,
          channelCount: Math.max(1, Math.floor(event.data.channelCount ?? this.channelCount) || 1),
          capturedAt: performance.now(),
          sequence: ++this.sequence,
        }

        for (const listener of this.chunkListeners) {
          listener(chunk)
        }
      }
    }
  }

  private attachStream(stream: MediaStream, deviceId: string | null): void {
    if (!this.audioContext || !this.workletNode) return

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.stream && this.stream !== stream) {
      this.stream.getTracks().forEach((track) => track.stop())
    }

    this.stream = stream
    this.currentDeviceId = deviceId
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)
    if (this.gainNode) {
      this.sourceNode.connect(this.gainNode)
      this.gainNode.connect(this.workletNode)
    } else {
      this.sourceNode.connect(this.workletNode)
    }

    const audioTrack = stream.getAudioTracks()[0] ?? null
    const trackSettings = audioTrack?.getSettings()

    this.channelCount = Math.max(
      1,
      Math.floor(trackSettings?.channelCount ?? this.sourceNode.channelCount ?? 2),
    )
    this.sampleRate = Math.max(1, Math.floor(this.audioContext.sampleRate))
  }

  private syncGainNode(): void {
    if (this.gainNode) {
      this.gainNode.gain.value = this.inputGainLinear
    }
  }

  private async requestDeviceStream(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      } as MediaTrackConstraints,
    }

    return navigator.mediaDevices.getUserMedia(constraints)
  }
}

class DeviceInputCaptureBackend implements CaptureBackend {
  readonly kind = 'device-input' as const

  constructor(private readonly runtime: DeviceInputCaptureRuntime) {}

  async start(request?: CaptureBackendStartRequest): Promise<void> {
    await this.runtime.startDevice(request?.deviceId)
  }

  async stop(): Promise<void> {
    await this.runtime.stop()
  }

  async listSources(): Promise<CaptureSourceDescriptor[]> {
    return this.runtime.listDeviceSources()
  }

  subscribe(listener: (chunk: CaptureChunk) => void): () => void {
    return this.runtime.subscribe(listener)
  }

  getStatus(): CaptureBackendStatus {
    return this.runtime.getStatus(this.kind)
  }
}

export abstract class NativePolledCaptureBackend implements CaptureBackend {
  abstract readonly kind: CaptureBackendKind

  private readonly chunkListeners = new Set<(chunk: CaptureChunk) => void>()
  private pollTimer: number | null = null
  private active = false
  private sampleRate = 48000
  private channelCount = 2
  private supportReason: string | null
  private performanceOffsetMilliseconds = 0

  constructor(private readonly supportEntry: CaptureBackendSupportEntry) {
    this.supportReason = supportEntry.reason
  }

  async start(request?: CaptureBackendStartRequest): Promise<void> {
    const nativeCapture = this.getNativeCaptureModule()
    if (!nativeCapture) {
      throw new Error(`${this.getBackendLabel()} capture module is not available in this build.`)
    }

    const support = nativeCapture.getSupport()
    if (!support.available) {
      throw new Error(support.reason ?? `${this.getBackendLabel()} capture is unavailable.`)
    }

    const nativeNow = nativeCapture.nowMilliseconds()
    this.performanceOffsetMilliseconds = performance.now() - nativeNow

    const startResult = nativeCapture.start(
      request?.deviceId && request.deviceId !== DEFAULT_SYSTEM_SOURCE_ID
        ? request.deviceId
        : undefined,
    ) as NativeCaptureStartResult

    this.sampleRate = Math.max(1, Math.floor(startResult.sampleRate) || 48000)
    this.channelCount = Math.max(1, Math.floor(startResult.channelCount) || 2)
    this.supportReason = null
    this.active = true
    this.startPolling()
  }

  async stop(): Promise<void> {
    this.stopPolling()
    this.getNativeCaptureModule()?.stop()
    this.active = false
  }

  async listSources(): Promise<CaptureSourceDescriptor[]> {
    const nativeCapture = this.getNativeCaptureModule()
    if (!nativeCapture) {
      return []
    }

    const support = nativeCapture.getSupport()
    if (!support.available) {
      return []
    }

    return nativeCapture.listOutputDevices().map((source) => ({
      id: source.id,
      label: source.label,
      kind: 'system',
      isDefault: source.isDefault,
      sampleRate: source.sampleRate,
      channelCount: source.channelCount,
    }))
  }

  subscribe(listener: (chunk: CaptureChunk) => void): () => void {
    this.chunkListeners.add(listener)
    return () => {
      this.chunkListeners.delete(listener)
    }
  }

  getStatus(): CaptureBackendStatus {
    return {
      kind: this.kind,
      active: this.active,
      available: this.supportEntry.available,
      reason: this.supportReason,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
    }
  }

  protected shouldTrimBacklogForLiveCapture(): boolean {
    return false
  }

  private startPolling(): void {
    this.stopPolling()

    const poll = (): void => {
      if (!this.active) return

      let chunkCount = 0
      let queueDepth = 0
      try {
        const result = this.getNativeCaptureModule()?.drain(32) as NativeCaptureDrainResult | undefined
        chunkCount = result?.chunks.length ?? 0
        queueDepth = result?.queueDepth ?? 0
        if (result) {
          const deliveredChunks = selectNativeChunksForDelivery(
            result,
            this.shouldTrimBacklogForLiveCapture(),
          )
          for (const chunk of deliveredChunks) {
            const routedChunk: CaptureChunk = {
              left: chunk.left,
              right: chunk.right,
              channelCount: Math.max(1, Math.floor(chunk.channelCount) || 1),
              capturedAt: chunk.capturedAtMilliseconds + this.performanceOffsetMilliseconds,
              sequence: Math.max(1, Math.floor(chunk.sequence) || 1),
            }

            for (const listener of this.chunkListeners) {
              listener(routedChunk)
            }
          }
        }
      } catch (error) {
        console.error(`${this.getBackendLabel()} capture poll failed:`, error)
        this.active = false
        this.stopPolling()
        return
      }

      this.pollTimer = window.setTimeout(poll, resolveNativeCapturePollDelay(chunkCount, queueDepth))
    }

    this.pollTimer = window.setTimeout(poll, 0)
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  protected abstract getNativeCaptureModule(): NativeSystemCaptureAPI | null
  protected abstract getBackendLabel(): string
}

class NativeMacOSCaptureBackend extends NativePolledCaptureBackend {
  readonly kind = 'native-macos' as const

  protected getNativeCaptureModule(): NativeSystemCaptureAPI | null {
    return typeof window !== 'undefined' ? window.nativeCaptureAPI?.macosCapture ?? null : null
  }

  protected getBackendLabel(): string {
    return 'Native macOS'
  }
}

class NativeWindowsCaptureBackend extends NativePolledCaptureBackend {
  readonly kind = 'native-windows' as const

  protected getNativeCaptureModule(): NativeSystemCaptureAPI | null {
    return typeof window !== 'undefined' ? window.nativeCaptureAPI?.windowsCapture ?? null : null
  }

  protected getBackendLabel(): string {
    return 'Native Windows'
  }
}

class NativeLinuxCaptureBackend extends NativePolledCaptureBackend {
  readonly kind = 'native-linux' as const

  protected getNativeCaptureModule(): NativeSystemCaptureAPI | null {
    return typeof window !== 'undefined' ? window.nativeCaptureAPI?.linuxCapture ?? null : null
  }

  protected getBackendLabel(): string {
    return 'Native Linux'
  }

  protected shouldTrimBacklogForLiveCapture(): boolean {
    return true
  }
}

class NativeUnavailableCaptureBackend implements CaptureBackend {
  readonly kind: CaptureBackendKind
  private readonly reason: string | null

  constructor(private readonly supportEntry: CaptureBackendSupportEntry) {
    this.kind = supportEntry.kind
    this.reason = supportEntry.reason
  }

  async start(): Promise<void> {
    throw new Error(this.reason ?? 'Native system audio capture is unavailable.')
  }

  async stop(): Promise<void> {
    // No-op when a platform capture backend is unavailable.
  }

  async listSources(): Promise<CaptureSourceDescriptor[]> {
    return []
  }

  subscribe(): () => void {
    return () => {}
  }

  getStatus(): CaptureBackendStatus {
    return {
      kind: this.kind,
      active: false,
      available: this.supportEntry.available,
      reason: this.reason,
      sampleRate: 48000,
      channelCount: 2,
    }
  }
}

class AudioCapture {
  private readonly deviceInputRuntime = new DeviceInputCaptureRuntime()
  private readonly deviceInputBackend: CaptureBackend

  private backendSupport: CaptureBackendSupport | null = null
  private backendSupportPromise: Promise<CaptureBackendSupport> | null = null
  private nativeBackend: CaptureBackend
  private nativeBackendUnsubscribe: (() => void) | null = null
  private activeBackend: CaptureBackend | null = null

  private selectedDeviceId: string | null = null
  private selectedSystemSourceId: string | null = DEFAULT_SYSTEM_SOURCE_ID
  private captureMode: CaptureMode = 'system'
  private sessionId: number | null = null
  private inputGainDb = 0
  private inputGainLinear = 1
  private statusListeners = new Set<StatusListener>()

  constructor() {
    this.deviceInputBackend = new DeviceInputCaptureBackend(this.deviceInputRuntime)
    this.deviceInputBackend.subscribe((chunk) => this.handleChunk(this.deviceInputBackend.kind, chunk))

    this.nativeBackend = this.createNativeBackend(createDefaultBackendSupport().nativeBackend)
    this.bindNativeBackend(this.nativeBackend)

    audioRouter.subscribeToDemandChanges((demand) => {
      nativeVisualizerTransport.setDemand(demand)
    })
    nativeVisualizerTransport.reset(audioRouter.getSessionState())
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  async refreshBackendSupport(): Promise<CaptureBackendSupport> {
    this.backendSupport = null
    this.backendSupportPromise = null
    return this.ensureBackendSupport()
  }

  async startSystemAudio(sourceId?: string): Promise<void> {
    this.captureMode = 'system'
    if (sourceId) {
      this.selectedSystemSourceId = sourceId
    }
    await this.start()
  }

  async startDevice(deviceId?: string): Promise<void> {
    this.captureMode = 'device'
    if (deviceId) {
      this.selectedDeviceId = deviceId
    }
    await this.start()
  }

  async start(deviceId?: string): Promise<void> {
    if (deviceId) {
      this.selectedDeviceId = deviceId
      this.captureMode = 'device'
    }

    await this.ensureBackendSupport()
    await this.stopActiveCapture()

    const requestedBackend = this.captureMode === 'device'
      ? this.deviceInputBackend
      : this.nativeBackend
    const requestedDeviceId = this.captureMode === 'device'
      ? this.selectedDeviceId ?? undefined
      : this.selectedSystemSourceId ?? DEFAULT_SYSTEM_SOURCE_ID

    await requestedBackend.start({ deviceId: requestedDeviceId })
    this.activeBackend = requestedBackend

    const backendStatus = requestedBackend.getStatus()
    this.sessionId = audioRouter.beginSession(
      backendStatus.sampleRate,
      backendStatus.channelCount,
      backendStatus.kind,
    )
    nativeVisualizerTransport.reset(audioRouter.getSessionState())
    this.emitStatus()
  }

  stop(): void {
    void this.stopActiveCapture()
    this.emitStatus()
  }

  async listSources(mode: CaptureMode = this.captureMode): Promise<CaptureSourceDescriptor[]> {
    await this.ensureBackendSupport()
    if (mode === 'device') {
      return this.deviceInputBackend.listSources()
    }

    const sources = await this.nativeBackend.listSources()
    if (!sources.length) {
      return [getDefaultSystemSourceDescriptor()]
    }

    const dedupedSources = sources.filter((source) => source.id !== DEFAULT_SYSTEM_SOURCE_ID)
    return [getDefaultSystemSourceDescriptor(), ...dedupedSources]
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'audioinput')
  }

  getSelectedDeviceId(): string | null {
    return this.selectedDeviceId
  }

  setSelectedDeviceId(id: string | null): void {
    this.selectedDeviceId = id
    this.emitStatus()
  }

  getSelectedSystemSourceId(): string | null {
    return this.selectedSystemSourceId
  }

  setSelectedSystemSourceId(id: string | null): void {
    this.selectedSystemSourceId = id ?? DEFAULT_SYSTEM_SOURCE_ID
    this.emitStatus()
  }

  getCaptureMode(): CaptureMode {
    return this.captureMode
  }

  setCaptureMode(mode: CaptureMode): void {
    this.captureMode = mode
    this.emitStatus()
  }

  getSampleRate(): number {
    return this.activeBackend?.getStatus().sampleRate ?? 48000
  }

  getStatus(): CaptureManagerStatus {
    const backendStatus = this.activeBackend?.getStatus()
    return {
      captureMode: this.captureMode,
      activeBackendKind: this.activeBackend?.kind ?? null,
      backendSupport: this.backendSupport,
      sampleRate: backendStatus?.sampleRate ?? 48000,
      channelCount: backendStatus?.channelCount ?? 2,
      isCapturing: Boolean(this.activeBackend?.getStatus().active && this.sessionId !== null),
    }
  }

  private async ensureBackendSupport(): Promise<CaptureBackendSupport> {
    if (this.backendSupport) {
      return this.backendSupport
    }

    if (!this.backendSupportPromise) {
      const fallbackSupport = createDefaultBackendSupport()
      this.backendSupportPromise = (
        typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
          ? window.electronAPI.getCaptureBackendSupport()
          : Promise.resolve(fallbackSupport)
      )
        .catch(() => fallbackSupport)
        .then((support) => {
          this.backendSupport = support
          this.bindNativeBackend(this.createNativeBackend(support.nativeBackend))
          this.emitStatus()
          return support
        })
    }

    return this.backendSupportPromise
  }

  private createNativeBackend(supportEntry: CaptureBackendSupportEntry): CaptureBackend {
    switch (supportEntry.kind) {
      case 'native-macos':
        return supportEntry.available
          ? new NativeMacOSCaptureBackend(supportEntry)
          : new NativeUnavailableCaptureBackend(supportEntry)
      case 'native-windows':
        return supportEntry.available
          ? new NativeWindowsCaptureBackend(supportEntry)
          : new NativeUnavailableCaptureBackend(supportEntry)
      case 'native-linux':
        return supportEntry.available
          ? new NativeLinuxCaptureBackend(supportEntry)
          : new NativeUnavailableCaptureBackend(supportEntry)
      default:
        return new NativeUnavailableCaptureBackend(supportEntry)
    }
  }

  private bindNativeBackend(backend: CaptureBackend): void {
    this.nativeBackendUnsubscribe?.()
    this.nativeBackend = backend
    this.nativeBackendUnsubscribe = backend.subscribe((chunk) => this.handleChunk(backend.kind, chunk))
  }

  private async stopActiveCapture(): Promise<void> {
    if (this.sessionId !== null) {
      audioRouter.endSession()
      nativeVisualizerTransport.reset(audioRouter.getSessionState())
      this.sessionId = null
    }

    if (this.activeBackend) {
      const backend = this.activeBackend
      this.activeBackend = null
      await backend.stop()
    }
  }

  private handleChunk(originKind: CaptureBackendKind, chunk: CaptureChunk): void {
    if (!this.activeBackend || this.activeBackend.kind !== originKind || this.sessionId === null) {
      return
    }

    if (originKind.startsWith('native-') && this.inputGainLinear !== 1) {
      applyInputGainToStereoSamples(chunk.left, chunk.right, this.inputGainLinear)
    }

    audioRouter.ingestChunk(chunk.left, chunk.right, {
      sessionId: this.sessionId,
      channelCount: chunk.channelCount,
      capturedAt: chunk.capturedAt,
      sequence: chunk.sequence,
    })
  }

  setInputGain(db: number): void {
    this.inputGainDb = db
    this.inputGainLinear = inputGainDbToLinear(this.inputGainDb)
    this.deviceInputRuntime.setInputGain(this.inputGainDb)
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

export const audioCapture = new AudioCapture()

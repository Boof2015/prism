/**
 * AudioCapture — backend manager for Prism's live capture pipeline.
 * Stage 1 keeps Chromium capture as the working backend, while exposing
 * native-backend policy and support plumbing for future low-latency paths.
 */

import { audioRouter } from './AudioRouter'
import type {
  CaptureBackendKind,
  CaptureBackendPolicy,
  CaptureBackendSupport,
  CaptureBackendSupportEntry,
  CaptureMode,
  CaptureSourceDescriptor,
} from '../../types/capture'

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

export interface CaptureManagerStatus {
  captureMode: CaptureMode
  backendPolicy: CaptureBackendPolicy
  activeBackendKind: CaptureBackendKind | null
  activeBackendReason: string | null
  backendSupport: CaptureBackendSupport | null
  sampleRate: number
  channelCount: number
  isCapturing: boolean
}

type StatusListener = (status: CaptureManagerStatus) => void

const DEFAULT_BACKEND_POLICY: CaptureBackendPolicy = 'auto'

const DEFAULT_BACKEND_SUPPORT: CaptureBackendSupport = {
  policyOptions: ['auto', 'native', 'electron'],
  nativeBackend: {
    kind: window.electronAPI.platform === 'darwin'
      ? 'native-macos'
      : window.electronAPI.platform === 'win32'
        ? 'native-windows'
        : 'native-linux',
    available: false,
    reason: 'Native system audio capture is not implemented in this build.',
  },
  electronSystem: {
    kind: 'electron-system',
    available: true,
    reason: null,
  },
  electronDevice: {
    kind: 'electron-device',
    available: true,
    reason: null,
  },
}

function toDeviceSourceDescriptor(device: MediaDeviceInfo): CaptureSourceDescriptor {
  return {
    id: device.deviceId,
    label: device.label || `Input ${device.deviceId.slice(0, 8)}`,
    kind: 'device',
  }
}

class ElectronCaptureRuntime {
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletLoaded = false
  private chunkListeners = new Set<(chunk: CaptureChunk) => void>()
  private active = false
  private currentConfigKey: string | null = null
  private sequence = 0
  private sampleRate = 48000
  private channelCount = 2

  subscribe(listener: (chunk: CaptureChunk) => void): () => void {
    this.chunkListeners.add(listener)
    return () => {
      this.chunkListeners.delete(listener)
    }
  }

  async startSystem(): Promise<void> {
    await this.start({ mode: 'system' })
  }

  async startDevice(deviceId?: string): Promise<void> {
    await this.start({ mode: 'device', deviceId })
  }

  async stop(): Promise<void> {
    this.active = false
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend()
    }
  }

  async listSystemSources(): Promise<CaptureSourceDescriptor[]> {
    const sources = await window.electronAPI.getDesktopSources()
    return sources.map((source) => ({
      id: source.id,
      label: source.name,
      kind: 'system',
    }))
  }

  async listDeviceSources(): Promise<CaptureSourceDescriptor[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => toDeviceSourceDescriptor(device))
  }

  getStatus(kind: CaptureBackendKind, reason: string | null = null): CaptureBackendStatus {
    return {
      kind,
      active: this.active,
      available: true,
      reason,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
    }
  }

  private async start(config: { mode: CaptureMode; deviceId?: string }): Promise<void> {
    const configKey = `${config.mode}:${config.deviceId ?? ''}`
    await this.ensureContext()

    if (this.currentConfigKey !== configKey || !this.stream || !this.sourceNode) {
      const nextStream = config.mode === 'system'
        ? await this.requestSystemStream()
        : await this.requestDeviceStream(config.deviceId)
      this.attachStream(nextStream, configKey)
    }

    this.sequence = 0
    this.active = true
    if (this.audioContext && this.audioContext.state !== 'running') {
      await this.audioContext.resume()
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

  private attachStream(stream: MediaStream, configKey: string): void {
    if (!this.audioContext || !this.workletNode) return

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.stream && this.stream !== stream) {
      this.stream.getTracks().forEach((track) => track.stop())
    }

    this.stream = stream
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)
    this.sourceNode.connect(this.workletNode)

    const audioTrack = stream.getAudioTracks()[0] ?? null
    const trackSettings = audioTrack?.getSettings()

    this.channelCount = Math.max(
      1,
      Math.floor(trackSettings?.channelCount ?? this.sourceNode.channelCount ?? 2),
    )
    this.sampleRate = Math.max(1, Math.floor(this.audioContext.sampleRate))
    this.currentConfigKey = configKey
  }

  private async requestSystemStream(): Promise<MediaStream> {
    const sources = await window.electronAPI.getDesktopSources()
    if (!sources.length) {
      throw new Error('No desktop sources available for system audio capture')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
        },
      } as unknown as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      } as unknown as MediaTrackConstraints,
    })

    stream.getVideoTracks().forEach((track) => track.stop())
    return stream
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

class ElectronSystemCaptureBackend implements CaptureBackend {
  readonly kind = 'electron-system' as const

  constructor(private readonly runtime: ElectronCaptureRuntime) {}

  async start(): Promise<void> {
    await this.runtime.startSystem()
  }

  async stop(): Promise<void> {
    await this.runtime.stop()
  }

  async listSources(): Promise<CaptureSourceDescriptor[]> {
    return this.runtime.listSystemSources()
  }

  subscribe(listener: (chunk: CaptureChunk) => void): () => void {
    return this.runtime.subscribe(listener)
  }

  getStatus(): CaptureBackendStatus {
    return this.runtime.getStatus(this.kind)
  }
}

class ElectronDeviceCaptureBackend implements CaptureBackend {
  readonly kind = 'electron-device' as const
  private lastDeviceId: string | undefined

  constructor(private readonly runtime: ElectronCaptureRuntime) {}

  async start(request?: CaptureBackendStartRequest): Promise<void> {
    this.lastDeviceId = request?.deviceId
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
    return this.runtime.getStatus(this.kind, this.lastDeviceId ? null : null)
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
    // No-op stub until native capture backends are implemented.
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
  private readonly electronRuntime = new ElectronCaptureRuntime()
  private readonly electronSystemBackend: CaptureBackend
  private readonly electronDeviceBackend: CaptureBackend

  private backendSupport: CaptureBackendSupport | null = null
  private backendSupportPromise: Promise<CaptureBackendSupport> | null = null
  private nativeBackend: CaptureBackend | null = null
  private activeBackend: CaptureBackend | null = null

  private selectedDeviceId: string | null = null
  private captureMode: CaptureMode = 'system'
  private backendPolicy: CaptureBackendPolicy = DEFAULT_BACKEND_POLICY
  private activeBackendReason: string | null = null
  private sessionId: number | null = null
  private statusListeners = new Set<StatusListener>()

  constructor() {
    this.electronSystemBackend = new ElectronSystemCaptureBackend(this.electronRuntime)
    this.electronDeviceBackend = new ElectronDeviceCaptureBackend(this.electronRuntime)

    this.electronSystemBackend.subscribe((chunk) => this.handleChunk(this.electronSystemBackend.kind, chunk))
    this.electronDeviceBackend.subscribe((chunk) => this.handleChunk(this.electronDeviceBackend.kind, chunk))
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  async refreshBackendSupport(): Promise<CaptureBackendSupport> {
    this.backendSupportPromise = null
    return this.ensureBackendSupport()
  }

  async startSystemAudio(): Promise<void> {
    this.captureMode = 'system'
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

    const support = await this.ensureBackendSupport()
    const requestedMode = this.captureMode
    const requestedDeviceId = requestedMode === 'device' ? this.selectedDeviceId ?? undefined : undefined
    const candidateBackends = this.resolveCandidateBackends(support, requestedMode)

    let lastError: Error | null = null
    let nativeFallbackReason: string | null = null

    for (const backend of candidateBackends) {
      try {
        await backend.start({ deviceId: requestedDeviceId })
        this.activeBackend = backend
        this.activeBackendReason = nativeFallbackReason
        const backendStatus = backend.getStatus()
        this.sessionId = audioRouter.beginSession(
          backendStatus.sampleRate,
          backendStatus.channelCount,
          backend.kind,
        )
        this.emitStatus()
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown capture backend failure'
        lastError = error instanceof Error ? error : new Error(message)
        if (backend.kind.startsWith('native-')) {
          nativeFallbackReason = message
        }
      }
    }

    this.activeBackendReason = nativeFallbackReason
    this.emitStatus()
    throw lastError ?? new Error('No capture backend succeeded.')
  }

  stop(): void {
    if (this.sessionId !== null) {
      audioRouter.endSession()
      this.sessionId = null
    }

    if (this.activeBackend) {
      void this.activeBackend.stop()
    }

    this.emitStatus()
  }

  async listSources(mode: CaptureMode = this.captureMode): Promise<CaptureSourceDescriptor[]> {
    await this.ensureBackendSupport()
    if (mode === 'device') {
      return this.electronDeviceBackend.listSources()
    }

    const activeSystemBackend = this.resolveCandidateBackends(this.backendSupport ?? DEFAULT_BACKEND_SUPPORT, 'system')[0]
    return activeSystemBackend.listSources()
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

  getCaptureMode(): CaptureMode {
    return this.captureMode
  }

  setCaptureMode(mode: CaptureMode): void {
    this.captureMode = mode
    this.emitStatus()
  }

  getBackendPolicy(): CaptureBackendPolicy {
    return this.backendPolicy
  }

  setBackendPolicy(policy: CaptureBackendPolicy): void {
    this.backendPolicy = policy
    this.emitStatus()
  }

  getSampleRate(): number {
    return this.activeBackend?.getStatus().sampleRate ?? 48000
  }

  getStatus(): CaptureManagerStatus {
    const backendStatus = this.activeBackend?.getStatus()
    return {
      captureMode: this.captureMode,
      backendPolicy: this.backendPolicy,
      activeBackendKind: this.activeBackend?.kind ?? null,
      activeBackendReason: this.activeBackendReason,
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
      this.backendSupportPromise = window.electronAPI.getCaptureBackendSupport()
        .catch(() => DEFAULT_BACKEND_SUPPORT)
        .then((support) => {
          this.backendSupport = support
          this.nativeBackend = new NativeUnavailableCaptureBackend(support.nativeBackend)
          this.emitStatus()
          return support
        })
    }

    return this.backendSupportPromise
  }

  private resolveCandidateBackends(
    support: CaptureBackendSupport,
    mode: CaptureMode,
  ): CaptureBackend[] {
    if (mode === 'device') {
      return [this.electronDeviceBackend]
    }

    const nativeBackend = this.nativeBackend ?? new NativeUnavailableCaptureBackend(support.nativeBackend)

    switch (this.backendPolicy) {
      case 'electron':
        this.activeBackendReason = null
        return [this.electronSystemBackend]
      case 'native':
      case 'auto':
        if (support.nativeBackend.available) {
          return [nativeBackend, this.electronSystemBackend]
        }
        this.activeBackendReason = support.nativeBackend.reason
        return [this.electronSystemBackend]
    }
  }

  private handleChunk(originKind: CaptureBackendKind, chunk: CaptureChunk): void {
    if (!this.activeBackend || this.activeBackend.kind !== originKind || this.sessionId === null) {
      return
    }

    audioRouter.ingestChunk(chunk.left, chunk.right, {
      sessionId: this.sessionId,
      channelCount: chunk.channelCount,
      capturedAt: chunk.capturedAt,
      sequence: chunk.sequence,
    })
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

export const audioCapture = new AudioCapture()

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_ASTRA_BASE_URL,
  type AstraControlCommand,
  type AstraIntegrationConfig,
  type AstraIntegrationState,
  type AstraNowPlayingSnapshot,
  type AstraPlaybackState,
  type AstraTrackSnapshot,
} from '../../types/astra'

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000]

type FetchLike = typeof fetch
type TimerHandle = ReturnType<typeof setTimeout>

interface RemoteTrackSnapshot {
  id: string
  title: string
  artist: string
  album: string
  isFavorite: boolean
  artworkUrl: string | null
}

interface RemoteNowPlayingSnapshot {
  playbackState: AstraPlaybackState
  currentTime: number
  duration: number
  queueLength: number
  outputDeviceLabel: string | null
  visualizerLineColor: string
  currentTrack: RemoteTrackSnapshot | null
  updatedAt: number
}

interface AstraIntegrationServiceOptions {
  configPath: string
  fetchImpl?: FetchLike
  now?: () => number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

function cloneTrackSnapshot(track: AstraTrackSnapshot | null): AstraTrackSnapshot | null {
  if (!track) return null
  return { ...track }
}

function cloneSnapshot(snapshot: AstraNowPlayingSnapshot | null): AstraNowPlayingSnapshot | null {
  if (!snapshot) return null
  return {
    ...snapshot,
    currentTrack: cloneTrackSnapshot(snapshot.currentTrack),
  }
}

function cloneState(state: AstraIntegrationState): AstraIntegrationState {
  return {
    config: { ...state.config },
    connectionState: state.connectionState,
    lastError: state.lastError,
    lastControlError: state.lastControlError,
    snapshot: cloneSnapshot(state.snapshot),
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function isPlaybackState(value: unknown): value is AstraPlaybackState {
  return value === 'stopped' || value === 'playing' || value === 'paused' || value === 'loading'
}

function toSafeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function toSafeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function bufferToDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function getArtworkKey(trackId: string | null, artworkUrl: string | null): string | null {
  if (!trackId || !artworkUrl) return null
  return `${trackId}\n${artworkUrl}`
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_ASTRA_BASE_URL
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_ASTRA_BASE_URL
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

export function normalizeAstraIntegrationConfig(raw: unknown): AstraIntegrationConfig {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<AstraIntegrationConfig>
    : {}

  return {
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    token: typeof parsed.token === 'string' ? parsed.token.trim() : '',
  }
}

function createDefaultState(): AstraIntegrationState {
  return {
    config: normalizeAstraIntegrationConfig(null),
    connectionState: 'disabled',
    lastError: null,
    lastControlError: null,
    snapshot: null,
  }
}

function normalizeRemoteTrack(raw: unknown): RemoteTrackSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null

  const parsed = raw as Partial<RemoteTrackSnapshot>
  const id = toOptionalString(parsed.id)
  const title = toSafeString(parsed.title).trim()
  const artist = toSafeString(parsed.artist).trim()

  if (!id || !title || !artist) {
    return null
  }

  return {
    id,
    title,
    artist,
    album: toSafeString(parsed.album).trim(),
    isFavorite: Boolean(parsed.isFavorite),
    artworkUrl: toOptionalString(parsed.artworkUrl),
  }
}

function normalizeRemoteSnapshot(raw: unknown, now: () => number): RemoteNowPlayingSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    return {
      playbackState: 'stopped',
      currentTime: 0,
      duration: 0,
      queueLength: 0,
      outputDeviceLabel: null,
      visualizerLineColor: '#38bdf8',
      currentTrack: null,
      updatedAt: now(),
    }
  }

  const parsed = raw as Partial<RemoteNowPlayingSnapshot>
  return {
    playbackState: isPlaybackState(parsed.playbackState) ? parsed.playbackState : 'stopped',
    currentTime: toSafeNumber(parsed.currentTime),
    duration: toSafeNumber(parsed.duration),
    queueLength: Math.max(0, Math.floor(toSafeNumber(parsed.queueLength))),
    outputDeviceLabel: toOptionalString(parsed.outputDeviceLabel),
    visualizerLineColor: toOptionalString(parsed.visualizerLineColor) ?? '#38bdf8',
    currentTrack: normalizeRemoteTrack(parsed.currentTrack),
    updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : now(),
  }
}

function toRendererSnapshot(
  snapshot: RemoteNowPlayingSnapshot,
  artworkDataUrl: string | null,
): AstraNowPlayingSnapshot {
  const currentTrack = snapshot.currentTrack
  return {
    playbackState: snapshot.playbackState,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,
    queueLength: snapshot.queueLength,
    outputDeviceLabel: snapshot.outputDeviceLabel,
    visualizerLineColor: snapshot.visualizerLineColor,
    currentTrack: currentTrack
      ? {
          id: currentTrack.id,
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album,
          isFavorite: currentTrack.isFavorite,
          artworkDataUrl,
        } satisfies AstraTrackSnapshot
      : null,
    updatedAt: snapshot.updatedAt,
  }
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const parsed = await response.json() as { error?: unknown }
      const errorMessage = toOptionalString(parsed.error)
      if (errorMessage) return errorMessage
    }

    const text = (await response.text()).trim()
    if (text) return text
  } catch {
    // Ignore parse failures.
  }

  return `Request failed with status ${response.status}.`
}

function appendBasePath(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? `${baseUrl}` : `${baseUrl}/`
  return new URL(path.replace(/^\//, ''), normalizedBase).toString()
}

export class AstraIntegrationService {
  private readonly configPath: string
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly listeners = new Set<(state: AstraIntegrationState) => void>()
  private readonly activeConsumers = new Set<number>()

  private state = createDefaultState()
  private remoteSnapshot: RemoteNowPlayingSnapshot | null = null
  private currentArtworkKey: string | null = null
  private currentArtworkDataUrl: string | null = null
  private failedArtworkKey: string | null = null
  private streamAbortController: AbortController | null = null
  private reconnectTimer: TimerHandle | null = null
  private reconnectAttempt = 0
  private initialized = false
  private disposed = false

  constructor(options: AstraIntegrationServiceOptions) {
    this.configPath = options.configPath
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
  }

  async initialize(): Promise<void> {
    const config = await this.loadConfigFile()
    this.initialized = true
    this.state = {
      ...this.state,
      config,
      connectionState: 'disabled',
    }
    this.emitState()
    if (this.isScopeActive()) {
      await this.restartConnection()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelReconnect()
    this.abortStream()
  }

  subscribe(listener: (state: AstraIntegrationState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): AstraIntegrationState {
    return cloneState(this.state)
  }

  getConfig(): AstraIntegrationConfig {
    return { ...this.state.config }
  }

  async setConsumerActive(consumerId: number, active: boolean): Promise<AstraIntegrationState> {
    const wasActive = this.isScopeActive()
    if (active) {
      this.activeConsumers.add(consumerId)
    } else {
      this.activeConsumers.delete(consumerId)
    }

    if (!this.initialized) {
      return this.getState()
    }

    if (wasActive !== this.isScopeActive()) {
      await this.restartConnection()
    }

    return this.getState()
  }

  async saveConfig(rawConfig: unknown): Promise<AstraIntegrationConfig> {
    const config = normalizeAstraIntegrationConfig(rawConfig)
    this.state = {
      ...this.state,
      config,
      connectionState: this.isScopeActive() ? 'connecting' : 'disabled',
      lastError: null,
      lastControlError: null,
    }
    this.emitState()
    await this.persistConfigFile(config)
    await this.restartConnection()
    return { ...config }
  }

  async sendControl(command: AstraControlCommand): Promise<void> {
    if (!this.isScopeActive()) {
      const errorMessage = 'The Astra scope is not open.'
      this.state = {
        ...this.state,
        lastControlError: errorMessage,
      }
      this.emitState()
      throw new Error(errorMessage)
    }

    if (!this.state.config.token) {
      const errorMessage = 'An Astra API token is required before sending controls.'
      this.state = {
        ...this.state,
        lastControlError: errorMessage,
      }
      this.emitState()
      throw new Error(errorMessage)
    }

    const response = await this.fetchImpl(this.buildEndpoint('/v1/control'), {
      method: 'POST',
      headers: this.buildAuthHeaders({
        'Content-Type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({ command }),
    }).catch((error: unknown) => {
      throw new Error(getErrorMessage(error, 'Prism could not reach Astra.'))
    })

    if (!response.ok) {
      const errorMessage = await readResponseError(response)
      this.state = {
        ...this.state,
        lastControlError: errorMessage,
      }
      this.emitState()
      throw new Error(errorMessage)
    }

    this.state = {
      ...this.state,
      lastControlError: null,
    }
    this.emitState()
  }

  private emitState(): void {
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private async restartConnection(): Promise<void> {
    this.cancelReconnect()
    this.abortStream()

    if (!this.isScopeActive() || this.disposed) {
      this.remoteSnapshot = null
      this.currentArtworkKey = null
      this.currentArtworkDataUrl = null
      this.failedArtworkKey = null
      this.state = {
        ...this.state,
        connectionState: 'disabled',
        lastError: null,
        lastControlError: null,
        snapshot: null,
      }
      this.emitState()
      return
    }

    if (!this.state.config.token) {
      this.state = {
        ...this.state,
        connectionState: 'error',
        lastError: 'An Astra API token is required.',
      }
      this.emitState()
      return
    }

    this.state = {
      ...this.state,
      connectionState: 'connecting',
      lastError: null,
    }
    this.failedArtworkKey = null
    this.emitState()

    try {
      await this.fetchNowPlaying()
    } catch (error) {
      this.state = {
        ...this.state,
        connectionState: 'error',
        lastError: getErrorMessage(error, 'Prism could not read Astra now-playing state.'),
      }
      this.emitState()
    }

    if (!this.isScopeActive() || this.disposed) {
      return
    }

    void this.openEventStream()
  }

  private scheduleReconnect(message: string): void {
    if (!this.isScopeActive() || this.disposed) {
      return
    }

    this.state = {
      ...this.state,
      connectionState: 'error',
      lastError: message,
    }
    this.emitState()

    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10000
    this.reconnectAttempt += 1
    this.cancelReconnect()
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null
      void this.restartConnection()
    }, delay)
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) return
    this.clearTimeoutImpl(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private abortStream(): void {
    if (this.streamAbortController) {
      this.streamAbortController.abort()
      this.streamAbortController = null
    }
  }

  private async fetchNowPlaying(): Promise<void> {
    const response = await this.fetchImpl(this.buildEndpoint('/v1/now-playing'), {
      headers: this.buildAuthHeaders(),
    }).catch((error: unknown) => {
      throw new Error(getErrorMessage(error, 'Prism could not reach Astra.'))
    })

    if (!response.ok) {
      throw new Error(await readResponseError(response))
    }

    const payload = await response.json().catch(() => null)
    const snapshot = normalizeRemoteSnapshot(payload, this.now)
    this.applyRemoteSnapshot(snapshot)
    await this.refreshArtwork(snapshot.currentTrack?.id ?? null, snapshot.currentTrack?.artworkUrl ?? null)
  }

  private async openEventStream(): Promise<void> {
    this.abortStream()

    const controller = new AbortController()
    this.streamAbortController = controller

    try {
      const response = await this.fetchImpl(this.buildEndpoint('/v1/events'), {
        headers: this.buildAuthHeaders({
          Accept: 'text/event-stream',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response))
      }

      if (!response.body) {
        throw new Error('Astra did not return an event stream.')
      }

      this.reconnectAttempt = 0
      this.state = {
        ...this.state,
        connectionState: 'connected',
        lastError: null,
      }
      this.emitState()

      await this.readEventStream(response.body, controller.signal)

      if (!controller.signal.aborted && this.isScopeActive() && !this.disposed) {
        this.scheduleReconnect('The Astra event stream closed unexpectedly.')
      }
    } catch (error) {
      if (controller.signal.aborted || this.disposed) {
        return
      }

      this.scheduleReconnect(getErrorMessage(error, 'Prism could not connect to the Astra event stream.'))
    }
  }

  private async readEventStream(
    stream: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let dataLines: string[] = []

    const flushEvent = async (): Promise<void> => {
      if (dataLines.length === 0) {
        eventName = 'message'
        return
      }

      const payload = dataLines.join('\n')
      const nextEvent = eventName
      eventName = 'message'
      dataLines = []

      if (nextEvent === 'now-playing') {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(payload)
        } catch {
          return
        }

        const snapshot = normalizeRemoteSnapshot(parsed, this.now)
        this.applyRemoteSnapshot(snapshot)
        await this.refreshArtwork(snapshot.currentTrack?.id ?? null, snapshot.currentTrack?.artworkUrl ?? null)
      }
    }

    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)

        if (line === '') {
          await flushEvent()
        } else if (line.startsWith(':')) {
          // Ignore SSE comments.
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message'
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }

        newlineIndex = buffer.indexOf('\n')
      }
    }

    if (buffer.trim().length > 0) {
      const line = buffer.replace(/\r$/, '')
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    await flushEvent()
    await reader.cancel().catch(() => undefined)
  }

  private applyRemoteSnapshot(snapshot: RemoteNowPlayingSnapshot): void {
    this.remoteSnapshot = snapshot
    const artworkDataUrl = getArtworkKey(
      snapshot.currentTrack?.id ?? null,
      snapshot.currentTrack?.artworkUrl ?? null,
    ) === this.currentArtworkKey
      ? this.currentArtworkDataUrl
      : null

    this.state = {
      ...this.state,
      snapshot: toRendererSnapshot(snapshot, artworkDataUrl),
    }
    this.emitState()
  }

  private async refreshArtwork(trackId: string | null, artworkUrl: string | null): Promise<void> {
    const artworkKey = getArtworkKey(trackId, artworkUrl)
    const remoteArtworkKey = getArtworkKey(
      this.remoteSnapshot?.currentTrack?.id ?? null,
      this.remoteSnapshot?.currentTrack?.artworkUrl ?? null,
    )

    if (!artworkKey || remoteArtworkKey !== artworkKey) {
      this.currentArtworkKey = null
      this.currentArtworkDataUrl = null
      this.failedArtworkKey = null
      return
    }

    if (this.currentArtworkKey === artworkKey && this.currentArtworkDataUrl) {
      return
    }

    if (this.failedArtworkKey === artworkKey) {
      return
    }

    this.currentArtworkKey = null
    this.currentArtworkDataUrl = null

    if (artworkUrl === null) {
      return
    }

    const resolvedArtworkUrl = artworkUrl
    const response = await this.fetchImpl(resolvedArtworkUrl, {
      headers: this.buildAuthHeaders(),
    }).catch(() => null)

    if (!response || !response.ok) {
      this.failedArtworkKey = artworkKey
      return
    }

    const mimeType = response.headers.get('content-type') ?? 'image/png'
    const bytes = Buffer.from(await response.arrayBuffer())
    const artworkDataUrl = bufferToDataUrl(bytes, mimeType)

    const remoteSnapshot = this.remoteSnapshot
    if (!remoteSnapshot || getArtworkKey(
      remoteSnapshot.currentTrack?.id ?? null,
      remoteSnapshot.currentTrack?.artworkUrl ?? null,
    ) !== artworkKey) {
      return
    }

    this.currentArtworkKey = artworkKey
    this.currentArtworkDataUrl = artworkDataUrl
    this.failedArtworkKey = null
    this.state = {
      ...this.state,
      snapshot: toRendererSnapshot(remoteSnapshot, artworkDataUrl),
    }
    this.emitState()
  }

  private buildAuthHeaders(extraHeaders?: Record<string, string>): HeadersInit {
    return {
      Authorization: `Bearer ${this.state.config.token}`,
      ...extraHeaders,
    }
  }

  private isScopeActive(): boolean {
    return this.activeConsumers.size > 0
  }

  private buildEndpoint(path: string): string {
    return appendBasePath(this.state.config.baseUrl, path)
  }

  private async loadConfigFile(): Promise<AstraIntegrationConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      return normalizeAstraIntegrationConfig(JSON.parse(raw))
    } catch {
      return normalizeAstraIntegrationConfig(null)
    }
  }

  private async persistConfigFile(config: AstraIntegrationConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8')
  }
}

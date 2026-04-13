import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type {
  NowPlayingControlCommand,
  NowPlayingProviderState,
  NowPlayingSnapshot,
} from '../../types/nowPlaying'
import type { NowPlayingProviderService } from './nowPlayingProvider'

type FetchLike = typeof fetch
type AccessLike = typeof access
type AppleScriptRunner = (scriptLines: string[]) => Promise<string>

interface MacSpotifyProviderOptions {
  accessImpl?: AccessLike
  appPathCandidates?: string[]
  fetchImpl?: FetchLike
  now?: () => number
  platform?: NodeJS.Platform
  runner?: AppleScriptRunner
}

interface LocalSpotifyTrackSnapshot {
  id: string
  title: string
  artist: string
  album: string
  isFavorite: boolean
  artworkUrl: string | null
}

interface LocalSpotifySnapshot {
  playbackState: 'stopped' | 'playing' | 'paused'
  currentTime: number
  duration: number
  currentTrack: LocalSpotifyTrackSnapshot | null
  updatedAt: number
}

const FAST_POLL_MS = 1500
const SLOW_POLL_MS = 5000
const SPOTIFY_ARTWORK_COLOR = '#1ed760'
const SPOTIFY_DELIMITER = '\u001f'
const SPOTIFY_APP_BUNDLE_ID = 'com.spotify.client'
const execFileAsync = promisify(execFile)

function cloneSnapshot(snapshot: NowPlayingSnapshot | null): NowPlayingSnapshot | null {
  if (!snapshot) {
    return null
  }

  return {
    ...snapshot,
    currentTrack: snapshot.currentTrack ? { ...snapshot.currentTrack } : null,
  }
}

function cloneProviderState(state: NowPlayingProviderState): NowPlayingProviderState {
  return {
    ...state,
    snapshot: cloneSnapshot(state.snapshot),
  }
}

function getDefaultSpotifyAppCandidates(): string[] {
  return [
    '/Applications/Spotify.app',
    join(homedir(), 'Applications', 'Spotify.app'),
  ]
}

function createDefaultState(available: boolean): NowPlayingProviderState {
  return {
    providerId: 'spotify',
    connectionState: available ? 'disabled' : 'unavailable',
    lastError: null,
    lastControlError: null,
    snapshot: null,
    isConfigured: available,
    available,
    supportsTransportControls: available,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function normalizeSpotifyError(error: unknown, fallback: string): Error {
  const message = getErrorMessage(error, fallback)

  if (message.includes('(-1743)') || /not authorized|not permitted|automation/i.test(message)) {
    return new Error('Prism needs macOS Automation permission to control Spotify.')
  }

  if (message.includes('(-2700)') || message.includes('(-1728)') || /application can.?t be found/i.test(message)) {
    return new Error('Spotify.app is not installed.')
  }

  if (message.includes('(-128)')) {
    return new Error('Spotify did not allow Prism to complete that request.')
  }

  return new Error(message)
}

function normalizeString(value: string | undefined): string {
  return (value ?? '').trim()
}

function toSafeNumber(value: string | undefined): number {
  const numeric = Number.parseFloat((value ?? '').trim())
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, numeric)
}

function toOptionalUrl(value: string | undefined): string | null {
  const normalized = normalizeString(value)
  if (!normalized) {
    return null
  }

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }

  return null
}

function createTrackId(title: string, artist: string, album: string): string {
  return `spotify-local:${title}\n${artist}\n${album}`
}

function parseSpotifyStatusOutput(output: string, now: () => number): LocalSpotifySnapshot | null {
  const trimmed = output.trim()
  if (!trimmed || trimmed === 'not_running') {
    return null
  }

  const parts = trimmed.split(SPOTIFY_DELIMITER)
  if (parts[0] !== 'ok') {
    throw new Error('Prism received an invalid Spotify status payload.')
  }

  const playbackState = parts[1] === 'playing' || parts[1] === 'paused'
    ? parts[1]
    : 'stopped'
  const currentTime = toSafeNumber(parts[2])
  const duration = toSafeNumber(parts[3])
  const trackId = normalizeString(parts[4])
  const title = normalizeString(parts[5])
  const artist = normalizeString(parts[6])
  const album = normalizeString(parts[7])
  const artworkUrl = toOptionalUrl(parts[8])
  const isFavorite = normalizeString(parts[9]).toLowerCase() === 'true'

  const currentTrack = title && artist
    ? {
        id: trackId || createTrackId(title, artist, album),
        title,
        artist,
        album,
        isFavorite,
        artworkUrl,
      } satisfies LocalSpotifyTrackSnapshot
    : null

  return {
    playbackState,
    currentTime,
    duration,
    currentTrack,
    updatedAt: now(),
  }
}

function getArtworkKey(trackId: string | null, artworkUrl: string | null): string | null {
  if (!trackId || !artworkUrl) {
    return null
  }

  return `${trackId}\n${artworkUrl}`
}

function toPublicSnapshot(
  snapshot: LocalSpotifySnapshot,
  artworkDataUrl: string | null,
): NowPlayingSnapshot {
  return {
    playbackState: snapshot.playbackState,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,
    queueLength: 0,
    outputDeviceLabel: null,
    visualizerLineColor: SPOTIFY_ARTWORK_COLOR,
    currentTrack: snapshot.currentTrack
      ? {
          id: snapshot.currentTrack.id,
          title: snapshot.currentTrack.title,
          artist: snapshot.currentTrack.artist,
          album: snapshot.currentTrack.album,
          isFavorite: snapshot.currentTrack.isFavorite,
          artworkDataUrl,
        }
      : null,
    updatedAt: snapshot.updatedAt,
  }
}

function buildSpotifyStatusScript(): string[] {
  return [
    'on replace_text(source_text, search_text, replacement_text)',
    '  set AppleScript\'s text item delimiters to search_text',
    '  set text_items to every text item of source_text',
    '  set AppleScript\'s text item delimiters to replacement_text',
    '  set next_text to text_items as text',
    '  set AppleScript\'s text item delimiters to ""',
    '  return next_text',
    'end replace_text',
    'on sanitize(source_text)',
    `  set delimiter_character to "${SPOTIFY_DELIMITER}"`,
    '  set next_text to source_text as text',
    '  set next_text to my replace_text(next_text, return, " ")',
    '  set next_text to my replace_text(next_text, linefeed, " ")',
    '  set next_text to my replace_text(next_text, delimiter_character, " ")',
    '  return next_text',
    'end sanitize',
    `if application id "${SPOTIFY_APP_BUNDLE_ID}" is not running then`,
    '  return "not_running"',
    'end if',
    `tell application id "${SPOTIFY_APP_BUNDLE_ID}"`,
    '  set state_label to "stopped"',
    '  if player state is playing then set state_label to "playing"',
    '  if player state is paused then set state_label to "paused"',
    '  set track_duration to "0"',
    '  set track_id to ""',
    '  set track_title to ""',
    '  set track_artist to ""',
    '  set track_album to ""',
    '  set track_artwork_url to ""',
    '  set track_starred to "false"',
    '  try',
    '    set track_ref to current track',
    '    try',
    '      set track_duration to duration of track_ref as text',
    '    end try',
    '    try',
    '      set track_id to my sanitize(id of track_ref)',
    '    end try',
    '    try',
    '      set track_title to my sanitize(name of track_ref)',
    '    end try',
    '    try',
    '      set track_artist to my sanitize(artist of track_ref)',
    '    end try',
    '    try',
    '      set track_album to my sanitize(album of track_ref)',
    '    end try',
    '    try',
    '      set track_artwork_url to my sanitize(artwork url of track_ref)',
    '    end try',
    '    try',
    '      if starred of track_ref is true then set track_starred to "true"',
    '    end try',
    '  end try',
    `  set AppleScript's text item delimiters to "${SPOTIFY_DELIMITER}"`,
    '  set payload to {"ok", state_label, (player position as text), track_duration, track_id, track_title, track_artist, track_album, track_artwork_url, track_starred} as text',
    '  set AppleScript\'s text item delimiters to ""',
    '  return payload',
    'end tell',
  ]
}

function buildSpotifyCommandScript(command: NowPlayingControlCommand): string[] {
  const commandLine = (() => {
    switch (command) {
      case 'play':
        return 'play'
      case 'pause':
        return 'pause'
      case 'next':
        return 'next track'
      case 'previous':
        return 'previous track'
    }
  })()

  return [
    `if application id "${SPOTIFY_APP_BUNDLE_ID}" is not running then`,
    '  error "Spotify is not running." number 7001',
    'end if',
    `tell application id "${SPOTIFY_APP_BUNDLE_ID}"`,
    `  ${commandLine}`,
    'end tell',
  ]
}

async function defaultAppleScriptRunner(scriptLines: string[]): Promise<string> {
  const args = scriptLines.flatMap((line) => ['-e', line])
  const { stdout } = await execFileAsync('osascript', args)
  return stdout.trim()
}

export class MacSpotifyProvider implements NowPlayingProviderService<'spotify'> {
  readonly providerId = 'spotify'

  private readonly accessImpl: AccessLike
  private readonly appPathCandidates: string[]
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly platform: NodeJS.Platform
  private readonly runner: AppleScriptRunner
  private readonly listeners = new Set<() => void>()
  private readonly activeConsumers = new Set<number>()

  private state = createDefaultState(false)
  private initialized = false
  private disposed = false
  private currentSnapshot: LocalSpotifySnapshot | null = null
  private currentArtworkKey: string | null = null
  private currentArtworkDataUrl: string | null = null
  private failedArtworkKey: string | null = null
  private pollAbortController: AbortController | null = null
  private refreshChain = Promise.resolve()

  constructor(options: MacSpotifyProviderOptions = {}) {
    this.accessImpl = options.accessImpl ?? access
    this.appPathCandidates = options.appPathCandidates ?? getDefaultSpotifyAppCandidates()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.platform = options.platform ?? process.platform
    this.runner = options.runner ?? defaultAppleScriptRunner
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.refreshAvailability()
    this.initialized = true
    this.emitState()
    if (this.isScopeActive()) {
      this.startPolling()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.stopPolling()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getPublicConfig(): Record<string, never> {
    return {}
  }

  getProviderState(): NowPlayingProviderState {
    return cloneProviderState(this.state)
  }

  async setConsumerActive(consumerId: number, active: boolean): Promise<void> {
    if (active) {
      this.activeConsumers.add(consumerId)
    } else {
      this.activeConsumers.delete(consumerId)
    }

    if (!this.initialized) {
      return
    }

    if (!this.state.available) {
      this.resetInactiveState()
      return
    }

    if (this.isScopeActive()) {
      this.startPolling()
      return
    }

    this.stopPolling()
    this.resetInactiveState()
  }

  async saveConfig(_rawConfig: Record<string, never>): Promise<void> {
    throw new Error('Spotify does not require configuration.')
  }

  async retry(): Promise<void> {
    await this.refreshAvailability()
    if (!this.state.available) {
      this.resetInactiveState()
      this.emitState()
      throw new Error(this.platform === 'darwin'
        ? 'Install Spotify.app to enable the local Spotify integration.'
        : 'Local Spotify integration is only available on macOS.')
    }

    if (!this.isScopeActive()) {
      this.emitState()
      return
    }

    this.startPolling(true)
    await this.queueRefresh()
  }

  async sendControl(command: NowPlayingControlCommand): Promise<void> {
    if (!this.state.available) {
      throw new Error(this.platform === 'darwin'
        ? 'Install Spotify.app to enable the local Spotify integration.'
        : 'Local Spotify integration is only available on macOS.')
    }

    try {
      await this.runner(buildSpotifyCommandScript(command))
      this.state = {
        ...this.state,
        lastControlError: null,
      }
      this.emitState()
      if (this.isScopeActive()) {
        await this.queueRefresh()
      }
    } catch (error) {
      const normalizedError = normalizeSpotifyError(error, 'Prism could not control Spotify.')
      this.state = {
        ...this.state,
        lastControlError: normalizedError.message,
      }
      this.emitState()
      throw normalizedError
    }
  }

  private emitState(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private isScopeActive(): boolean {
    return this.activeConsumers.size > 0
  }

  private async refreshAvailability(): Promise<void> {
    if (this.platform !== 'darwin') {
      this.state = createDefaultState(false)
      return
    }

    for (const candidatePath of this.appPathCandidates) {
      try {
        await this.accessImpl(candidatePath)
        this.state = {
          ...createDefaultState(true),
          lastError: this.state.lastError,
          lastControlError: this.state.lastControlError,
          snapshot: cloneSnapshot(this.state.snapshot),
        }
        return
      } catch {
        continue
      }
    }

    this.state = createDefaultState(false)
  }

  private resetInactiveState(): void {
    this.currentSnapshot = null
    this.currentArtworkKey = null
    this.currentArtworkDataUrl = null
    this.failedArtworkKey = null
    this.state = {
      ...createDefaultState(this.state.available),
      available: this.state.available,
      isConfigured: this.state.available,
      supportsTransportControls: this.state.available,
      connectionState: this.state.available ? 'disabled' : 'unavailable',
    }
  }

  private startPolling(immediate = false): void {
    if (!this.state.available || !this.isScopeActive() || this.disposed) {
      return
    }

    if (this.pollAbortController) {
      if (immediate) {
        void this.queueRefresh()
      }
      return
    }

    this.state = {
      ...this.state,
      connectionState: 'connecting',
      lastError: null,
    }
    this.emitState()

    const controller = new AbortController()
    this.pollAbortController = controller

    if (immediate) {
      void this.queueRefresh()
    }

    void this.runPollLoop(controller.signal).finally(() => {
      if (this.pollAbortController === controller) {
        this.pollAbortController = null
      }
    })
  }

  private stopPolling(): void {
    if (!this.pollAbortController) {
      return
    }

    this.pollAbortController.abort()
    this.pollAbortController = null
  }

  private async runPollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.isScopeActive() && this.state.available && !this.disposed) {
      try {
        await this.queueRefresh()
      } catch {
        // Refresh errors are already reflected in provider state.
      }

      const nextDelay = this.state.snapshot?.playbackState === 'playing'
        ? FAST_POLL_MS
        : SLOW_POLL_MS

      try {
        await delay(nextDelay, undefined, { signal })
      } catch {
        break
      }
    }
  }

  private queueRefresh(): Promise<void> {
    const nextRefresh = this.refreshChain
      .catch(() => undefined)
      .then(() => this.refreshNow())
    this.refreshChain = nextRefresh
    return nextRefresh
  }

  private async refreshNow(): Promise<void> {
    try {
      const snapshot = await this.readSpotifySnapshot()
      this.currentSnapshot = snapshot
      this.failedArtworkKey = snapshot === null ? null : this.failedArtworkKey

      if (!snapshot) {
        this.currentArtworkKey = null
        this.currentArtworkDataUrl = null
        this.state = {
          ...this.state,
          connectionState: 'disabled',
          lastError: null,
          snapshot: null,
        }
        this.emitState()
        return
      }

      const artworkKey = getArtworkKey(snapshot.currentTrack?.id ?? null, snapshot.currentTrack?.artworkUrl ?? null)
      const artworkDataUrl = artworkKey && artworkKey === this.currentArtworkKey
        ? this.currentArtworkDataUrl
        : null

      this.state = {
        ...this.state,
        connectionState: 'connected',
        lastError: null,
        snapshot: toPublicSnapshot(snapshot, artworkDataUrl),
      }
      this.emitState()

      await this.refreshArtwork(snapshot.currentTrack?.id ?? null, snapshot.currentTrack?.artworkUrl ?? null)
    } catch (error) {
      const normalizedError = normalizeSpotifyError(error, 'Prism could not read Spotify now-playing state.')
      this.state = {
        ...this.state,
        connectionState: 'error',
        lastError: normalizedError.message,
        snapshot: null,
      }
      this.emitState()
      throw normalizedError
    }
  }

  private async readSpotifySnapshot(): Promise<LocalSpotifySnapshot | null> {
    const output = await this.runner(buildSpotifyStatusScript())
    return parseSpotifyStatusOutput(output, this.now)
  }

  private async refreshArtwork(trackId: string | null, artworkUrl: string | null): Promise<void> {
    const artworkKey = getArtworkKey(trackId, artworkUrl)
    const snapshotArtworkKey = getArtworkKey(
      this.currentSnapshot?.currentTrack?.id ?? null,
      this.currentSnapshot?.currentTrack?.artworkUrl ?? null,
    )

    if (!artworkKey || artworkKey !== snapshotArtworkKey) {
      this.currentArtworkKey = null
      this.currentArtworkDataUrl = null
      this.failedArtworkKey = null
      return
    }

    if (artworkKey === this.currentArtworkKey && this.currentArtworkDataUrl) {
      return
    }

    if (artworkKey === this.failedArtworkKey || !artworkUrl) {
      return
    }

    const response = await this.fetchImpl(artworkUrl).catch(() => null)
    if (!response || !response.ok) {
      this.failedArtworkKey = artworkKey
      return
    }

    const mimeType = response.headers.get('content-type') ?? 'image/jpeg'
    const bytes = Buffer.from(await response.arrayBuffer())
    const artworkDataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
    const currentSnapshot = this.currentSnapshot
    if (!currentSnapshot || getArtworkKey(
      currentSnapshot.currentTrack?.id ?? null,
      currentSnapshot.currentTrack?.artworkUrl ?? null,
    ) !== artworkKey) {
      return
    }

    this.currentArtworkKey = artworkKey
    this.currentArtworkDataUrl = artworkDataUrl
    this.failedArtworkKey = null
    this.state = {
      ...this.state,
      snapshot: toPublicSnapshot(currentSnapshot, artworkDataUrl),
    }
    this.emitState()
  }
}

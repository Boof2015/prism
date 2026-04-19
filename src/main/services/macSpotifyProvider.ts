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
type CommandRunner = (command: string, args: string[]) => Promise<string>

interface MacSpotifyProviderOptions {
  accessImpl?: AccessLike
  appPathCandidates?: string[]
  commandRunner?: CommandRunner
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

interface WindowsSpotifyStatusPayload {
  album?: unknown
  artist?: unknown
  durationMs?: unknown
  playbackStatus?: unknown
  sourceAppUserModelId?: unknown
  title?: unknown
  positionMs?: unknown
}

const FAST_POLL_MS = 1500
const SLOW_POLL_MS = 5000
const SPOTIFY_ARTWORK_COLOR = '#1ed760'
const SPOTIFY_DELIMITER = '\u001f'
const SPOTIFY_APP_BUNDLE_ID = 'com.spotify.client'
const MPRIS_PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player'
const MPRIS_PLAYER_OBJECT_PATH = '/org/mpris/MediaPlayer2'
const SESSION_DBUS_INTERFACE = 'org.freedesktop.DBus'
const SESSION_DBUS_OBJECT_PATH = '/org/freedesktop/DBus'
const SPOTIFY_MPRIS_NAME_PATTERN = /^org\.mpris\.MediaPlayer2\.spotify(?:\..+)?$/i
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

function normalizeSpotifyError(
  error: unknown,
  fallback: string,
  platform: NodeJS.Platform,
): Error {
  const message = getErrorMessage(error, fallback)

  if (platform === 'darwin') {
    if (message.includes('(-1743)') || /not authorized|not permitted|automation/i.test(message)) {
      return new Error('Prism needs macOS Automation permission to control Spotify.')
    }

    if (message.includes('(-2700)') || message.includes('(-1728)') || /application can.?t be found/i.test(message)) {
      return new Error('Spotify.app is not installed.')
    }

    if (message.includes('(-128)')) {
      return new Error('Spotify did not allow Prism to complete that request.')
    }
  }

  if (platform === 'linux') {
    if (/spotify is not running/i.test(message)
      || /ServiceUnknown|NameHasNoOwner|The name .* was not provided/i.test(message)) {
      return new Error('Spotify is not running.')
    }

    if (/cannot autolaunch D-Bus|No such file or directory|NoServer|Cannot connect to session bus|Failed to connect to socket/i.test(message)) {
      return new Error('Prism could not access the Linux session media bus for Spotify.')
    }
  }

  if (platform === 'win32') {
    if (/spotify is not running/i.test(message) || /No current Spotify media session/i.test(message)) {
      return new Error('Spotify is not running.')
    }

    if (/GlobalSystemMediaTransportControls|Windows\.Media\.Control|WinRT/i.test(message)) {
      return new Error('Prism could not access Windows media controls for Spotify.')
    }
  }

  return new Error(message)
}

function normalizeString(value: string | undefined): string {
  return (value ?? '').trim()
}

function toSafeNumber(value: string | number | undefined): number {
  const numeric = typeof value === 'number'
    ? value
    : Number.parseFloat((value ?? '').trim())
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, numeric)
}

function millisecondsToSeconds(value: string | number | undefined): number {
  return toSafeNumber(value) / 1000
}

function microsecondsToSeconds(value: string | number | undefined): number {
  return toSafeNumber(value) / 1_000_000
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

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeGVariantString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, '\'')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

function extractGdbusStringVariant(output: string, key: string): string {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@s )?'((?:\\\\.|[^'])*)'>`))
  return normalizeString(match?.[1] ? decodeGVariantString(match[1]) : '')
}

function extractGdbusObjectPathVariant(output: string, key: string): string {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <objectpath '((?:\\\\.|[^'])*)'>`))
  return normalizeString(match?.[1] ? decodeGVariantString(match[1]) : '')
}

function extractGdbusInt64Variant(output: string, key: string): number {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@x |@t |int64 |uint64 )?(-?\\d+)>`))
  if (!match) {
    return 0
  }

  const numeric = Number.parseInt(match[1], 10)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, numeric)
}

function extractGdbusStringArrayVariant(output: string, key: string): string[] {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@as )?\\[([\\s\\S]*?)\\]>`))
  if (!match?.[1]) {
    return []
  }

  return Array.from(match[1].matchAll(/'((?:\\.|[^'])*)'/g), (entry) => {
    return normalizeString(decodeGVariantString(entry[1] ?? ''))
  }).filter(Boolean)
}

function parseLinuxPlaybackState(value: string): LocalSpotifySnapshot['playbackState'] {
  switch (value.toLowerCase()) {
    case 'playing':
      return 'playing'
    case 'paused':
      return 'paused'
    default:
      return 'stopped'
  }
}

function parseWindowsPlaybackState(value: string): LocalSpotifySnapshot['playbackState'] {
  switch (value.toLowerCase()) {
    case 'playing':
      return 'playing'
    case 'paused':
      return 'paused'
    default:
      return 'stopped'
  }
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
  const duration = millisecondsToSeconds(parts[3])
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

function parseLinuxSpotifyStatusOutput(output: string, now: () => number): LocalSpotifySnapshot | null {
  const trimmed = output.trim()
  if (!trimmed) {
    return null
  }

  const playbackState = parseLinuxPlaybackState(extractGdbusStringVariant(trimmed, 'PlaybackStatus'))
  const currentTime = microsecondsToSeconds(extractGdbusInt64Variant(trimmed, 'Position'))
  const duration = microsecondsToSeconds(extractGdbusInt64Variant(trimmed, 'mpris:length'))
  const title = extractGdbusStringVariant(trimmed, 'xesam:title')
  const artist = extractGdbusStringArrayVariant(trimmed, 'xesam:artist').join(', ')
  const album = extractGdbusStringVariant(trimmed, 'xesam:album')
  const artworkUrl = toOptionalUrl(extractGdbusStringVariant(trimmed, 'mpris:artUrl'))
  const trackId = extractGdbusStringVariant(trimmed, 'xesam:url')
    || extractGdbusObjectPathVariant(trimmed, 'mpris:trackid')

  const currentTrack = title && artist
    ? {
        id: trackId || createTrackId(title, artist, album),
        title,
        artist,
        album,
        isFavorite: false,
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

function parseWindowsSpotifyStatusOutput(output: string, now: () => number): LocalSpotifySnapshot | null {
  const trimmed = output.trim()
  if (!trimmed || trimmed === 'null') {
    return null
  }

  const payload = JSON.parse(trimmed) as WindowsSpotifyStatusPayload
  const title = normalizeString(typeof payload.title === 'string' ? payload.title : '')
  const artist = normalizeString(typeof payload.artist === 'string' ? payload.artist : '')
  const album = normalizeString(typeof payload.album === 'string' ? payload.album : '')
  const sourceAppUserModelId = normalizeString(typeof payload.sourceAppUserModelId === 'string' ? payload.sourceAppUserModelId : '')
  const playbackState = parseWindowsPlaybackState(typeof payload.playbackStatus === 'string' ? payload.playbackStatus : '')
  const currentTime = millisecondsToSeconds(
    typeof payload.positionMs === 'number' || typeof payload.positionMs === 'string'
      ? payload.positionMs
      : 0,
  )
  const duration = millisecondsToSeconds(
    typeof payload.durationMs === 'number' || typeof payload.durationMs === 'string'
      ? payload.durationMs
      : 0,
  )

  const currentTrack = title && artist
    ? {
        id: sourceAppUserModelId
          ? `${sourceAppUserModelId}\n${title}\n${artist}\n${album}`
          : createTrackId(title, artist, album),
        title,
        artist,
        album,
        isFavorite: false,
        artworkUrl: null,
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

function parseLinuxBusNames(output: string): string[] {
  return Array.from(output.matchAll(/'((?:\\.|[^'])*)'/g), (entry) => {
    return normalizeString(decodeGVariantString(entry[1] ?? ''))
  }).filter(Boolean)
}

function getLinuxSpotifyBusName(output: string): string | null {
  return parseLinuxBusNames(output).find((name) => SPOTIFY_MPRIS_NAME_PATTERN.test(name)) ?? null
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

async function defaultCommandRunner(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args)
  return stdout.trim()
}

function buildLinuxListNamesArgs(): string[] {
  return [
    'call',
    '--session',
    '--dest',
    SESSION_DBUS_INTERFACE,
    '--object-path',
    SESSION_DBUS_OBJECT_PATH,
    '--method',
    `${SESSION_DBUS_INTERFACE}.ListNames`,
  ]
}

function buildLinuxPropertiesArgs(busName: string): string[] {
  return [
    'call',
    '--session',
    '--dest',
    busName,
    '--object-path',
    MPRIS_PLAYER_OBJECT_PATH,
    '--method',
    'org.freedesktop.DBus.Properties.GetAll',
    MPRIS_PLAYER_INTERFACE,
  ]
}

function buildLinuxCommandArgs(busName: string, command: NowPlayingControlCommand): string[] {
  const methodName = (() => {
    switch (command) {
      case 'play':
        return 'Play'
      case 'pause':
        return 'Pause'
      case 'next':
        return 'Next'
      case 'previous':
        return 'Previous'
    }
  })()

  return [
    'call',
    '--session',
    '--dest',
    busName,
    '--object-path',
    MPRIS_PLAYER_OBJECT_PATH,
    '--method',
    `${MPRIS_PLAYER_INTERFACE}.${methodName}`,
  ]
}

function buildWindowsPowerShellArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]
}

function buildWindowsPowerShellPrelude(): string[] {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]',
    '[void][System.WindowsRuntimeSystemExtensions]',
    'function Await-WinRT($operation) { return [System.WindowsRuntimeSystemExtensions]::AsTask($operation).GetAwaiter().GetResult() }',
    'function Get-SpotifySession {',
    '  $manager = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())',
    '  $currentSession = $manager.GetCurrentSession()',
    '  if ($currentSession -and $currentSession.SourceAppUserModelId -match "spotify") {',
    '    return $currentSession',
    '  }',
    '  return $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match "spotify" } | Select-Object -First 1',
    '}',
  ]
}

function buildWindowsProbeScript(): string {
  return [
    ...buildWindowsPowerShellPrelude(),
    '$null = Get-SpotifySession',
    'Write-Output "ready"',
  ].join('\n')
}

function buildWindowsStatusScript(): string {
  return [
    ...buildWindowsPowerShellPrelude(),
    '$session = Get-SpotifySession',
    'if (-not $session) {',
    '  Write-Output "null"',
    '  exit 0',
    '}',
    '$timeline = $session.GetTimelineProperties()',
    '$playbackInfo = $session.GetPlaybackInfo()',
    '$mediaProperties = Await-WinRT ($session.TryGetMediaPropertiesAsync())',
    '$payload = [PSCustomObject]@{',
    '  playbackStatus = [string]$playbackInfo.PlaybackStatus',
    '  positionMs = [double]$timeline.Position.TotalMilliseconds',
    '  durationMs = [double](($timeline.EndTime - $timeline.StartTime).TotalMilliseconds)',
    '  title = [string]$mediaProperties.Title',
    '  artist = [string]$mediaProperties.Artist',
    '  album = [string]$mediaProperties.AlbumTitle',
    '  sourceAppUserModelId = [string]$session.SourceAppUserModelId',
    '}',
    '$payload | ConvertTo-Json -Compress',
  ].join('\n')
}

function buildWindowsControlScript(command: NowPlayingControlCommand): string {
  const methodName = (() => {
    switch (command) {
      case 'play':
        return 'TryPlayAsync'
      case 'pause':
        return 'TryPauseAsync'
      case 'next':
        return 'TrySkipNextAsync'
      case 'previous':
        return 'TrySkipPreviousAsync'
    }
  })()

  return [
    ...buildWindowsPowerShellPrelude(),
    '$session = Get-SpotifySession',
    'if (-not $session) {',
    '  throw "Spotify is not running."',
    '}',
    `$result = Await-WinRT ($session.${methodName}())`,
    'if (-not $result) {',
    '  throw "Spotify did not allow Prism to complete that request."',
    '}',
    'Write-Output "ok"',
  ].join('\n')
}

export class SpotifyProvider implements NowPlayingProviderService<'spotify'> {
  readonly providerId = 'spotify'

  private readonly accessImpl: AccessLike
  private readonly appPathCandidates: string[]
  private readonly commandRunner: CommandRunner
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
    this.commandRunner = options.commandRunner ?? defaultCommandRunner
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
      throw new Error(this.getUnavailableMessage())
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
      throw new Error(this.getUnavailableMessage())
    }

    try {
      await this.sendPlatformControl(command)
      this.state = {
        ...this.state,
        lastControlError: null,
      }
      this.emitState()
      if (this.isScopeActive()) {
        await this.queueRefresh()
      }
    } catch (error) {
      const normalizedError = normalizeSpotifyError(error, 'Prism could not control Spotify.', this.platform)
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

  private getUnavailableMessage(): string {
    if (this.platform === 'darwin') {
      return 'Install Spotify.app to enable the local Spotify integration.'
    }

    if (this.platform === 'linux') {
      return this.state.lastError ?? 'Prism could not access Linux session media controls for Spotify.'
    }

    if (this.platform === 'win32') {
      return this.state.lastError ?? 'Prism could not access Windows media controls for Spotify.'
    }

    return 'Local Spotify integration is currently available on macOS, Linux, and Windows.'
  }

  private async refreshAvailability(): Promise<void> {
    if (this.platform === 'linux') {
      try {
        await this.commandRunner('gdbus', buildLinuxListNamesArgs())
        this.state = {
          ...createDefaultState(true),
          lastError: this.state.lastError,
          lastControlError: this.state.lastControlError,
          snapshot: cloneSnapshot(this.state.snapshot),
        }
      } catch (error) {
        this.state = {
          ...createDefaultState(false),
          lastError: normalizeSpotifyError(error, 'Prism could not access Linux session media controls for Spotify.', this.platform).message,
        }
      }
      return
    }

    if (this.platform === 'win32') {
      try {
        await this.commandRunner('powershell.exe', buildWindowsPowerShellArgs(buildWindowsProbeScript()))
        this.state = {
          ...createDefaultState(true),
          lastError: this.state.lastError,
          lastControlError: this.state.lastControlError,
          snapshot: cloneSnapshot(this.state.snapshot),
        }
      } catch (error) {
        this.state = {
          ...createDefaultState(false),
          lastError: normalizeSpotifyError(error, 'Prism could not access Windows media controls for Spotify.', this.platform).message,
        }
      }
      return
    }

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
    const preservedLastError = this.state.available ? null : this.state.lastError
    const preservedLastControlError = this.state.available ? null : this.state.lastControlError
    this.state = {
      ...createDefaultState(this.state.available),
      available: this.state.available,
      isConfigured: this.state.available,
      supportsTransportControls: this.state.available,
      connectionState: this.state.available ? 'disabled' : 'unavailable',
      lastError: preservedLastError,
      lastControlError: preservedLastControlError,
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
      const normalizedError = normalizeSpotifyError(error, 'Prism could not read Spotify now-playing state.', this.platform)
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
    if (this.platform === 'linux') {
      const busName = await this.resolveLinuxSpotifyBusName()
      if (!busName) {
        return null
      }

      const output = await this.commandRunner('gdbus', buildLinuxPropertiesArgs(busName))
      return parseLinuxSpotifyStatusOutput(output, this.now)
    }

    if (this.platform === 'win32') {
      const output = await this.commandRunner('powershell.exe', buildWindowsPowerShellArgs(buildWindowsStatusScript()))
      return parseWindowsSpotifyStatusOutput(output, this.now)
    }

    const output = await this.runner(buildSpotifyStatusScript())
    return parseSpotifyStatusOutput(output, this.now)
  }

  private async resolveLinuxSpotifyBusName(): Promise<string | null> {
    const output = await this.commandRunner('gdbus', buildLinuxListNamesArgs())
    return getLinuxSpotifyBusName(output)
  }

  private async sendPlatformControl(command: NowPlayingControlCommand): Promise<void> {
    if (this.platform === 'linux') {
      const busName = await this.resolveLinuxSpotifyBusName()
      if (!busName) {
        throw new Error('Spotify is not running.')
      }

      await this.commandRunner('gdbus', buildLinuxCommandArgs(busName, command))
      return
    }

    if (this.platform === 'win32') {
      await this.commandRunner('powershell.exe', buildWindowsPowerShellArgs(buildWindowsControlScript(command)))
      return
    }

    await this.runner(buildSpotifyCommandScript(command))
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

export { SpotifyProvider as MacSpotifyProvider }

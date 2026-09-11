import { execFile } from 'node:child_process'
import { access, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import type { NowPlayingControlCommand, NowPlayingProviderState, NowPlayingSnapshot } from '../../types/nowPlaying'
import type { NativeWindowsMediaAPI } from '../../types/nativeWindowsMedia'
import type { NowPlayingProviderService } from './nowPlayingProvider'
import {
  buildLinuxCommandArgs, buildLinuxListNamesArgs, buildLinuxPropertiesArgs,
  extractGdbusInt64Variant, extractGdbusObjectPathVariant, extractGdbusStringArrayVariant,
  extractGdbusStringVariant, parseLinuxBusNames,
} from './localMediaMpris'

const execFileAsync = promisify(execFile)
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 5000
const TIDAL_BUNDLE_ID = 'com.tidal.desktop'
type CommandRunner = (command: string, args: string[], signal: AbortSignal) => Promise<string>

interface TidalProviderOptions {
  platform?: NodeJS.Platform
  now?: () => number
  commandRunner?: CommandRunner
  accessImpl?: typeof access
  appPathCandidates?: string[]
  fetchImpl?: typeof fetch
  windowsMediaApi?: NativeWindowsMediaAPI | null
}

// Executed by the system JXA host, without loading any bundled framework or helper.
// Keep reads optional: MediaRemote is private and fields vary by app and OS version.
export const TIDAL_MAC_STATUS_SCRIPT = `
ObjC.import('Foundation');
function optional(read, fallback) {
  try { var value = read(); return value == null ? fallback : value; } catch (_) { return fallback; }
}
function run() {
  var framework = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework');
  if (!framework.load) throw new Error('TIDAL_MEDIA_UNAVAILABLE: macOS media information cannot be loaded.');
  var request = $.NSClassFromString('MRNowPlayingRequest');
  if (!request || !request.respondsToSelector('localNowPlayingItem') ||
      !request.respondsToSelector('localNowPlayingPlayerPath') || !request.respondsToSelector('localIsPlaying')) {
    throw new Error('TIDAL_MEDIA_UNAVAILABLE: This macOS version does not expose local media information.');
  }
  var item = request.localNowPlayingItem;
  if (!item || !item.js) return 'null';
  var client = request.localNowPlayingPlayerPath.client;
  var bundleIdentifier = optional(function () { return ObjC.unwrap(client.bundleIdentifier); }, '');
  var parentApplicationBundleIdentifier = optional(function () { return ObjC.unwrap(client.parentApplicationBundleIdentifier); }, '');
  if (bundleIdentifier !== 'com.tidal.desktop' && parentApplicationBundleIdentifier !== 'com.tidal.desktop') return 'null';
  var info = item.nowPlayingInfo;
  function field(name) { return optional(function () { return ObjC.unwrap(info.objectForKey('kMRMediaRemoteNowPlayingInfo' + name)); }, null); }
  var timestampMs = optional(function () { return Number(info.objectForKey('kMRMediaRemoteNowPlayingInfoTimestamp').timeIntervalSince1970) * 1000; }, null);
  var artworkData = optional(function () {
    var data = info.objectForKey('kMRMediaRemoteNowPlayingInfoArtworkData');
    return data.length > 0 && data.length <= 4194304 ? ObjC.unwrap(data.base64EncodedStringWithOptions(0)) : null;
  }, null);
  return JSON.stringify({
    bundleIdentifier: bundleIdentifier, parentApplicationBundleIdentifier: parentApplicationBundleIdentifier,
    title: field('Title'), artist: field('Artist'), album: field('Album'),
    id: field('ContentItemIdentifier'), playing: !!request.localIsPlaying,
    duration: field('Duration'), elapsedTime: field('ElapsedTime'), timestampMs: timestampMs,
    artworkData: artworkData, artworkMimeType: field('ArtworkMIMEType')
  });
}
`

function string(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const details = error as { killed?: boolean; stderr?: string }
    if (details.killed) return 'The local media query timed out.'
    if (details.stderr?.trim()) return details.stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}
function isMissingSession(error: unknown): boolean {
  return /ServiceUnknown|NameHasNoOwner|UnknownObject|was not provided by any .service/i.test(errorMessage(error))
}
function isTidalIdentity(value: string): boolean {
  return /^(tidal|tidal[- ]hi[- ]?fi|com\.mastermindzh\.tidal-hifi)(?:\.desktop)?$/i.test(value)
}
export function isTidalWindowsSession(sourceId: string): boolean {
  return /^(com\.squirrel\.tidal\.tidal|tidal(?:\.exe)?|com\.tidal\.desktop)$/i.test(sourceId)
    || /^TIDALMusicAS\.TIDAL_[a-z0-9]+!TIDAL$/i.test(sourceId)
}
function dataArtwork(value: unknown): string | null {
  const data = string(value)
  return data.length <= MAX_ARTWORK_BYTES * 4 / 3 + 100
    && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(data) ? data : null
}
function snapshot(fields: {
  title: unknown; artist?: unknown; album?: unknown; id?: unknown
  playbackState: NowPlayingSnapshot['playbackState']; currentTime: number; duration: number
  artworkDataUrl?: string | null
}, now: number): NowPlayingSnapshot | null {
  const title = string(fields.title)
  if (!title) return null
  const artist = string(fields.artist)
  const album = string(fields.album)
  return {
    playbackState: fields.playbackState,
    currentTime: fields.duration > 0 ? Math.min(fields.currentTime, fields.duration) : fields.currentTime,
    duration: fields.duration, updatedAt: now, queueLength: 0, outputDeviceLabel: null,
    visualizerLineColor: '#f4f6f8',
    currentTrack: {
      id: `tidal:${string(fields.id) || `${title}\n${artist}\n${album}`}`,
      title, artist, album, isFavorite: false, artworkDataUrl: fields.artworkDataUrl ?? null,
    },
  }
}

export function parseTidalMacStatus(output: string, now: number): NowPlayingSnapshot | null {
  const raw: unknown = JSON.parse(output)
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid TIDAL macOS media response.')
  const data = raw as Record<string, unknown>
  if (data.bundleIdentifier !== TIDAL_BUNDLE_ID && data.parentApplicationBundleIdentifier !== TIDAL_BUNDLE_ID) return null
  const elapsed = number(data.elapsedTime)
  const timestamp = number(data.timestampMs)
  // Without a reported position there is nothing to extrapolate.
  const advance = data.playing === true && typeof data.elapsedTime === 'number' && timestamp > 0
    ? Math.max(0, now - timestamp) / 1000 : 0
  return snapshot({
    ...data, title: data.title, playbackState: data.playing === true ? 'playing' : 'paused',
    currentTime: elapsed + advance, duration: number(data.duration),
    artworkDataUrl: dataArtwork(`data:${string(data.artworkMimeType)};base64,${string(data.artworkData)}`),
  }, now)
}

export class TidalProvider implements NowPlayingProviderService<'tidal'> {
  readonly providerId = 'tidal'
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly run: CommandRunner
  private readonly options: TidalProviderOptions
  private readonly listeners = new Set<() => void>()
  private readonly consumers = new Set<number>()
  private readonly lifetime = new AbortController()
  private poll: AbortController | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private initialization: Promise<void> | null = null
  private selectedBus: string | null = null
  private artworkCache: { key: string; data: string | null; retryAt: number } | null = null
  private state: NowPlayingProviderState = {
    providerId: 'tidal', connectionState: 'unavailable', available: false, isConfigured: false,
    supportsTransportControls: false, snapshot: null, lastError: null, lastControlError: null,
  }

  constructor(options: TidalProviderOptions = {}) {
    this.options = options
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? Date.now
    this.run = options.commandRunner ?? (async (command, args, signal) => {
      const { stdout } = await execFileAsync(command, args, {
        signal, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 6 * 1024 * 1024,
      })
      return stdout.trim()
    })
  }

  getPublicConfig(): Record<string, never> { return {} }
  getProviderState(): NowPlayingProviderState { return structuredClone(this.state) }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(update: Partial<NowPlayingProviderState>, signal = this.lifetime.signal): void {
    if (signal.aborted || this.lifetime.signal.aborted) return
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(work)
    this.chain = next
    return next
  }
  initialize(): Promise<void> {
    this.initialization ??= this.enqueue(() => this.probe()).then(() => { this.startPolling() })
    return this.initialization
  }
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.stopPolling()
    this.listeners.clear()
    this.consumers.clear()
    await this.chain.catch(() => undefined)
  }
  async saveConfig(): Promise<void> { throw new Error('TIDAL does not require configuration.') }
  async setConsumerActive(consumerId: number, active: boolean): Promise<void> {
    if (this.lifetime.signal.aborted) return
    if (active) this.consumers.add(consumerId)
    else this.consumers.delete(consumerId)
    if (!this.consumers.size) {
      this.stopPolling()
      this.selectedBus = null
      this.artworkCache = null
      this.publish({ snapshot: null, connectionState: this.state.available ? 'disabled' : 'unavailable' })
    } else if (this.initialization) {
      await this.initialization
      this.startPolling()
    }
  }
  async retry(): Promise<void> {
    if (this.lifetime.signal.aborted) return
    await this.initialize()
    this.stopPolling()
    await this.enqueue(() => this.probe())
    if (!this.state.available) throw new Error(this.state.lastError ?? 'TIDAL integration is unavailable.')
    this.artworkCache = null
    const refresh = this.startPolling()
    await refresh
  }
  private async probe(): Promise<void> {
    const signal = this.lifetime.signal
    signal.throwIfAborted()
    try {
      if (this.platform === 'darwin') {
        const candidates = this.options.appPathCandidates ?? ['/Applications/TIDAL.app', join(homedir(), 'Applications/TIDAL.app')]
        const installed = await Promise.all(candidates.map(path => (this.options.accessImpl ?? access)(path).then(() => true, () => false)))
        if (!installed.some(Boolean)) throw new Error('Install TIDAL.app, then click Retry to enable local track information.')
        parseTidalMacStatus(await this.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', TIDAL_MAC_STATUS_SCRIPT], signal), this.now())
      } else if (this.platform === 'linux') {
        await this.run('gdbus', buildLinuxListNamesArgs(), signal)
      } else if (this.platform === 'win32') {
        const api = this.options.windowsMediaApi
        if (!api?.getTidalPlaybackState || !api.sendTidalControl) throw new Error('TIDAL Windows media integration is missing. Rebuild or update Prism, then click Retry.')
        const support = api.getSupport()
        if (!support.available) throw new Error(support.reason ?? 'Windows system media controls are unavailable. Click Retry after restoring access.')
      } else {
        throw new Error('Local TIDAL integration is supported on macOS, Windows, and Linux.')
      }
      this.publish({ available: true, isConfigured: true, supportsTransportControls: this.platform !== 'darwin',
        connectionState: 'disabled', snapshot: null, lastError: null, lastControlError: null }, signal)
    } catch (error) {
      this.publish({ available: false, isConfigured: false, supportsTransportControls: false,
        connectionState: 'unavailable', snapshot: null, lastError: this.describeError(error) }, signal)
    }
  }
  private describeError(error: unknown): string {
    const message = errorMessage(error)
    if (this.platform === 'darwin') return `TIDAL track information is unavailable. ${message} Retry after checking TIDAL and macOS compatibility.`
    if (this.platform === 'linux') return `Could not access TIDAL through the Linux session media bus. ${message} Check gdbus and your client's MPRIS support, then click Retry.`
    return message
  }
  private stopPolling(): void {
    this.poll?.abort()
    this.poll = null
  }
  private startPolling(): Promise<void> | undefined {
    if (this.poll || !this.consumers.size || !this.state.available || this.lifetime.signal.aborted) return
    const controller = new AbortController()
    this.poll = controller
    this.publish({ connectionState: 'connecting' }, controller.signal)
    const first = this.enqueue(() => this.refresh(controller.signal))
    void (async () => {
      await first
      while (!controller.signal.aborted && this.state.available) {
        await delay(this.state.snapshot?.playbackState === 'playing' ? 1500 : 5000, undefined, { signal: controller.signal })
        await this.enqueue(() => this.refresh(controller.signal))
      }
    })().catch(() => undefined).finally(() => { if (this.poll === controller) this.poll = null })
    return first
  }
  private async refresh(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.lifetime.signal.aborted) return
    try {
      const { state, artworkUrl } = await this.readSnapshot(signal)
      if (!state) this.artworkCache = null
      if (state?.currentTrack && this.artworkCache?.key === `${state.currentTrack.id}\n${artworkUrl}`) {
        state.currentTrack.artworkDataUrl = this.artworkCache.data
      }
      this.publish({ snapshot: state, connectionState: state ? 'connected' : 'disabled', lastError: null }, signal)
      if (state?.currentTrack && artworkUrl && !signal.aborted) {
        const artwork = await this.readArtwork(`${state.currentTrack.id}\n${artworkUrl}`, artworkUrl, signal)
        if (artwork) this.publish({ snapshot: { ...state, currentTrack: { ...state.currentTrack, artworkDataUrl: artwork } } }, signal)
      }
    } catch (error) {
      if (signal.aborted || this.lifetime.signal.aborted) return
      this.selectedBus = null
      this.artworkCache = null
      const unavailable = this.platform === 'darwin' && /TIDAL_MEDIA_UNAVAILABLE|selector|not a function/i.test(errorMessage(error))
      this.publish({ snapshot: null, connectionState: unavailable ? 'unavailable' : 'error', lastError: this.describeError(error),
        ...(unavailable ? { available: false, isConfigured: false, supportsTransportControls: false } : {}) }, signal)
    }
  }
  private async readSnapshot(signal: AbortSignal): Promise<{ state: NowPlayingSnapshot | null; artworkUrl?: string }> {
    if (this.platform === 'darwin') {
      return { state: parseTidalMacStatus(await this.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', TIDAL_MAC_STATUS_SCRIPT], signal), this.now()) }
    }
    if (this.platform === 'win32') {
      const data = this.options.windowsMediaApi!.getTidalPlaybackState!()
      if (!data || !isTidalWindowsSession(data.sourceAppUserModelId)) return { state: null }
      const status = string(data.playbackStatus).toLowerCase()
      return { state: snapshot({ ...data, id: `${data.sourceAppUserModelId}\n${data.title}\n${data.artist}\n${data.album}`,
        playbackState: status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'stopped',
        duration: number(data.durationMs) / 1000, currentTime: number(data.positionMs) / 1000,
        artworkDataUrl: dataArtwork(data.artworkDataUrl) }, this.now()) }
    }
    const names = parseLinuxBusNames(await this.run('gdbus', buildLinuxListNamesArgs(), signal))
      .filter(name => name.startsWith('org.mpris.MediaPlayer2.')).sort()
    const candidates: { bus: string; state: NowPlayingSnapshot | null; artworkUrl: string }[] = []
    for (const bus of names) {
      signal.throwIfAborted()
      let identified = false
      try {
        const identity = await this.run('gdbus', buildLinuxPropertiesArgs(bus, 'org.mpris.MediaPlayer2'), signal)
        if (!this.matchesLinuxIdentity(identity)) continue
        identified = true
        const data = await this.run('gdbus', buildLinuxPropertiesArgs(bus), signal)
        const status = extractGdbusStringVariant(data, 'PlaybackStatus')
        candidates.push({ bus, artworkUrl: extractGdbusStringVariant(data, 'mpris:artUrl'), state: snapshot({
          title: extractGdbusStringVariant(data, 'xesam:title'), artist: extractGdbusStringArrayVariant(data, 'xesam:artist').join(', '),
          album: extractGdbusStringVariant(data, 'xesam:album'),
          id: `${bus}\n${extractGdbusObjectPathVariant(data, 'mpris:trackid')}\n${extractGdbusStringVariant(data, 'xesam:title')}\n${extractGdbusStringArrayVariant(data, 'xesam:artist').join(', ')}\n${extractGdbusStringVariant(data, 'xesam:album')}`,
          playbackState: status === 'Playing' ? 'playing' : status === 'Paused' ? 'paused' : 'stopped',
          duration: extractGdbusInt64Variant(data, 'mpris:length') / 1_000_000,
          currentTime: extractGdbusInt64Variant(data, 'Position') / 1_000_000,
        }, this.now()) })
      } catch (error) {
        if (signal.aborted) throw error
        if ((identified || bus === this.selectedBus) && !isMissingSession(error)) throw error
        // Unrelated or disappearing media clients must not break TIDAL discovery.
      }
    }
    candidates.sort((a, b) => Number(b.state?.playbackState === 'playing') - Number(a.state?.playbackState === 'playing')
      || Number(b.bus === this.selectedBus) - Number(a.bus === this.selectedBus))
    const selected = candidates.find(candidate => candidate.state) ?? candidates[0]
    if (!signal.aborted) this.selectedBus = selected?.bus ?? null
    return selected ?? { state: null }
  }
  private matchesLinuxIdentity(output: string): boolean {
    return isTidalIdentity(extractGdbusStringVariant(output, 'Identity'))
      || isTidalIdentity(extractGdbusStringVariant(output, 'DesktopEntry'))
  }
  async sendControl(command: NowPlayingControlCommand): Promise<void> {
    return this.enqueue(async () => {
      const signal = this.lifetime.signal
      signal.throwIfAborted()
      try {
        if (!['play', 'pause', 'next', 'previous'].includes(command)) throw new Error('Unsupported TIDAL control command.')
        if (!this.state.supportsTransportControls) throw new Error('TIDAL transport controls are unavailable on this platform. Use the TIDAL app.')
        if (this.platform === 'linux') {
          const bus = this.selectedBus
          if (!bus) throw new Error('No active TIDAL media session. Start playback in TIDAL, then click Retry.')
          const identity = await this.run('gdbus', buildLinuxPropertiesArgs(bus, 'org.mpris.MediaPlayer2'), signal)
          if (!this.matchesLinuxIdentity(identity)) throw new Error('The selected media session no longer belongs to TIDAL.')
          await this.run('gdbus', buildLinuxCommandArgs(bus, command), signal)
        } else {
          if (!this.options.windowsMediaApi!.sendTidalControl!(command)) throw new Error('TIDAL did not accept the playback command.')
        }
        this.publish({ lastControlError: null }, signal)
      } catch (error) {
        this.publish({ lastControlError: errorMessage(error) }, signal)
        throw error
      }
    }).then(async () => { if (this.poll) await this.enqueue(() => this.refresh(this.poll?.signal ?? this.lifetime.signal)) })
  }
  private async readArtwork(key: string, url: string, signal: AbortSignal): Promise<string | null> {
    if (this.artworkCache?.key === key && this.artworkCache.retryAt > this.now()) return this.artworkCache.data
    let data: string | null = null
    try {
      const parsed = new URL(url)
      const artworkSignal = AbortSignal.any([signal, AbortSignal.timeout(COMMAND_TIMEOUT_MS)])
      if (parsed.protocol === 'file:' && !parsed.host) {
        const handle = await open(fileURLToPath(parsed), 'r')
        try {
          artworkSignal.throwIfAborted()
          const info = await handle.stat()
          if (info.isFile() && info.size > 0 && info.size <= MAX_ARTWORK_BYTES) {
            const buffer = Buffer.alloc(info.size)
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
            const mime = /\.png$/i.test(parsed.pathname) ? 'image/png' : /\.webp$/i.test(parsed.pathname) ? 'image/webp' : 'image/jpeg'
            data = bytesRead ? `data:${mime};base64,${buffer.subarray(0, bytesRead).toString('base64')}` : null
          }
        } finally { await handle.close() }
      } else if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        const response = await (this.options.fetchImpl ?? fetch)(url, { signal: artworkSignal })
        const mime = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
        if (response.ok && /^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime) && response.body) {
          const reader = response.body.getReader()
          const chunks: Uint8Array[] = []
          let total = 0
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              total += next.value.length
              if (total > MAX_ARTWORK_BYTES) throw new Error('Artwork is too large.')
              chunks.push(next.value)
            }
            data = total ? `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}` : null
          } finally { await reader.cancel().catch(() => undefined) }
        } else { await response.body?.cancel() }
      }
    } catch { /* Artwork is optional; never discard a valid track when loading it fails. */ }
    if (!signal.aborted) this.artworkCache = { key, data, retryAt: data ? Infinity : this.now() + 30_000 }
    return data
  }
}

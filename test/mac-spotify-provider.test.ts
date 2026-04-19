import assert from 'node:assert/strict'
import test from 'node:test'
import { MacSpotifyProvider } from '../src/main/services/macSpotifyProvider'

const DELIMITER = '\u001f'

function createStatusPayload(options: {
  album?: string
  artist?: string
  artworkUrl?: string
  duration?: number
  id?: string
  isFavorite?: boolean
  playbackState: 'playing' | 'paused' | 'stopped'
  position?: number
  title?: string
}): string {
  return [
    'ok',
    options.playbackState,
    String(options.position ?? 0),
    String(options.duration ?? 0),
    options.id ?? '',
    options.title ?? '',
    options.artist ?? '',
    options.album ?? '',
    options.artworkUrl ?? '',
    String(options.isFavorite ?? false),
  ].join(DELIMITER)
}

function createLinuxListNamesPayload(names: string[]): string {
  return `([${names.map((name) => `'${name}'`).join(', ')}],)`
}

function createLinuxStatusPayload(options: {
  album?: string
  artist?: string
  artworkUrl?: string
  durationUs?: number
  playbackState: 'Playing' | 'Paused' | 'Stopped'
  positionUs?: number
  title?: string
  trackId?: string
  trackUrl?: string
}): string {
  const artists = options.artist ? `['${options.artist}']` : '[]'
  return `({'PlaybackStatus': <'${options.playbackState}'>, 'Metadata': <{'mpris:trackid': <objectpath '${options.trackId ?? '/com/spotify/track/123'}'>, 'mpris:length': <int64 ${options.durationUs ?? 0}>, 'mpris:artUrl': <'${options.artworkUrl ?? ''}'>, 'xesam:album': <'${options.album ?? ''}'>, 'xesam:artist': <${artists}>, 'xesam:title': <'${options.title ?? ''}'>, 'xesam:url': <'${options.trackUrl ?? ''}'>}>, 'Position': <int64 ${options.positionUs ?? 0}>},)`
}

function createWindowsStatusPayload(options: {
  album?: string
  artist?: string
  durationMs?: number
  playbackStatus: 'Playing' | 'Paused' | 'Stopped'
  positionMs?: number
  sourceAppUserModelId?: string
  title?: string
}): string {
  return JSON.stringify({
    album: options.album ?? '',
    artist: options.artist ?? '',
    durationMs: options.durationMs ?? 0,
    playbackStatus: options.playbackStatus,
    positionMs: options.positionMs ?? 0,
    sourceAppUserModelId: options.sourceAppUserModelId ?? 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
    title: options.title ?? '',
  })
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  assert.fail(message)
}

class StubSpotifyRunner {
  commandCalls: string[] = []
  commandError: Error | null = null
  statusCalls = 0
  statusError: Error | null = null

  constructor(private readonly statusResponses: string[]) {}

  async run(scriptLines: string[]): Promise<string> {
    const script = scriptLines.join('\n')
    if (script.includes('next track')) {
      return this.handleCommand('next')
    }
    if (script.includes('previous track')) {
      return this.handleCommand('previous')
    }
    if (script.includes('\n  pause\n')) {
      return this.handleCommand('pause')
    }
    if (script.includes('\n  play\n')) {
      return this.handleCommand('play')
    }

    this.statusCalls += 1
    if (this.statusError) {
      throw this.statusError
    }

    return this.statusResponses[Math.min(this.statusCalls - 1, this.statusResponses.length - 1)] ?? 'not_running'
  }

  private handleCommand(command: string): string {
    this.commandCalls.push(command)
    if (this.commandError) {
      throw this.commandError
    }
    return ''
  }
}

class StubCommandRunner {
  calls: Array<{ command: string; args: string[] }> = []
  error: Error | null = null

  constructor(
    private readonly handler: (command: string, args: string[]) => string,
  ) {}

  async run(command: string, args: string[]): Promise<string> {
    this.calls.push({ command, args: [...args] })
    if (this.error) {
      throw this.error
    }
    return this.handler(command, args)
  }
}

test('provider stays unavailable on unsupported platforms', async () => {
  const provider = new MacSpotifyProvider({
    platform: 'freebsd',
  })

  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, false)
    assert.equal(provider.getProviderState().connectionState, 'unavailable')
  } finally {
    await provider.dispose()
  }
})

test('provider reads local macOS Spotify playback and hydrates artwork while active', async () => {
  const runner = new StubSpotifyRunner([
    createStatusPayload({
      playbackState: 'playing',
      position: 42,
      duration: 180000,
      id: 'spotify:track:123',
      title: 'Song One',
      artist: 'Artist One',
      album: 'Album One',
      artworkUrl: 'https://i.scdn.co/image/cover-one',
      isFavorite: true,
    }),
  ])

  const provider = new MacSpotifyProvider({
    accessImpl: async () => undefined,
    fetchImpl: async () => new Response(Buffer.from('cover-one'), {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    }),
    now: () => 1000,
    platform: 'darwin',
    runner: (scriptLines) => runner.run(scriptLines),
  })

  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'connected', 'expected connected Spotify state')

    const state = provider.getProviderState()
    assert.equal(state.snapshot?.currentTrack?.title, 'Song One')
    assert.equal(state.snapshot?.currentTrack?.isFavorite, true)
    assert.match(state.snapshot?.currentTrack?.artworkDataUrl ?? '', /^data:image\/png;base64,/)
    assert.equal(state.snapshot?.playbackState, 'playing')
    assert.equal(state.snapshot?.currentTime, 42)
    assert.equal(state.snapshot?.duration, 180)
  } finally {
    await provider.dispose()
  }
})

test('provider treats a non-running macOS Spotify app as idle instead of erroring', async () => {
  const provider = new MacSpotifyProvider({
    accessImpl: async () => undefined,
    platform: 'darwin',
    runner: async () => 'not_running',
  })

  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'disabled', 'expected disabled Spotify state')
    assert.equal(provider.getProviderState().lastError, null)
  } finally {
    await provider.dispose()
  }
})

test('provider surfaces macOS Automation permission failures during polling', async () => {
  const provider = new MacSpotifyProvider({
    accessImpl: async () => undefined,
    platform: 'darwin',
    runner: async () => {
      throw new Error('Not authorized to send Apple events to Spotify. (-1743)')
    },
  })

  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'error', 'expected Spotify error state')
    assert.match(provider.getProviderState().lastError ?? '', /Automation permission/)
  } finally {
    await provider.dispose()
  }
})

test('provider routes macOS transport controls through AppleScript and records control failures', async () => {
  const runner = new StubSpotifyRunner([
    createStatusPayload({
      playbackState: 'paused',
      position: 0,
      duration: 180000,
      id: 'spotify:track:123',
      title: 'Song One',
      artist: 'Artist One',
      album: 'Album One',
    }),
  ])
  const provider = new MacSpotifyProvider({
    accessImpl: async () => undefined,
    platform: 'darwin',
    runner: (scriptLines) => runner.run(scriptLines),
  })

  try {
    await provider.initialize()
    await provider.sendControl('next')
    assert.deepEqual(runner.commandCalls, ['next'])

    runner.commandError = new Error('Not authorized to send Apple events to Spotify. (-1743)')
    await assert.rejects(() => provider.sendControl('play'), /Automation permission/)
    assert.match(provider.getProviderState().lastControlError ?? '', /Automation permission/)
  } finally {
    await provider.dispose()
  }
})

test('provider reads Linux Spotify playback through MPRIS and routes controls through gdbus', async () => {
  const runner = new StubCommandRunner((command, args) => {
    assert.equal(command, 'gdbus')
    const methodIndex = args.indexOf('--method')
    const method = methodIndex >= 0 ? args[methodIndex + 1] : ''

    switch (method) {
      case 'org.freedesktop.DBus.ListNames':
        return createLinuxListNamesPayload([
          'org.freedesktop.DBus',
          'org.mpris.MediaPlayer2.spotify',
        ])
      case 'org.freedesktop.DBus.Properties.GetAll':
        return createLinuxStatusPayload({
          playbackState: 'Playing',
          positionUs: 42000000,
          durationUs: 180000000,
          title: 'Song Linux',
          artist: 'Artist Linux',
          album: 'Album Linux',
          artworkUrl: 'https://i.scdn.co/image/linux-cover',
          trackUrl: 'spotify:track:linux123',
        })
      case 'org.mpris.MediaPlayer2.Player.Next':
        return '()'
      default:
        throw new Error(`Unhandled Linux method ${method}`)
    }
  })

  const provider = new MacSpotifyProvider({
    commandRunner: (command, args) => runner.run(command, args),
    fetchImpl: async () => new Response(Buffer.from('linux-cover'), {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    }),
    now: () => 2000,
    platform: 'linux',
  })

  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, true)
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'connected', 'expected connected Linux Spotify state')

    const state = provider.getProviderState()
    assert.equal(state.snapshot?.currentTrack?.title, 'Song Linux')
    assert.equal(state.snapshot?.currentTrack?.artist, 'Artist Linux')
    assert.equal(state.snapshot?.currentTrack?.isFavorite, false)
    assert.match(state.snapshot?.currentTrack?.artworkDataUrl ?? '', /^data:image\/png;base64,/)
    assert.equal(state.snapshot?.currentTime, 42)
    assert.equal(state.snapshot?.duration, 180)

    await provider.sendControl('next')
    assert.ok(runner.calls.some((call) => call.args.includes('org.mpris.MediaPlayer2.Player.Next')))
  } finally {
    await provider.dispose()
  }
})

test('provider treats a missing Linux Spotify MPRIS session as idle', async () => {
  const provider = new MacSpotifyProvider({
    commandRunner: async (_command, args) => {
      if (args.includes('org.freedesktop.DBus.ListNames')) {
        return createLinuxListNamesPayload(['org.freedesktop.DBus'])
      }

      throw new Error('unexpected command')
    },
    platform: 'linux',
  })

  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, true)
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'disabled', 'expected disabled Linux Spotify state')
    assert.equal(provider.getProviderState().lastError, null)
  } finally {
    await provider.dispose()
  }
})

test('provider reads Windows Spotify playback through system media controls and routes commands', async () => {
  const runner = new StubCommandRunner((command, args) => {
    assert.equal(command, 'powershell.exe')
    const script = args.at(-1) ?? ''

    if (script.includes('Write-Output "ready"')) {
      return 'ready'
    }
    if (script.includes('ConvertTo-Json')) {
      return createWindowsStatusPayload({
        playbackStatus: 'Playing',
        positionMs: 32000,
        durationMs: 210000,
        title: 'Song Windows',
        artist: 'Artist Windows',
        album: 'Album Windows',
      })
    }
    if (script.includes('TrySkipNextAsync')) {
      return 'ok'
    }

    throw new Error('unexpected powershell script')
  })

  const provider = new MacSpotifyProvider({
    commandRunner: (command, args) => runner.run(command, args),
    now: () => 3000,
    platform: 'win32',
  })

  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, true)
    await provider.setConsumerActive(1, true)
    await waitFor(() => provider.getProviderState().connectionState === 'connected', 'expected connected Windows Spotify state')

    const state = provider.getProviderState()
    assert.equal(state.snapshot?.currentTrack?.title, 'Song Windows')
    assert.equal(state.snapshot?.currentTrack?.artist, 'Artist Windows')
    assert.equal(state.snapshot?.currentTrack?.isFavorite, false)
    assert.equal(state.snapshot?.currentTime, 32)
    assert.equal(state.snapshot?.duration, 210)

    await provider.sendControl('next')
    assert.ok(runner.calls.some((call) => (call.args.at(-1) ?? '').includes('TrySkipNextAsync')))
  } finally {
    await provider.dispose()
  }
})

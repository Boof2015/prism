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

test('provider stays unavailable when Spotify.app is not installed or not on macOS', async () => {
  const provider = new MacSpotifyProvider({
    accessImpl: async () => {
      throw new Error('missing')
    },
    platform: 'linux',
    runner: async () => 'not_running',
  })

  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, false)
    assert.equal(provider.getProviderState().connectionState, 'unavailable')
  } finally {
    await provider.dispose()
  }
})

test('provider reads local Spotify playback and hydrates artwork while active', async () => {
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

test('provider treats a non-running Spotify app as idle instead of erroring', async () => {
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

test('provider routes transport controls through AppleScript and records control failures', async () => {
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

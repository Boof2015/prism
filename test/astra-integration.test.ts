import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AstraIntegrationService, normalizeAstraIntegrationConfig } from '../src/main/services/astraIntegration'
import { DEFAULT_ASTRA_BASE_URL, type AstraIntegrationConfig } from '../src/types/astra'

class MemorySecretVault {
  readonly secrets = new Map<string, string>()
  setError: Error | null = null

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null
  }

  async setSecret(key: string, value: string): Promise<void> {
    if (this.setError) {
      throw this.setError
    }

    this.secrets.set(key, value)
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key)
  }
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function createPngResponse(payload = 'artwork'): Response {
  return new Response(Buffer.from(payload), {
    status: 200,
    headers: {
      'content-type': 'image/png',
    },
  })
}

function createHeaders(init?: RequestInit): Headers {
  return new Headers(init?.headers)
}

function createFakeTimers(): {
  clearTimeoutImpl: (handle: ReturnType<typeof setTimeout>) => void
  nextDelay: () => number | null
  pendingCount: () => number
  runNext: () => void
  setTimeoutImpl: typeof setTimeout
} {
  let nextHandle = 1
  const timers = new Map<number, { callback: () => void; delay: number }>()

  return {
    setTimeoutImpl(callback: TimerHandler, delay?: number): ReturnType<typeof setTimeout> {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, {
        callback: typeof callback === 'function' ? callback as () => void : () => {},
        delay: typeof delay === 'number' ? delay : 0,
      })
      return handle as ReturnType<typeof setTimeout>
    },
    clearTimeoutImpl(handle: ReturnType<typeof setTimeout>): void {
      timers.delete(Number(handle))
    },
    nextDelay: () => {
      const next = timers.values().next().value as { delay: number } | undefined
      return next?.delay ?? null
    },
    pendingCount: () => timers.size,
    runNext: () => {
      const next = timers.entries().next().value as [number, { callback: () => void }] | undefined
      if (!next) return
      const [handle, timer] = next
      timers.delete(handle)
      timer.callback()
    },
  }
}

function createSseStream(): {
  close: () => void
  pushEvent: (event: string, payload: unknown) => void
  response: Response
} {
  const encoder = new TextEncoder()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
    },
  })

  return {
    response,
    pushEvent(event, payload) {
      controllerRef?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
    },
    close() {
      controllerRef?.close()
    },
  }
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

async function createConfigFile(config: AstraIntegrationConfig): Promise<{
  cleanup: () => Promise<void>
  configPath: string
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-astra-tests-'))
  const configPath = join(rootDir, 'userData', 'astra-integration.json')
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
  return {
    configPath,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  }
}

test('normalizeAstraIntegrationConfig applies defaults and trims input', () => {
  const config = normalizeAstraIntegrationConfig({
    baseUrl: ' http://127.0.0.1:38401/ ',
    token: ' secret ',
  })

  assert.deepEqual(config, {
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret',
  })
})

test('service initializes from config, hydrates artwork, and applies SSE updates', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret-token',
  })
  const secretVault = new MemorySecretVault()
  const sse = createSseStream()
  const artworkUrl = `${DEFAULT_ASTRA_BASE_URL}/v1/artwork/current?trackId=track-1`
  const calls: Array<{ init?: RequestInit; url: string }> = []

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const headers = createHeaders(init)
    assert.equal(headers.get('authorization'), 'Bearer secret-token')

    if (pathname === '/v1/now-playing') {
      return createJsonResponse({
        playbackState: 'playing',
        currentTime: 15,
        duration: 180,
        queueLength: 2,
        outputDeviceLabel: 'Built-in Output',
        visualizerLineColor: '#4ade80',
        updatedAt: 1000,
        currentTrack: {
          id: 'track-1',
          title: 'Song One',
          artist: 'Artist One',
          album: 'Album One',
          isFavorite: false,
          artworkUrl,
        },
      })
    }

    if (pathname === '/v1/artwork/current') {
      return createPngResponse('cover-one')
    }

    if (pathname === '/v1/events') {
      assert.equal(headers.get('accept'), 'text/event-stream')
      return sse.response
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl,
    now: () => 1000,
    secretVault,
  })

  try {
    await service.initialize()
    assert.equal(service.getState().connectionState, 'disabled')
    assert.deepEqual(service.getState().config, {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      hasToken: true,
    })
    assert.equal(secretVault.secrets.get('now-playing.astra.token'), 'secret-token')
    const rawConfig = await readFile(harness.configPath, 'utf8')
    assert.equal(rawConfig.includes('secret-token'), false)
    await service.setConsumerActive(1, true)
    await waitFor(() => service.getState().connectionState === 'connected', 'expected connected Astra state')

    const initialState = service.getState()
    assert.equal(initialState.snapshot?.currentTrack?.title, 'Song One')
    assert.match(initialState.snapshot?.currentTrack?.artworkDataUrl ?? '', /^data:image\/png;base64,/)
    assert.equal(calls.some((call) => call.url.endsWith('/v1/artwork/current?trackId=track-1')), true)

    sse.pushEvent('now-playing', {
      playbackState: 'paused',
      currentTime: 40,
      duration: 180,
      queueLength: 2,
      outputDeviceLabel: 'Built-in Output',
      visualizerLineColor: '#f97316',
      updatedAt: 2500,
      currentTrack: {
        id: 'track-2',
        title: 'Song Two',
        artist: 'Artist Two',
        album: 'Album Two',
        isFavorite: true,
        artworkUrl: null,
      },
    })

    await waitFor(() => service.getState().snapshot?.currentTrack?.id === 'track-2', 'expected SSE track update')
    const nextState = service.getState()
    assert.equal(nextState.snapshot?.playbackState, 'paused')
    assert.equal(nextState.snapshot?.currentTrack?.artworkDataUrl, null)

    await service.setConsumerActive(1, false)
    assert.equal(service.getState().connectionState, 'disabled')
    assert.equal(service.getState().snapshot, null)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('service emits a single state update when reusing cached artwork on SSE updates', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret-token',
  })
  const secretVault = new MemorySecretVault()
  const sse = createSseStream()
  const artworkUrl = `${DEFAULT_ASTRA_BASE_URL}/v1/artwork/current?trackId=track-1`
  let stateUpdateCount = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const pathname = new URL(url).pathname
    const headers = createHeaders(init)
    assert.equal(headers.get('authorization'), 'Bearer secret-token')

    if (pathname === '/v1/now-playing') {
      return createJsonResponse({
        playbackState: 'playing',
        currentTime: 15,
        duration: 180,
        queueLength: 2,
        outputDeviceLabel: 'Built-in Output',
        visualizerLineColor: '#4ade80',
        updatedAt: 1000,
        currentTrack: {
          id: 'track-1',
          title: 'Song One',
          artist: 'Artist One',
          album: 'Album One',
          isFavorite: false,
          artworkUrl,
        },
      })
    }

    if (pathname === '/v1/artwork/current') {
      return createPngResponse('cover-one')
    }

    if (pathname === '/v1/events') {
      return sse.response
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl,
    now: () => 1000,
    secretVault,
  })

  try {
    service.subscribe((state) => {
      void state
      stateUpdateCount += 1
    })

    await service.initialize()
    await service.setConsumerActive(1, true)
    await waitFor(() => service.getState().connectionState === 'connected', 'expected connected Astra state')

    const baseUpdateCount = stateUpdateCount

    sse.pushEvent('now-playing', {
      playbackState: 'playing',
      currentTime: 42,
      duration: 180,
      queueLength: 2,
      outputDeviceLabel: 'Built-in Output',
      visualizerLineColor: '#4ade80',
      updatedAt: 2000,
      currentTrack: {
        id: 'track-1',
        title: 'Song One',
        artist: 'Artist One',
        album: 'Album One',
        isFavorite: false,
        artworkUrl,
      },
    })

    await waitFor(() => service.getState().snapshot?.updatedAt === 2000, 'expected SSE update to apply')
    assert.equal(stateUpdateCount - baseUpdateCount, 1)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('service does not refetch identical artwork after a failed attempt', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret-token',
  })
  const secretVault = new MemorySecretVault()
  const sse = createSseStream()
  const artworkUrl = `${DEFAULT_ASTRA_BASE_URL}/v1/artwork/current?trackId=track-2`
  let artworkRequests = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const pathname = new URL(url).pathname
    const headers = createHeaders(init)
    assert.equal(headers.get('authorization'), 'Bearer secret-token')

    if (pathname === '/v1/now-playing') {
      return createJsonResponse({
        playbackState: 'paused',
        currentTime: 0,
        duration: 0,
        queueLength: 0,
        outputDeviceLabel: null,
        visualizerLineColor: '#38bdf8',
        updatedAt: 1000,
        currentTrack: null,
      })
    }

    if (pathname === '/v1/artwork/current') {
      artworkRequests += 1
      return createJsonResponse({ error: 'missing artwork' }, 404)
    }

    if (pathname === '/v1/events') {
      return sse.response
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl,
    secretVault,
  })

  try {
    await service.initialize()
    await service.setConsumerActive(1, true)
    await waitFor(() => service.getState().connectionState === 'connected', 'expected connected Astra state')

    sse.pushEvent('now-playing', {
      playbackState: 'playing',
      currentTime: 5,
      duration: 180,
      queueLength: 1,
      outputDeviceLabel: 'Built-in Output',
      visualizerLineColor: '#4ade80',
      updatedAt: 2000,
      currentTrack: {
        id: 'track-2',
        title: 'Song Two',
        artist: 'Artist Two',
        album: 'Album Two',
        isFavorite: false,
        artworkUrl,
      },
    })

    await waitFor(() => service.getState().snapshot?.currentTrack?.id === 'track-2', 'expected first artwork-bearing track update')
    await waitFor(() => artworkRequests === 1, 'expected first failed artwork request')

    sse.pushEvent('now-playing', {
      playbackState: 'playing',
      currentTime: 15,
      duration: 180,
      queueLength: 1,
      outputDeviceLabel: 'Built-in Output',
      visualizerLineColor: '#4ade80',
      updatedAt: 3000,
      currentTrack: {
        id: 'track-2',
        title: 'Song Two',
        artist: 'Artist Two',
        album: 'Album Two',
        isFavorite: false,
        artworkUrl,
      },
    })

    await waitFor(() => service.getState().snapshot?.updatedAt === 3000, 'expected second track update')
    assert.equal(artworkRequests, 1)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('service schedules reconnect when the SSE stream closes', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret-token',
  })
  const secretVault = new MemorySecretVault()
  const timers = createFakeTimers()
  const steadyStream = createSseStream()
  let eventStreamRequests = 0

  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    const pathname = new URL(url).pathname

    if (pathname === '/v1/now-playing') {
      return createJsonResponse({
        playbackState: 'stopped',
        currentTime: 0,
        duration: 0,
        queueLength: 0,
        outputDeviceLabel: null,
        visualizerLineColor: '#38bdf8',
        updatedAt: 0,
        currentTrack: null,
      })
    }

    if (pathname === '/v1/events') {
      eventStreamRequests += 1
      if (eventStreamRequests === 1) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close()
          },
        }), {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
          },
        })
      }

      return steadyStream.response
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    secretVault,
  })

  try {
    await service.initialize()
    await service.setConsumerActive(1, true)
    await waitFor(() => service.getState().connectionState === 'error', 'expected reconnect error state')
    assert.equal(timers.nextDelay(), 1000)
    assert.equal(timers.pendingCount(), 1)

    timers.runNext()

    await waitFor(() => eventStreamRequests === 2, 'expected second SSE connection attempt')
    await waitFor(() => service.getState().connectionState === 'connected', 'expected connected state after reconnect')
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('service surfaces 401 and 403 control errors and clears them after success', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'secret-token',
  })
  const secretVault = new MemorySecretVault()
  const sse = createSseStream()
  let controlRequests = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const pathname = new URL(url).pathname

    if (pathname === '/v1/now-playing') {
      return createJsonResponse({
        playbackState: 'paused',
        currentTime: 20,
        duration: 180,
        queueLength: 1,
        outputDeviceLabel: 'Built-in Output',
        visualizerLineColor: '#38bdf8',
        updatedAt: 0,
        currentTrack: {
          id: 'track-1',
          title: 'Track',
          artist: 'Artist',
          album: 'Album',
          isFavorite: false,
          artworkUrl: null,
        },
      })
    }

    if (pathname === '/v1/events') {
      return sse.response
    }

    if (pathname === '/v1/control') {
      const headers = createHeaders(init)
      assert.equal(headers.get('authorization'), 'Bearer secret-token')
      controlRequests += 1
      if (controlRequests === 1) {
        return createJsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (controlRequests === 2) {
        return createJsonResponse({ error: 'External playback controls are disabled.' }, 403)
      }
      return createJsonResponse({ ok: true }, 200)
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl,
    secretVault,
  })

  try {
    await service.initialize()
    await service.setConsumerActive(1, true)
    await waitFor(() => service.getState().connectionState === 'connected', 'expected connected state before controls')

    await assert.rejects(() => service.sendControl('next'), /Unauthorized/)
    assert.equal(service.getState().lastControlError, 'Unauthorized')

    await assert.rejects(() => service.sendControl('previous'), /External playback controls are disabled\./)
    assert.equal(service.getState().lastControlError, 'External playback controls are disabled.')

    await service.sendControl('play')
    assert.equal(service.getState().lastControlError, null)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('saveConfig preserves, replaces, and clears the stored Astra token explicitly', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: '',
  })
  const secretVault = new MemorySecretVault()
  secretVault.secrets.set('now-playing.astra.token', 'stored-token')
  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl: async () => createJsonResponse({}),
    secretVault,
  })

  try {
    await service.initialize()
    assert.equal(service.getState().config.hasToken, true)

    await service.saveConfig({
      baseUrl: 'http://127.0.0.1:49000',
      token: '',
    })
    assert.equal(secretVault.secrets.get('now-playing.astra.token'), 'stored-token')
    assert.deepEqual(service.getState().config, {
      baseUrl: 'http://127.0.0.1:49000',
      hasToken: true,
    })

    await service.saveConfig({
      baseUrl: 'http://127.0.0.1:49000',
      token: 'replacement-token',
    })
    assert.equal(secretVault.secrets.get('now-playing.astra.token'), 'replacement-token')

    await service.saveConfig({
      baseUrl: 'http://127.0.0.1:49000',
      clearToken: true,
    })
    assert.equal(secretVault.secrets.has('now-playing.astra.token'), false)
    assert.equal(service.getState().config.hasToken, false)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

test('service strips plaintext tokens from legacy config even when secure storage migration fails', async () => {
  const harness = await createConfigFile({
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: 'legacy-token',
  })
  const secretVault = new MemorySecretVault()
  secretVault.setError = new Error('Secure storage unavailable.')
  const service = new AstraIntegrationService({
    configPath: harness.configPath,
    fetchImpl: async () => createJsonResponse({}),
    secretVault,
  })

  try {
    await service.initialize()
    assert.equal(service.getState().config.hasToken, false)
    assert.match(service.getState().lastError ?? '', /Secure storage unavailable\./)

    const rawConfig = await readFile(harness.configPath, 'utf8')
    assert.equal(rawConfig.includes('legacy-token'), false)
  } finally {
    await service.dispose()
    await harness.cleanup()
  }
})

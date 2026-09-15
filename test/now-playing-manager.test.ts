import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { NowPlayingManager } from '../src/main/services/nowPlayingManager'
import { bindNowPlayingWindowConsumer } from '../src/main/services/nowPlayingWindowConsumer'
import type { NowPlayingProviderService } from '../src/main/services/nowPlayingProvider'
import {
  DEFAULT_ASTRA_BASE_URL,
  type AstraIntegrationConfigMutation,
  type AstraIntegrationPublicConfig,
} from '../src/types/astra'
import type {
  NowPlayingControlCommand,
  NowPlayingProviderConfigMap,
  NowPlayingProviderConfigMutationMap,
  NowPlayingProviderId,
  NowPlayingProviderState,
} from '../src/types/nowPlaying'

function createProviderState(
  providerId: NowPlayingProviderId,
  overrides: Partial<NowPlayingProviderState> = {},
): NowPlayingProviderState {
  return {
    providerId,
    connectionState: 'disabled',
    lastError: null,
    lastControlError: null,
    snapshot: null,
    isConfigured: false,
    available: providerId !== 'tidal',
    supportsTransportControls: providerId !== 'tidal',
    ...overrides,
  }
}

function cloneProviderState(state: NowPlayingProviderState): NowPlayingProviderState {
  return {
    ...state,
    snapshot: state.snapshot
      ? {
          ...state.snapshot,
          currentTrack: state.snapshot.currentTrack ? { ...state.snapshot.currentTrack } : null,
        }
      : null,
  }
}

class StubProviderService<K extends NowPlayingProviderId> implements NowPlayingProviderService<K> {
  readonly providerId: K
  publicConfig: NowPlayingProviderConfigMap[K]
  providerState: NowPlayingProviderState
  consumerCalls: Array<{ consumerId: number; active: boolean }> = []
  saveConfigCalls: Array<NowPlayingProviderConfigMutationMap[K]> = []
  controlCalls: NowPlayingControlCommand[] = []
  retryCalls = 0
  initializeCalls = 0
  disposeCalls = 0
  private readonly listeners = new Set<() => void>()

  constructor(providerId: K, options: {
    publicConfig: NowPlayingProviderConfigMap[K]
    providerState: NowPlayingProviderState
  }) {
    this.providerId = providerId
    this.publicConfig = options.publicConfig
    this.providerState = options.providerState
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  async initialize(): Promise<void> {
    this.initializeCalls += 1
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1
  }

  getPublicConfig(): NowPlayingProviderConfigMap[K] {
    return structuredClone(this.publicConfig)
  }

  getProviderState(): NowPlayingProviderState {
    return cloneProviderState(this.providerState)
  }

  async setConsumerActive(consumerId: number, active: boolean): Promise<void> {
    this.consumerCalls.push({ consumerId, active })
  }

  async saveConfig(rawConfig: NowPlayingProviderConfigMutationMap[K]): Promise<void> {
    this.saveConfigCalls.push(structuredClone(rawConfig))

    if (this.providerId === 'astra') {
      const mutation = rawConfig as AstraIntegrationConfigMutation
      const currentConfig = this.publicConfig as AstraIntegrationPublicConfig
      this.publicConfig = {
        baseUrl: mutation.baseUrl,
        hasToken: mutation.clearToken
          ? false
          : mutation.token
            ? true
            : currentConfig.hasToken,
      } as NowPlayingProviderConfigMap[K]
      this.providerState = {
        ...this.providerState,
        isConfigured: (this.publicConfig as AstraIntegrationPublicConfig).hasToken,
      }
      this.emit()
    }
  }

  async retry(): Promise<void> {
    this.retryCalls += 1
  }

  async sendControl(command: NowPlayingControlCommand): Promise<void> {
    this.controlCalls.push(command)
  }
}

async function createHarness(options?: {
  astraConfig?: AstraIntegrationPublicConfig
  astraState?: Partial<NowPlayingProviderState>
  spotifyState?: Partial<NowPlayingProviderState>
  tidalState?: Partial<NowPlayingProviderState>
}): Promise<{
  astra: StubProviderService<'astra'>
  cleanup: () => Promise<void>
  manager: NowPlayingManager
  spotify: StubProviderService<'spotify'>
  tidal: StubProviderService<'tidal'>
  localStatePath: string
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-now-playing-manager-'))
  const astra = new StubProviderService('astra', {
    publicConfig: options?.astraConfig ?? {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      hasToken: false,
    },
    providerState: createProviderState('astra', {
      isConfigured: options?.astraConfig?.hasToken ?? false,
      ...options?.astraState,
    }),
  })
  const spotify = new StubProviderService('spotify', {
    publicConfig: {},
    providerState: createProviderState('spotify', {
      available: false,
      supportsTransportControls: false,
      isConfigured: false,
      connectionState: 'unavailable',
      ...options?.spotifyState,
    }),
  })

  const tidal = new StubProviderService('tidal', {
    publicConfig: {},
    providerState: createProviderState('tidal', options?.tidalState),
  })
  const localStatePath = join(rootDir, 'now-playing-state.json')
  return {
    tidal,
    localStatePath,
    astra,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    manager: new NowPlayingManager({
      localStatePath: join(rootDir, 'now-playing-state.json'),
      providerServices: [astra, spotify, tidal],
    }),
    spotify,
  }
}

class StubConsumerWebContents extends EventEmitter {
  private destroyed = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

test('config window activates every provider until destroyed and can be reopened independently', async () => {
  const harness = await createHarness()
  const errors: unknown[] = []
  const config = new StubConsumerWebContents(101)
  const reopened = new StubConsumerWebContents(102)

  try {
    await harness.manager.initialize()
    await harness.manager.setConsumerActive(1, true)
    bindNowPlayingWindowConsumer(config, harness.manager, error => errors.push(error))
    await setImmediate()

    // Renderer reloads and presentation changes do not end the native window's lifetime.
    config.emit('did-finish-load')
    config.emit('hide')
    config.emit('show')
    await setImmediate()
    for (const provider of [harness.astra, harness.spotify, harness.tidal]) {
      assert.deepEqual(provider.consumerCalls, [
        { consumerId: 1, active: true },
        { consumerId: 101, active: true },
      ])
    }

    config.destroy()
    await setImmediate()
    bindNowPlayingWindowConsumer(reopened, harness.manager, error => errors.push(error))
    await setImmediate()
    reopened.destroy()
    await setImmediate()

    for (const provider of [harness.astra, harness.spotify, harness.tidal]) {
      assert.deepEqual(provider.consumerCalls, [
        { consumerId: 1, active: true },
        { consumerId: 101, active: true },
        { consumerId: 101, active: false },
        { consumerId: 102, active: true },
        { consumerId: 102, active: false },
      ])
    }
    assert.deepEqual(errors, [])
  } finally {
    await harness.manager.dispose()
    await harness.cleanup()
  }
})

test('closing during activation releases immediately and also removes a late consumer', async () => {
  const contents = new StubConsumerWebContents(101)
  const activeConsumers = new Set([1])
  const errors: unknown[] = []
  let finishActivation!: () => void
  const activation = new Promise<void>(resolve => { finishActivation = resolve })
  const calls: boolean[] = []
  const manager = {
    setConsumerActive: async (id: number, active: boolean) => {
      calls.push(active)
      assert.equal(contents.listenerCount('destroyed'), active ? 1 : 0)
      if (active) {
        await activation
        activeConsumers.add(id)
      } else {
        activeConsumers.delete(id)
      }
      return {} as ReturnType<NowPlayingManager['getState']>
    },
  }

  bindNowPlayingWindowConsumer(contents, manager, error => errors.push(error))
  contents.destroy()
  assert.deepEqual(calls, [true, false])
  finishActivation()
  await setImmediate()
  assert.deepEqual(calls, [true, false, false])
  assert.deepEqual([...activeConsumers], [1])
  assert.deepEqual(errors, [])
})

test('window lifecycle reports rejected activation and cleanup without dropping destruction cleanup', async () => {
  const contents = new StubConsumerWebContents(101)
  const errors: unknown[] = []
  const activationError = new Error('Activation failed')
  const cleanupError = new Error('Cleanup failed')
  const calls: boolean[] = []
  bindNowPlayingWindowConsumer(contents, {
    setConsumerActive: async (_id, active) => {
      calls.push(active)
      throw active ? activationError : cleanupError
    },
  }, error => errors.push(error))
  await setImmediate()
  contents.destroy()
  await setImmediate()
  assert.deepEqual(calls, [true, false])
  assert.deepEqual(errors, [activationError, cleanupError])
})

test('binding an already destroyed window never activates providers', () => {
  const contents = new StubConsumerWebContents(101)
  contents.destroy()
  bindNowPlayingWindowConsumer(contents, {
    setConsumerActive: async () => { assert.fail('Destroyed window must not activate') },
  }, () => { assert.fail('No lifecycle calls should run') })
})

test('manager starts in onboarding mode until a supported provider is configured', async () => {
  const harness = await createHarness()

  try {
    await harness.manager.initialize()

    const state = harness.manager.getState()
    assert.deepEqual(state.providerPriority, ['astra', 'spotify', 'tidal'])
    assert.equal(state.hasConfiguredProvider, false)
    assert.equal(state.onboardingRequired, true)
    assert.equal(state.activeProviderId, null)
    assert.deepEqual(state.configs.astra, {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      hasToken: false,
    })
    assert.equal(state.providers.spotify.connectionState, 'unavailable')
  } finally {
    await harness.cleanup()
  }
})

test('local Spotify can satisfy configuration without any OAuth setup', async () => {
  const harness = await createHarness({
    spotifyState: {
      available: true,
      supportsTransportControls: true,
      isConfigured: true,
      connectionState: 'disabled',
    },
  })

  try {
    await harness.manager.initialize()

    const state = harness.manager.getState()
    assert.equal(state.hasConfiguredProvider, true)
    assert.equal(state.onboardingRequired, false)
    assert.equal(state.activeProviderId, null)
    assert.equal(state.providers.spotify.isConfigured, true)
  } finally {
    await harness.cleanup()
  }
})

test('manager prefers a playing Spotify provider over Astra when Spotify has higher priority', async () => {
  const harness = await createHarness({
    astraConfig: {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      hasToken: true,
    },
    astraState: {
      isConfigured: true,
      connectionState: 'connected',
      snapshot: {
        playbackState: 'paused',
        currentTime: 12,
        duration: 120,
        queueLength: 2,
        outputDeviceLabel: 'Studio',
        visualizerLineColor: '#38bdf8',
        currentTrack: {
          id: 'astra-track',
          title: 'Astra Track',
          artist: 'Astra Artist',
          album: 'Astra Album',
          isFavorite: false,
          artworkDataUrl: null,
        },
        updatedAt: 1000,
      },
    },
    spotifyState: {
      available: true,
      supportsTransportControls: true,
      isConfigured: true,
      connectionState: 'connected',
      snapshot: {
        playbackState: 'playing',
        currentTime: 30,
        duration: 180,
        queueLength: 0,
        outputDeviceLabel: null,
        visualizerLineColor: '#1ed760',
        currentTrack: {
          id: 'spotify-track',
          title: 'Spotify Track',
          artist: 'Spotify Artist',
          album: 'Spotify Album',
          isFavorite: true,
          artworkDataUrl: null,
        },
        updatedAt: 2000,
      },
    },
  })

  try {
    await harness.manager.initialize()
    await harness.manager.setProviderPriority(['spotify', 'astra', 'tidal'])

    const state = harness.manager.getState()
    assert.equal(state.activeProviderId, 'spotify')
  } finally {
    await harness.cleanup()
  }
})

test('manager forwards save, retry, and controls to the active provider services', async () => {
  const harness = await createHarness({
    astraConfig: {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      hasToken: true,
    },
    astraState: {
      isConfigured: true,
    },
    spotifyState: {
      available: true,
      supportsTransportControls: true,
      isConfigured: true,
      connectionState: 'connected',
      snapshot: {
        playbackState: 'playing',
        currentTime: 5,
        duration: 200,
        queueLength: 0,
        outputDeviceLabel: null,
        visualizerLineColor: '#1ed760',
        currentTrack: {
          id: 'spotify-track',
          title: 'Spotify Track',
          artist: 'Spotify Artist',
          album: 'Spotify Album',
          isFavorite: false,
          artworkDataUrl: null,
        },
        updatedAt: 500,
      },
    },
  })

  try {
    await harness.manager.initialize()
    await harness.manager.saveProviderConfig('astra', {
      baseUrl: 'http://127.0.0.1:5000',
      token: 'replacement-token',
    })
    await harness.manager.retryProvider('spotify')
    await harness.manager.sendControl('next')

    assert.deepEqual(harness.astra.saveConfigCalls, [{
      baseUrl: 'http://127.0.0.1:5000',
      token: 'replacement-token',
    }])
    assert.equal(harness.spotify.retryCalls, 1)
    assert.deepEqual(harness.spotify.controlCalls, ['next'])
  } finally {
    await harness.cleanup()
  }
})


test('TIDAL participates in priority, configuration, lifecycle, retry and controls', async () => {
  const active = {
    available: true, isConfigured: true, supportsTransportControls: true,
    connectionState: 'connected' as const,
    snapshot: {
      playbackState: 'playing' as const, currentTime: 3, duration: 120, queueLength: 0,
      outputDeviceLabel: null, visualizerLineColor: '#fff', updatedAt: 100,
      currentTrack: { id: 'track', title: 'Track', artist: '', album: '', isFavorite: false, artworkDataUrl: null },
    },
  }
  const harness = await createHarness({ spotifyState: active, tidalState: active })
  try {
    await harness.manager.initialize()
    assert.equal(harness.manager.getState().activeProviderId, 'spotify')
    await harness.manager.setProviderPriority(['tidal', 'spotify', 'astra'])
    assert.equal(harness.manager.getState().activeProviderId, 'tidal')
    assert.equal(harness.manager.getState().onboardingRequired, false)
    await harness.manager.setConsumerActive(99, true)
    await harness.manager.retryProvider('tidal')
    await harness.manager.sendControl('next')
    assert.equal(harness.tidal.initializeCalls, 1)
    assert.deepEqual(harness.tidal.consumerCalls, [{ consumerId: 99, active: true }])
    assert.equal(harness.tidal.retryCalls, 1)
    assert.equal(harness.spotify.retryCalls, 0)
    assert.deepEqual(harness.tidal.controlCalls, ['next'])
    assert.deepEqual(harness.spotify.controlCalls, [])
    const restored = new NowPlayingManager({ localStatePath: harness.localStatePath, providerServices: [harness.tidal] })
    await restored.initialize()
    assert.deepEqual(restored.getState().providerPriority, ['tidal', 'spotify', 'astra'])
    harness.tidal.providerState.supportsTransportControls = false
    await assert.rejects(harness.manager.sendControl('pause'), /controls are unavailable/)
    harness.tidal.providerState.snapshot = null
    harness.tidal.emit()
    assert.equal(harness.manager.getState().activeProviderId, 'spotify')
    await harness.manager.dispose()
    assert.equal(harness.tidal.disposeCalls, 1)
  } finally { await harness.cleanup() }
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NowPlayingManager } from '../src/main/services/nowPlayingManager'
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

class StubProviderService<K extends 'astra' | 'spotify'> implements NowPlayingProviderService<K> {
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
}): Promise<{
  astra: StubProviderService<'astra'>
  cleanup: () => Promise<void>
  manager: NowPlayingManager
  spotify: StubProviderService<'spotify'>
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

  return {
    astra,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    manager: new NowPlayingManager({
      localStatePath: join(rootDir, 'now-playing-state.json'),
      providerServices: [astra, spotify],
    }),
    spotify,
  }
}

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

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NowPlayingManager } from '../src/main/services/nowPlayingManager'
import {
  DEFAULT_ASTRA_BASE_URL,
  type AstraIntegrationConfig,
  type AstraIntegrationState,
} from '../src/types/astra'

function createAstraState(overrides: Partial<AstraIntegrationState> = {}): AstraIntegrationState {
  const config = overrides.config ?? {
    baseUrl: DEFAULT_ASTRA_BASE_URL,
    token: '',
  }

  return {
    connectionState: 'disabled',
    lastError: null,
    lastControlError: null,
    snapshot: null,
    ...overrides,
    config,
  }
}

class StubAstraService {
  state: AstraIntegrationState
  consumerCalls: Array<{ consumerId: number, active: boolean }> = []
  saveConfigCalls: unknown[] = []
  controlCalls: string[] = []
  initializeCalls = 0
  disposeCalls = 0
  private readonly listeners = new Set<() => void>()

  constructor(state: AstraIntegrationState) {
    this.state = state
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

  getState(): AstraIntegrationState {
    return this.state
  }

  getConfig(): AstraIntegrationConfig {
    return { ...this.state.config }
  }

  async setConsumerActive(consumerId: number, active: boolean): Promise<void> {
    this.consumerCalls.push({ consumerId, active })
  }

  async saveConfig(rawConfig: unknown): Promise<void> {
    this.saveConfigCalls.push(rawConfig)
    const patch = typeof rawConfig === 'object' && rawConfig !== null
      ? rawConfig as Partial<AstraIntegrationConfig>
      : {}
    this.state = {
      ...this.state,
      config: {
        ...this.state.config,
        ...patch,
      },
    }
    this.emit()
  }

  async sendControl(command: 'play' | 'pause' | 'next' | 'previous'): Promise<void> {
    this.controlCalls.push(command)
  }
}

async function createHarness(state: AstraIntegrationState): Promise<{
  cleanup: () => Promise<void>
  manager: NowPlayingManager
  stub: StubAstraService
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-now-playing-manager-'))
  const stub = new StubAstraService(state)

  return {
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    manager: new NowPlayingManager({
      astraConfigPath: join(rootDir, 'astra-integration.json'),
      localStatePath: join(rootDir, 'now-playing-state.json'),
      astraService: stub,
    }),
    stub,
  }
}

test('manager starts in onboarding mode until a supported provider is configured', async () => {
  const harness = await createHarness(createAstraState())

  try {
    await harness.manager.initialize()

    const state = harness.manager.getState()
    assert.deepEqual(state.providerPriority, ['astra', 'spotify', 'tidal'])
    assert.equal(state.hasConfiguredProvider, false)
    assert.equal(state.onboardingRequired, true)
    assert.equal(state.activeProviderId, null)
    assert.equal(state.providers.astra.connectionState, 'disabled')
    assert.equal(state.providers.spotify.connectionState, 'unavailable')
    assert.equal(state.providers.tidal.connectionState, 'unavailable')
  } finally {
    await harness.cleanup()
  }
})

test('coming-soon providers never outrank a configured Astra provider in arbitration', async () => {
  const harness = await createHarness(createAstraState({
    config: {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      token: 'secret-token',
    },
    connectionState: 'connected',
    snapshot: {
      playbackState: 'paused',
      currentTime: 12,
      duration: 120,
      queueLength: 4,
      outputDeviceLabel: 'Studio',
      visualizerLineColor: '#38bdf8',
      currentTrack: {
        id: 'track-1',
        title: 'Track',
        artist: 'Artist',
        album: 'Album',
        isFavorite: false,
        artworkDataUrl: null,
      },
      updatedAt: 1000,
    },
  }))

  try {
    await harness.manager.initialize()
    await harness.manager.setProviderPriority(['spotify', 'tidal', 'astra'])

    const state = harness.manager.getState()
    assert.deepEqual(state.providerPriority, ['spotify', 'tidal', 'astra'])
    assert.equal(state.hasConfiguredProvider, true)
    assert.equal(state.onboardingRequired, false)
    assert.equal(state.activeProviderId, 'astra')
  } finally {
    await harness.cleanup()
  }
})

test('manager forwards consumer activity for multiple now-playing surfaces', async () => {
  const harness = await createHarness(createAstraState())

  try {
    await harness.manager.initialize()
    await harness.manager.setConsumerActive(101, true)
    await harness.manager.setConsumerActive(202, true)
    await harness.manager.setConsumerActive(101, false)

    assert.deepEqual(harness.stub.consumerCalls, [
      { consumerId: 101, active: true },
      { consumerId: 202, active: true },
      { consumerId: 101, active: false },
    ])
  } finally {
    await harness.cleanup()
  }
})

test('manager routes config retry, controls, and service updates through Astra', async () => {
  const harness = await createHarness(createAstraState({
    config: {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      token: 'secret-token',
    },
    connectionState: 'connected',
    snapshot: {
      playbackState: 'playing',
      currentTime: 24,
      duration: 180,
      queueLength: 8,
      outputDeviceLabel: 'Main Out',
      visualizerLineColor: '#38bdf8',
      currentTrack: {
        id: 'track-2',
        title: 'Playing Track',
        artist: 'Artist',
        album: 'Album',
        isFavorite: true,
        artworkDataUrl: null,
      },
      updatedAt: 2000,
    },
  }))

  try {
    await harness.manager.initialize()

    const snapshots: Array<string | null> = []
    const unsubscribe = harness.manager.subscribe((state) => {
      snapshots.push(state.activeProviderId)
    })

    await harness.manager.retryProvider('astra')
    await harness.manager.sendControl('next')

    harness.stub.state = createAstraState({
      config: {
        baseUrl: DEFAULT_ASTRA_BASE_URL,
        token: 'secret-token',
      },
      connectionState: 'connected',
      snapshot: {
        playbackState: 'paused',
        currentTime: 48,
        duration: 180,
        queueLength: 8,
        outputDeviceLabel: 'Main Out',
        visualizerLineColor: '#38bdf8',
        currentTrack: {
          id: 'track-3',
          title: 'Paused Track',
          artist: 'Artist',
          album: 'Album',
          isFavorite: false,
          artworkDataUrl: null,
        },
        updatedAt: 3000,
      },
    })
    harness.stub.emit()
    unsubscribe()

    assert.deepEqual(harness.stub.saveConfigCalls, [
      { baseUrl: DEFAULT_ASTRA_BASE_URL, token: 'secret-token' },
    ])
    assert.deepEqual(harness.stub.controlCalls, ['next'])
    assert.deepEqual(snapshots, ['astra', 'astra', 'astra'])
  } finally {
    await harness.cleanup()
  }
})

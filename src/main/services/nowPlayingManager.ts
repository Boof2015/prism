import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  NOW_PLAYING_PROVIDER_DEFINITIONS,
  NOW_PLAYING_PROVIDER_IDS,
  type NowPlayingControlCommand,
  type NowPlayingProviderConfigMap,
  type NowPlayingProviderId,
  type NowPlayingProviderState,
  type NowPlayingProviderStateMap,
  type NowPlayingSnapshot,
  type NowPlayingState,
} from '../../types/nowPlaying'
import type { ManagedNowPlayingProviderId, NowPlayingProviderService } from './nowPlayingProvider'

interface NowPlayingManagerOptions {
  localStatePath: string
  providerServices: NowPlayingProviderService[]
}

type ProviderServiceMap = Partial<{
  astra: NowPlayingProviderService<'astra'>
  spotify: NowPlayingProviderService<'spotify'>
}>

interface NowPlayingLocalState {
  providerPriority: NowPlayingProviderId[]
}

function cloneSnapshot(snapshot: NowPlayingSnapshot | null): NowPlayingSnapshot | null {
  if (!snapshot) return null
  return {
    ...snapshot,
    currentTrack: snapshot.currentTrack
      ? { ...snapshot.currentTrack }
      : null,
  }
}

function cloneProviderState(state: NowPlayingProviderState): NowPlayingProviderState {
  return {
    ...state,
    snapshot: cloneSnapshot(state.snapshot),
  }
}

function cloneNowPlayingState(state: NowPlayingState): NowPlayingState {
  return {
    definitions: { ...state.definitions },
    configs: {
      astra: { ...state.configs.astra },
      spotify: {},
      tidal: {},
    },
    providers: NOW_PLAYING_PROVIDER_IDS.reduce((acc, providerId) => {
      acc[providerId] = cloneProviderState(state.providers[providerId])
      return acc
    }, {} as NowPlayingProviderStateMap),
    providerPriority: [...state.providerPriority],
    activeProviderId: state.activeProviderId,
    hasConfiguredProvider: state.hasConfiguredProvider,
    onboardingRequired: state.onboardingRequired,
  }
}

function normalizeProviderPriority(raw: unknown): NowPlayingProviderId[] {
  const parsed = Array.isArray(raw) ? raw : []
  const seen = new Set<NowPlayingProviderId>()
  const normalized: NowPlayingProviderId[] = []

  for (const value of parsed) {
    if (typeof value !== 'string') continue
    if (!NOW_PLAYING_PROVIDER_IDS.includes(value as NowPlayingProviderId)) continue
    const providerId = value as NowPlayingProviderId
    if (seen.has(providerId)) continue
    seen.add(providerId)
    normalized.push(providerId)
  }

  for (const providerId of NOW_PLAYING_PROVIDER_IDS) {
    if (!seen.has(providerId)) {
      normalized.push(providerId)
    }
  }

  return normalized
}

function normalizeLocalState(raw: unknown): NowPlayingLocalState {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<NowPlayingLocalState>
    : {}

  return {
    providerPriority: normalizeProviderPriority(parsed.providerPriority),
  }
}

function createPlaceholderProviderState(providerId: Exclude<NowPlayingProviderId, ManagedNowPlayingProviderId>): NowPlayingProviderState {
  const definition = NOW_PLAYING_PROVIDER_DEFINITIONS[providerId]
  return {
    providerId,
    connectionState: 'unavailable',
    lastError: null,
    lastControlError: null,
    snapshot: null,
    isConfigured: false,
    available: definition.available,
    supportsTransportControls: definition.supportsTransportControls,
  }
}

export class NowPlayingManager {
  private readonly localStatePath: string
  private readonly listeners = new Set<(state: NowPlayingState) => void>()
  private readonly providerServices: ProviderServiceMap
  private providerPriority = [...NOW_PLAYING_PROVIDER_IDS]
  private initialized = false

  constructor(options: NowPlayingManagerOptions) {
    this.localStatePath = options.localStatePath
    this.providerServices = options.providerServices.reduce((acc, providerService) => {
      if (providerService.providerId === 'astra') {
        acc.astra = providerService as NowPlayingProviderService<'astra'>
      } else if (providerService.providerId === 'spotify') {
        acc.spotify = providerService as NowPlayingProviderService<'spotify'>
      }
      providerService.subscribe(() => {
        if (!this.initialized) {
          return
        }
        this.emitState()
      })
      return acc
    }, {} as ProviderServiceMap)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    const localState = await this.readLocalState()
    this.providerPriority = localState.providerPriority
    await Promise.all(Object.values(this.providerServices).map(async (providerService) => {
      await providerService?.initialize()
    }))
    this.initialized = true
    this.emitState()
  }

  async dispose(): Promise<void> {
    await Promise.all(Object.values(this.providerServices).map(async (providerService) => {
      await providerService?.dispose()
    }))
  }

  subscribe(listener: (state: NowPlayingState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): NowPlayingState {
    return cloneNowPlayingState(this.buildState())
  }

  async setConsumerActive(consumerId: number, active: boolean): Promise<NowPlayingState> {
    await this.ensureInitialized()
    await Promise.all(Object.values(this.providerServices).map(async (providerService) => {
      await providerService?.setConsumerActive(consumerId, active)
    }))
    return this.getState()
  }

  async saveProviderConfig(
    providerId: NowPlayingProviderId,
    rawConfig: unknown,
  ): Promise<NowPlayingState> {
    await this.ensureInitialized()

    const providerService = this.providerServices[providerId as ManagedNowPlayingProviderId]
    if (!providerService) {
      throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} is not configurable yet.`)
    }

    await providerService.saveConfig(rawConfig as never)
    return this.getState()
  }

  async retryProvider(providerId: NowPlayingProviderId): Promise<NowPlayingState> {
    await this.ensureInitialized()

    const providerService = this.providerServices[providerId as ManagedNowPlayingProviderId]
    if (!providerService) {
      throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} is not available yet.`)
    }

    await providerService.retry()
    return this.getState()
  }

  async setProviderPriority(rawPriority: unknown): Promise<NowPlayingState> {
    await this.ensureInitialized()
    this.providerPriority = normalizeProviderPriority(rawPriority)
    await this.writeLocalState({ providerPriority: this.providerPriority })
    this.emitState()
    return this.getState()
  }

  async sendControl(command: NowPlayingControlCommand): Promise<NowPlayingState> {
    await this.ensureInitialized()

    const activeProviderId = this.buildState().activeProviderId
    if (!activeProviderId) {
      throw new Error('No active now-playing provider is available.')
    }

    const providerService = this.providerServices[activeProviderId as ManagedNowPlayingProviderId]
    if (!providerService) {
      throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[activeProviderId].label} controls are not available yet.`)
    }

    await providerService.sendControl(command)
    return this.getState()
  }

  private buildState(): NowPlayingState {
    const configs: NowPlayingProviderConfigMap = {
      astra: this.providerServices.astra?.getPublicConfig() ?? {
        baseUrl: 'http://127.0.0.1:38401',
        hasToken: false,
      },
      spotify: this.providerServices.spotify?.getPublicConfig() ?? {},
      tidal: {},
    }
    const providers: NowPlayingProviderStateMap = {
      astra: this.providerServices.astra?.getProviderState() ?? {
        providerId: 'astra',
        connectionState: 'disabled',
        lastError: null,
        lastControlError: null,
        snapshot: null,
        isConfigured: false,
        available: true,
        supportsTransportControls: true,
      },
      spotify: this.providerServices.spotify?.getProviderState() ?? {
        providerId: 'spotify',
        connectionState: 'unavailable',
        lastError: null,
        lastControlError: null,
        snapshot: null,
        isConfigured: false,
        available: false,
        supportsTransportControls: true,
      },
      tidal: createPlaceholderProviderState('tidal'),
    }

    const hasConfiguredProvider = this.providerPriority.some((providerId) => {
      const provider = providers[providerId]
      return provider.available && provider.isConfigured
    })

    return {
      definitions: NOW_PLAYING_PROVIDER_DEFINITIONS,
      configs,
      providers,
      providerPriority: [...this.providerPriority],
      activeProviderId: this.resolveActiveProviderId(providers),
      hasConfiguredProvider,
      onboardingRequired: !hasConfiguredProvider,
    }
  }

  private resolveActiveProviderId(providers: NowPlayingProviderStateMap): NowPlayingProviderId | null {
    const playingProvider = this.providerPriority.find((providerId) => {
      const provider = providers[providerId]
      return provider.available
        && provider.isConfigured
        && provider.snapshot?.playbackState === 'playing'
    })
    if (playingProvider) {
      return playingProvider
    }

    const connectedProviders = this.providerPriority
      .map((providerId) => providers[providerId])
      .filter((provider) => {
        return provider.available
          && provider.isConfigured
          && provider.connectionState === 'connected'
          && provider.snapshot !== null
      })
      .sort((left, right) => {
        const leftPriority = this.providerPriority.indexOf(left.providerId)
        const rightPriority = this.providerPriority.indexOf(right.providerId)
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority
        }

        const rightUpdatedAt = right.snapshot?.updatedAt ?? 0
        const leftUpdatedAt = left.snapshot?.updatedAt ?? 0
        return rightUpdatedAt - leftUpdatedAt
      })

    return connectedProviders[0]?.providerId ?? null
  }

  private emitState(): void {
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private async readLocalState(): Promise<NowPlayingLocalState> {
    try {
      const raw = await readFile(this.localStatePath, 'utf8')
      return normalizeLocalState(JSON.parse(raw) as unknown)
    } catch {
      return normalizeLocalState(null)
    }
  }

  private async writeLocalState(state: NowPlayingLocalState): Promise<void> {
    await mkdir(dirname(this.localStatePath), { recursive: true })
    await writeFile(this.localStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}

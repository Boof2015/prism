import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AstraIntegrationConfig, AstraIntegrationState } from '../../types/astra'
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
import { AstraIntegrationService } from './astraIntegration'

interface NowPlayingManagerOptions {
  astraConfigPath: string
  localStatePath: string
  astraService?: AstraServiceLike
}

interface NowPlayingLocalState {
  providerPriority: NowPlayingProviderId[]
}

interface AstraServiceLike {
  initialize(): Promise<void>
  dispose(): Promise<void>
  subscribe(listener: () => void): () => void
  getState(): AstraIntegrationState
  getConfig(): AstraIntegrationConfig
  setConsumerActive(consumerId: number, active: boolean): Promise<unknown>
  saveConfig(rawConfig: unknown): Promise<unknown>
  sendControl(command: NowPlayingControlCommand): Promise<unknown>
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

function isConfiguredAstraProvider(config: AstraIntegrationConfig): boolean {
  return typeof config.token === 'string' && config.token.trim().length > 0
}

function toAstraProviderState(state: AstraIntegrationState): NowPlayingProviderState {
  return {
    providerId: 'astra',
    connectionState: state.connectionState,
    lastError: state.lastError,
    lastControlError: state.lastControlError,
    snapshot: state.snapshot ? {
      ...state.snapshot,
      currentTrack: state.snapshot.currentTrack
        ? { ...state.snapshot.currentTrack }
        : null,
    } : null,
    isConfigured: isConfiguredAstraProvider(state.config),
    available: true,
    supportsTransportControls: true,
  }
}

function createUnavailableProviderState(providerId: Exclude<NowPlayingProviderId, 'astra'>): NowPlayingProviderState {
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
  private readonly astraService: AstraServiceLike
  private readonly localStatePath: string
  private readonly listeners = new Set<(state: NowPlayingState) => void>()
  private providerPriority = [...NOW_PLAYING_PROVIDER_IDS]
  private initialized = false

  constructor(options: NowPlayingManagerOptions) {
    this.astraService = options.astraService ?? new AstraIntegrationService({
      configPath: options.astraConfigPath,
    })
    this.localStatePath = options.localStatePath
    this.astraService.subscribe(() => {
      if (!this.initialized) {
        return
      }
      this.emitState()
    })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    const localState = await this.readLocalState()
    this.providerPriority = localState.providerPriority
    await this.astraService.initialize()
    this.initialized = true
    this.emitState()
  }

  async dispose(): Promise<void> {
    await this.astraService.dispose()
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
    await this.astraService.setConsumerActive(consumerId, active)
    return this.getState()
  }

  async saveProviderConfig(
    providerId: NowPlayingProviderId,
    rawConfig: unknown,
  ): Promise<NowPlayingState> {
    await this.ensureInitialized()

    switch (providerId) {
      case 'astra':
        await this.astraService.saveConfig(rawConfig)
        break
      default:
        throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} is not configurable yet.`)
    }

    return this.getState()
  }

  async retryProvider(providerId: NowPlayingProviderId): Promise<NowPlayingState> {
    await this.ensureInitialized()

    switch (providerId) {
      case 'astra':
        await this.astraService.saveConfig(this.astraService.getConfig())
        break
      default:
        throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} is not available yet.`)
    }

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
    switch (activeProviderId) {
      case 'astra':
        await this.astraService.sendControl(command)
        break
      case null:
        throw new Error('No active now-playing provider is available.')
      default:
        throw new Error(`${NOW_PLAYING_PROVIDER_DEFINITIONS[activeProviderId].label} controls are not available yet.`)
    }

    return this.getState()
  }

  private buildState(): NowPlayingState {
    const astraState = this.astraService.getState()
    const configs: NowPlayingProviderConfigMap = {
      astra: { ...astraState.config },
      spotify: {},
      tidal: {},
    }
    const providers: NowPlayingProviderStateMap = {
      astra: toAstraProviderState(astraState),
      spotify: createUnavailableProviderState('spotify'),
      tidal: createUnavailableProviderState('tidal'),
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

import type {
  NowPlayingControlCommand,
  NowPlayingProviderConfigMap,
  NowPlayingProviderConfigMutationMap,
  NowPlayingProviderId,
  NowPlayingProviderState,
} from '../../types/nowPlaying'

export type ManagedNowPlayingProviderId = Exclude<NowPlayingProviderId, 'tidal'>

export interface NowPlayingProviderService<K extends ManagedNowPlayingProviderId = ManagedNowPlayingProviderId> {
  readonly providerId: K
  initialize(): Promise<void>
  dispose(): Promise<void>
  subscribe(listener: () => void): () => void
  getPublicConfig(): NowPlayingProviderConfigMap[K]
  getProviderState(): NowPlayingProviderState
  setConsumerActive(consumerId: number, active: boolean): Promise<unknown>
  saveConfig(rawConfig: NowPlayingProviderConfigMutationMap[K]): Promise<unknown>
  retry(): Promise<void>
  sendControl(command: NowPlayingControlCommand): Promise<void>
}

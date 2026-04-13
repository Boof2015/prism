import type { AstraIntegrationConfigMutation, AstraIntegrationPublicConfig } from './astra'

export type NowPlayingProviderId = 'astra' | 'spotify' | 'tidal'
export type NowPlayingPlaybackState = 'stopped' | 'playing' | 'paused' | 'loading'
export type NowPlayingProviderConnectionState = 'disabled' | 'connecting' | 'connected' | 'error' | 'unavailable'
export type NowPlayingControlCommand = 'play' | 'pause' | 'next' | 'previous'
export type NowPlayingProviderAuthMode = 'token' | 'oauth' | 'local' | 'none'

export interface NowPlayingTrackSnapshot {
  id: string
  title: string
  artist: string
  album: string
  isFavorite: boolean
  artworkDataUrl: string | null
}

export interface NowPlayingSnapshot {
  playbackState: NowPlayingPlaybackState
  currentTime: number
  duration: number
  queueLength: number
  outputDeviceLabel: string | null
  visualizerLineColor: string
  currentTrack: NowPlayingTrackSnapshot | null
  updatedAt: number
}

export interface NowPlayingProviderDefinition {
  id: NowPlayingProviderId
  label: string
  description: string
  authMode: NowPlayingProviderAuthMode
  available: boolean
  comingSoon: boolean
  supportsTransportControls: boolean
}

export interface UnsupportedNowPlayingProviderConfig {
}

export interface NowPlayingProviderConfigMap {
  astra: AstraIntegrationPublicConfig
  spotify: UnsupportedNowPlayingProviderConfig
  tidal: UnsupportedNowPlayingProviderConfig
}

export interface NowPlayingProviderConfigMutationMap {
  astra: AstraIntegrationConfigMutation
  spotify: UnsupportedNowPlayingProviderConfig
  tidal: UnsupportedNowPlayingProviderConfig
}

export interface NowPlayingProviderState {
  providerId: NowPlayingProviderId
  connectionState: NowPlayingProviderConnectionState
  lastError: string | null
  lastControlError: string | null
  snapshot: NowPlayingSnapshot | null
  isConfigured: boolean
  available: boolean
  supportsTransportControls: boolean
}

export type NowPlayingProviderStateMap = Record<NowPlayingProviderId, NowPlayingProviderState>
export type NowPlayingProviderDefinitionMap = Record<NowPlayingProviderId, NowPlayingProviderDefinition>

export interface NowPlayingState {
  definitions: NowPlayingProviderDefinitionMap
  configs: NowPlayingProviderConfigMap
  providers: NowPlayingProviderStateMap
  providerPriority: NowPlayingProviderId[]
  activeProviderId: NowPlayingProviderId | null
  hasConfiguredProvider: boolean
  onboardingRequired: boolean
}

export const NOW_PLAYING_PROVIDER_IDS: NowPlayingProviderId[] = ['astra', 'spotify', 'tidal']

export const NOW_PLAYING_PROVIDER_DEFINITIONS: NowPlayingProviderDefinitionMap = {
  astra: {
    id: 'astra',
    label: 'Astra',
    description: 'Connect Prism to the Astra local API for live track data and transport controls.',
    authMode: 'token',
    available: true,
    comingSoon: false,
    supportsTransportControls: true,
  },
  spotify: {
    id: 'spotify',
    label: 'Spotify',
    description: 'Read track data and transport controls directly from the local Spotify macOS app.',
    authMode: 'local',
    available: true,
    comingSoon: false,
    supportsTransportControls: true,
  },
  tidal: {
    id: 'tidal',
    label: 'TIDAL',
    description: 'TIDAL integration is planned but not implemented yet.',
    authMode: 'none',
    available: false,
    comingSoon: true,
    supportsTransportControls: false,
  },
}

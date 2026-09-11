import type { JSX } from 'react'
import { NOW_PLAYING_PROVIDER_DEFINITIONS, type NowPlayingProviderId, type NowPlayingProviderState } from '../../types/nowPlaying'
import { getLocalAvailabilityDetail, getLocalProviderCopy } from '../utils/localNowPlaying'

interface Props {
  providerId: NowPlayingProviderId
  provider: NowPlayingProviderState
  platform: string
  retryProvider: (providerId: NowPlayingProviderId) => Promise<unknown>
  onError: (message: string) => void
}

export function LocalNowPlayingProviderDetails({ providerId, provider, platform, retryProvider, onError }: Props): JSX.Element {
  const definition = NOW_PLAYING_PROVIDER_DEFINITIONS[providerId]
  return (
    <div className="now-playing-config__provider-body">
      <div className="now-playing-config__provider-body-copy">{definition.description}</div>
      <div className="settings-info-text">{getLocalProviderCopy(platform, providerId)}</div>
      <div className="settings-inline-actions now-playing-config__provider-actions">
        <button
          type="button"
          className="settings-chip"
          onClick={() => {
            void retryProvider(providerId).catch((error: unknown) => {
              onError(error instanceof Error ? error.message : `Could not reconnect to ${definition.label}.`)
            })
          }}
        >
          Retry
        </button>
      </div>
      {!provider.available && (
        <div className="settings-info-text">{getLocalAvailabilityDetail(platform, providerId)}</div>
      )}
      {(provider.lastError || provider.lastControlError) && (
        <div className="settings-error-text now-playing-config__provider-error">
          {provider.lastError ?? provider.lastControlError}
        </div>
      )}
    </div>
  )
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocalNowPlayingProviderDetails } from '../src/renderer/components/LocalNowPlayingProviderDetails'
import AstraScopeModule from '../src/renderer/components/AstraScopeModule'
import { useNowPlayingStore } from '../src/renderer/stores/nowPlayingStore'
import { createDefaultProfile } from '../src/shared/profileState'
import { createDefaultTheme, resolveTheme } from '../src/shared/themeState'
import type { NowPlayingProviderState } from '../src/types/nowPlaying'

const provider: NowPlayingProviderState = {
  providerId: 'tidal', available: true, isConfigured: true, supportsTransportControls: false,
  connectionState: 'connected', lastError: null, lastControlError: null,
  snapshot: { playbackState: 'paused', currentTime: 10, duration: 0, updatedAt: 1000,
    queueLength: 0, outputDeviceLabel: null, visualizerLineColor: '#fff',
    currentTrack: { id: 'tidal:1', title: 'TIDAL Track', artist: 'Artist', album: '', isFavorite: false, artworkDataUrl: null } },
}

function findButton(node: ReactNode): { disabled?: boolean; onClick: () => void } | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick: () => void }>(child)) continue
    if (child.type === 'button') return child.props
    const nested = findButton(child.props.children)
    if (nested) return nested
  }
  return null
}

test('TIDAL Retry is enabled when unavailable and calls TIDAL, never Spotify', async () => {
  const calls: string[] = []
  const errors: string[] = []
  const component = LocalNowPlayingProviderDetails({ providerId: 'tidal', provider: { ...provider, available: false }, platform: 'darwin',
    retryProvider: async id => { calls.push(id); throw new Error('TIDAL unavailable') }, onError: message => errors.push(message) })
  const button = findButton(component)!
  assert.ok(button)
  assert.notEqual(button.disabled, true)
  button.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, ['tidal'])
  assert.deepEqual(errors, ['TIDAL unavailable'])
  const html = renderToStaticMarkup(component)
  assert.doesNotMatch(html, /Coming Soon|Spotify/)
  assert.match(html, /Use TIDAL for playback controls/)
})

test('Now Playing renders TIDAL track data and uses runtime control support', () => {
  const oldWindow = globalThis.window
  const previous = { ...useNowPlayingStore.getInitialState() }
  const initial = useNowPlayingStore.getInitialState()
  Object.assign(globalThis, { window: { electronAPI: { platform: 'darwin' } } })
  try {
    Object.assign(initial, { nowPlayingState: { ...previous.nowPlayingState,
      activeProviderId: 'tidal', hasConfiguredProvider: true, onboardingRequired: false,
      providers: { ...previous.nowPlayingState.providers, tidal: provider } } })
    const settings = createDefaultProfile().scopeSettings.nowPlaying
    const theme = resolveTheme(createDefaultTheme(), 'dark').nowPlaying
    const render = () => renderToStaticMarkup(<AstraScopeModule theme={theme} settings={{ ...settings, showControls: true }} />)
    assert.match(render(), /TIDAL Track/)
    assert.match(render(), /--:--/)
    assert.doesNotMatch(render(), /aria-label="(?:Next track|Previous track|Play)"/)
    Object.assign(initial, { nowPlayingState: { ...initial.nowPlayingState,
      providers: { ...previous.nowPlayingState.providers, tidal: { ...provider, supportsTransportControls: true } } } })
    assert.match(render(), /aria-label="Next track"/)
  } finally {
    Object.assign(initial, previous)
    Object.assign(globalThis, { window: oldWindow })
  }
})

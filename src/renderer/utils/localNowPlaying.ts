import { NOW_PLAYING_PROVIDER_DEFINITIONS, type NowPlayingProviderId } from '../../types/nowPlaying'

function isMacOSPlatform(platform: string): boolean { return platform === 'darwin' }
function isLinuxPlatform(platform: string): boolean { return platform === 'linux' }
function isWindowsPlatform(platform: string): boolean { return platform === 'win32' }

export function getLocalIntegrationLabel(platform: string, providerId: NowPlayingProviderId): string {
  if (providerId === 'tidal' && platform === 'darwin') return 'Local macOS track information'
  if (isMacOSPlatform(platform)) {
    return 'Local macOS app'
  }

  if (isLinuxPlatform(platform)) {
    return 'Local Linux MPRIS'
  }

  if (isWindowsPlatform(platform)) {
    return 'Local Windows media session'
  }

  return `Local ${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} integration`
}

export function getLocalUnavailableMetaText(platform: string, providerId: NowPlayingProviderId): string {
  if (isMacOSPlatform(platform)) {
    return 'Local macOS app unavailable'
  }

  if (isLinuxPlatform(platform)) {
    return 'Local Linux MPRIS unavailable'
  }

  if (isWindowsPlatform(platform)) {
    return 'Local Windows media session unavailable'
  }

  return `Local ${NOW_PLAYING_PROVIDER_DEFINITIONS[providerId].label} integration unavailable`
}

export function getLocalAvailabilityDetail(platform: string, providerId: NowPlayingProviderId): string {
  if (providerId === 'tidal') {
    if (platform === 'darwin') return 'Install TIDAL.app and click Retry. Track information requires compatible macOS system media access.'
    if (platform === 'linux') return 'Open a compatible TIDAL client, such as TIDAL Hi-Fi, with MPRIS enabled. Prism needs gdbus and access to the desktop session bus.'
    if (platform === 'win32') return 'Open TIDAL on this PC and start playback so Windows can expose its media session, then click Retry.'
  }
  if (isMacOSPlatform(platform)) {
    return 'Install Spotify.app in /Applications to enable this provider.'
  }

  if (isLinuxPlatform(platform)) {
    return 'This provider needs a Linux desktop session with Spotify MPRIS access.'
  }

  if (isWindowsPlatform(platform)) {
    return 'This provider needs Windows system media controls to expose a Spotify session.'
  }

  return 'This provider is currently available on macOS, Linux, and Windows.'
}

export function getLocalProviderCopy(platform: string, providerId: NowPlayingProviderId): string {
  if (providerId === 'tidal') {
    if (platform === 'darwin') return 'No account setup in Prism is required. Shows track information and progress while TIDAL owns system Now Playing. Use TIDAL for playback controls; artwork appears only when macOS supplies it.'
    if (platform === 'linux') return 'No account setup in Prism is required. Reads playback and controls from compatible dedicated TIDAL clients over MPRIS, including TIDAL Hi-Fi. Browser tabs are not supported.'
    return 'No account setup in Prism is required. Reads playback and controls from the local TIDAL Windows media session.'
  }
  if (isMacOSPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads the local Spotify macOS app directly.'
  }

  if (isLinuxPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads Spotify through the local Linux MPRIS session.'
  }

  if (isWindowsPlatform(platform)) {
    return 'No Spotify developer account or API setup is required. Prism reads Spotify through the local Windows media session.'
  }

  return 'No Spotify developer account or API setup is required. On supported systems, Prism reads the local Spotify app directly.'
}


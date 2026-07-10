import type { WindowCapabilities, WindowDisplayServer } from '../types/windowCapabilities'

export type MacWindowBlurMaterial = 'hud' | 'content'

export function resolveMacWindowBlurMaterial(useDarkColors: boolean): MacWindowBlurMaterial {
  return useDarkColors ? 'hud' : 'content'
}

interface WindowCapabilityResolutionOptions {
  platform: string
  argv?: readonly string[]
  env?: Record<string, string | undefined>
  osVersion?: string
}

export const DEFAULT_WINDOW_CAPABILITIES: WindowCapabilities = {
  displayServer: 'other',
  useNativeDragRegions: false,
  supportsProgrammaticReposition: true,
  supportsGeometryPersistence: true,
  supportsBlurredBackground: false,
}

// Blurred mode uses accent-policy acrylic (SetWindowCompositionAttribute),
// which technically exists since Windows 10 1803, but drag/repaint performance
// is only dependable on Windows 11 22H2 (build 22621) — gate it there.
const WINDOWS_ACRYLIC_MIN_BUILD = 22621

function windowsBuildSupportsAcrylic(osVersion: string | undefined): boolean {
  if (!osVersion) {
    return false
  }

  const build = Number.parseInt(osVersion.split('.')[2] ?? '', 10)
  return Number.isFinite(build) && build >= WINDOWS_ACRYLIC_MIN_BUILD
}

function readSwitchValue(argv: readonly string[], switchName: string): string | null {
  const exactPrefix = `--${switchName}=`

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value.startsWith(exactPrefix)) {
      return value.slice(exactPrefix.length)
    }

    if (value === `--${switchName}`) {
      const nextValue = argv[index + 1]
      if (typeof nextValue === 'string' && !nextValue.startsWith('--')) {
        return nextValue
      }
      return ''
    }
  }

  return null
}

function resolveLinuxDisplayServer(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): WindowDisplayServer {
  const ozonePlatform = readSwitchValue(argv, 'ozone-platform')?.toLowerCase() ?? null

  if (ozonePlatform === 'x11') {
    return 'x11'
  }

  if (ozonePlatform === 'wayland') {
    return 'wayland'
  }

  const sessionType = env.XDG_SESSION_TYPE?.toLowerCase() ?? ''
  const hasWaylandDisplay = Boolean(env.WAYLAND_DISPLAY)
  const hasX11Display = Boolean(env.DISPLAY)

  if (sessionType === 'wayland') {
    return 'wayland'
  }

  if (sessionType === 'x11') {
    return 'x11'
  }

  if (hasWaylandDisplay && !hasX11Display) {
    return 'wayland'
  }

  if (hasX11Display) {
    return 'x11'
  }

  if (hasWaylandDisplay) {
    return 'wayland'
  }

  return 'unknown'
}

export function resolveWindowCapabilities(options: WindowCapabilityResolutionOptions): WindowCapabilities {
  if (options.platform === 'darwin' || options.platform === 'win32') {
    return {
      ...DEFAULT_WINDOW_CAPABILITIES,
      useNativeDragRegions: true,
      supportsBlurredBackground: options.platform === 'darwin'
        || windowsBuildSupportsAcrylic(options.osVersion),
    }
  }

  if (options.platform !== 'linux') {
    return { ...DEFAULT_WINDOW_CAPABILITIES }
  }

  const displayServer = resolveLinuxDisplayServer(options.argv ?? [], options.env ?? {})
  const isNativeWayland = displayServer === 'wayland'

  return {
    displayServer,
    useNativeDragRegions: isNativeWayland,
    supportsProgrammaticReposition: !isNativeWayland,
    supportsGeometryPersistence: !isNativeWayland,
    supportsBlurredBackground: false,
  }
}

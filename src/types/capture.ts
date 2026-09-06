export type CaptureMode = 'system' | 'device' | 'daw'
export type CaptureStatus = 'idle' | 'connecting' | 'waiting' | 'capturing' | 'error'

export interface CaptureChannelDescriptor {
  /** Zero-based channel index used by capture backends. */
  index: number
  /** Human-readable driver label, falling back to the one-based channel number. */
  label: string
}

export interface CaptureChannelRouting {
  /** Zero-based source channel routed to Prism's left channel. */
  left: number
  /** Zero-based source channel routed to Prism's right channel. */
  right: number
}

export type CaptureRoutingSourceKind = 'system' | 'device'

export function createDefaultCaptureChannelRouting(channelCount: number): CaptureChannelRouting {
  const normalizedCount = Math.max(1, Math.floor(channelCount) || 1)
  return {
    left: 0,
    right: normalizedCount > 1 ? 1 : 0,
  }
}

export function normalizeCaptureChannelRouting(
  raw: unknown,
  channelCount: number,
): CaptureChannelRouting {
  const normalizedCount = Math.max(1, Math.floor(channelCount) || 1)
  const fallback = createDefaultCaptureChannelRouting(normalizedCount)
  if (typeof raw !== 'object' || raw === null) return fallback

  const candidate = raw as Partial<CaptureChannelRouting>
  const normalizeIndex = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const index = Math.floor(value)
    return index >= 0 && index < normalizedCount ? index : null
  }
  const left = normalizeIndex(candidate.left)
  const right = normalizeIndex(candidate.right)
  if (left === null || right === null) return fallback

  return { left, right }
}

export function getCaptureRoutingStorageKey(
  kind: CaptureRoutingSourceKind,
  sourceId: string,
): string {
  return `${kind}:${sourceId}`
}

export type NativeSystemCaptureBackendKind =
  | 'native-macos'
  | 'native-windows'
  | 'native-linux'

export type CaptureBackendKind =
  | 'device-input'
  | 'daw-bridge'
  | NativeSystemCaptureBackendKind

export function resolveNativeBackendKind(platform: string): NativeSystemCaptureBackendKind {
  switch (platform) {
    case 'darwin':
      return 'native-macos'
    case 'win32':
      return 'native-windows'
    default:
      return 'native-linux'
  }
}

export interface CaptureSourceDescriptor {
  id: string
  persistentId?: string
  label: string
  kind: CaptureMode
  isDefault?: boolean
  sampleRate?: number
  channelCount?: number
  channels?: CaptureChannelDescriptor[]
  channelRoutingAvailable?: boolean
}

export interface CaptureBackendSupportEntry {
  kind: CaptureBackendKind
  available: boolean
  reason: string | null
  channelRoutingAvailable?: boolean
}

export interface CaptureBackendSupport {
  nativeBackend: CaptureBackendSupportEntry
  deviceInput: CaptureBackendSupportEntry
  dawBridge: CaptureBackendSupportEntry
}

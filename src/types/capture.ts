export type CaptureMode = 'system' | 'device' | 'daw'
export type CaptureStatus = 'idle' | 'connecting' | 'waiting' | 'capturing' | 'error'

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
}

export interface CaptureBackendSupportEntry {
  kind: CaptureBackendKind
  available: boolean
  reason: string | null
}

export interface CaptureBackendSupport {
  nativeBackend: CaptureBackendSupportEntry
  deviceInput: CaptureBackendSupportEntry
  dawBridge: CaptureBackendSupportEntry
}

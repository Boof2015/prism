export type CaptureMode = 'system' | 'device'

export type NativeSystemCaptureBackendKind =
  | 'native-macos'
  | 'native-windows'
  | 'native-linux'

export type CaptureBackendKind =
  | 'device-input'
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
}

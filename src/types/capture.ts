export type CaptureMode = 'system' | 'device'

export type CaptureBackendPolicy = 'auto' | 'native' | 'electron'

export type CaptureBackendKind =
  | 'electron-system'
  | 'electron-device'
  | 'native-macos'
  | 'native-windows'
  | 'native-linux'

export interface CaptureSourceDescriptor {
  id: string
  label: string
  kind: CaptureMode
}

export interface CaptureBackendSupportEntry {
  kind: CaptureBackendKind
  available: boolean
  reason: string | null
}

export interface CaptureBackendSupport {
  policyOptions: CaptureBackendPolicy[]
  nativeBackend: CaptureBackendSupportEntry
  electronSystem: CaptureBackendSupportEntry
  electronDevice: CaptureBackendSupportEntry
}

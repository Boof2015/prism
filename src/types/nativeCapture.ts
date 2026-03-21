export interface NativeMacOSCaptureSupport {
  available: boolean
  reason: string | null
}

export interface NativeMacOSCaptureSource {
  id: string
  label: string
  kind: 'system'
  isDefault: boolean
  sampleRate: number
  channelCount: number
}

export interface NativeMacOSCaptureStartResult {
  sampleRate: number
  channelCount: number
  deviceId: string
  deviceLabel: string
}

export interface NativeMacOSCapturedChunk {
  left: Float32Array
  right: Float32Array
  channelCount: number
  capturedAtMilliseconds: number
  sequence: number
}

export interface NativeMacOSCaptureDrainResult {
  chunks: NativeMacOSCapturedChunk[]
  overwriteCount: number
  queueDepth: number
}

export interface NativeMacOSCaptureAPI {
  getSupport: () => NativeMacOSCaptureSupport
  listOutputDevices: () => NativeMacOSCaptureSource[]
  start: (deviceId?: string) => NativeMacOSCaptureStartResult
  stop: () => void
  drain: (maxChunks?: number) => NativeMacOSCaptureDrainResult
  nowMilliseconds: () => number
}

export interface NativeCaptureAPI {
  macosCapture: NativeMacOSCaptureAPI
}

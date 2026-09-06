export interface NativeCaptureSupport {
  available: boolean
  reason: string | null
}

export interface NativeCaptureChannel {
  index: number
  label: string
}

export interface NativeCaptureChannelRouting {
  left: number
  right: number
}

export interface NativeCaptureSource {
  id: string
  label: string
  kind: 'system' | 'device'
  isDefault: boolean
  sampleRate: number
  channelCount: number
  channels: NativeCaptureChannel[]
  channelRoutingAvailable: boolean
}

export interface NativeCaptureStartResult {
  sampleRate: number
  /** Effective mono/stereo count emitted to the renderer. */
  channelCount: number
  /** Physical channel count exposed by the selected source. */
  sourceChannelCount: number
  deviceId: string
  deviceLabel: string
}

export interface NativeCapturedChunk {
  left: Float32Array
  right: Float32Array
  channelCount: number
  capturedAtMilliseconds: number
  sequence: number
}

export interface NativeCaptureDrainResult {
  chunks: NativeCapturedChunk[]
  overwriteCount: number
  queueDepth: number
}

export interface NativeSystemCaptureAPI {
  getSupport: () => NativeCaptureSupport
  listOutputDevices: () => NativeCaptureSource[]
  start: (
    deviceId?: string,
    routing?: NativeCaptureChannelRouting,
  ) => NativeCaptureStartResult
  setChannelRouting?: (left: number, right: number) => NativeCaptureChannelRouting
  stop: () => void
  drain: (maxChunks?: number) => NativeCaptureDrainResult
  nowMilliseconds: () => number
}
export interface NativeDeviceInputCaptureAPI {
  getSupport: () => NativeCaptureSupport
  listInputDevices: () => NativeCaptureSource[]
  start: (
    deviceId?: string,
    routing?: NativeCaptureChannelRouting,
  ) => NativeCaptureStartResult
  setChannelRouting: (left: number, right: number) => NativeCaptureChannelRouting
  stop: () => void
  drain: (maxChunks?: number) => NativeCaptureDrainResult
  nowMilliseconds: () => number
}

export type NativeMacOSCaptureSupport = NativeCaptureSupport
export type NativeMacOSCaptureSource = NativeCaptureSource
export type NativeMacOSCaptureStartResult = NativeCaptureStartResult
export type NativeMacOSCapturedChunk = NativeCapturedChunk
export type NativeMacOSCaptureDrainResult = NativeCaptureDrainResult
export type NativeMacOSCaptureAPI = NativeSystemCaptureAPI

export type NativeWindowsCaptureSupport = NativeCaptureSupport
export type NativeWindowsCaptureSource = NativeCaptureSource
export type NativeWindowsCaptureStartResult = NativeCaptureStartResult
export type NativeWindowsCapturedChunk = NativeCapturedChunk
export type NativeWindowsCaptureDrainResult = NativeCaptureDrainResult
export type NativeWindowsCaptureAPI = NativeSystemCaptureAPI

export type NativeLinuxCaptureSupport = NativeCaptureSupport
export type NativeLinuxCaptureSource = NativeCaptureSource
export type NativeLinuxCaptureStartResult = NativeCaptureStartResult
export type NativeLinuxCapturedChunk = NativeCapturedChunk
export type NativeLinuxCaptureDrainResult = NativeCaptureDrainResult
export type NativeLinuxCaptureAPI = NativeSystemCaptureAPI

export interface NativeCaptureAPI {
  macosCapture: NativeMacOSCaptureAPI
  windowsCapture: NativeWindowsCaptureAPI
  linuxCapture: NativeLinuxCaptureAPI
  deviceInputCapture: NativeDeviceInputCaptureAPI
}

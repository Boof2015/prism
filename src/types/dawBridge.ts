export const DAW_BRIDGE_HOST = '127.0.0.1'
export const DAW_BRIDGE_PORT = 51789
export const DAW_BRIDGE_PROTOCOL_VERSION = 1
export const DAW_BRIDGE_FRAME_MAGIC = 0x4d535250
export const DAW_BRIDGE_FRAME_HEADER_BYTES = 12
export const DAW_BRIDGE_AUDIO_HEADER_BYTES = 76
export const DAW_BRIDGE_MAX_PAYLOAD_BYTES = 256 * 1024

export const DAW_BRIDGE_MESSAGE = {
  hello: 1,
  heartbeat: 2,
  sourceUpdate: 3,
  subscribe: 10,
  audio: 20,
} as const

export type DawBridgeConnectionState = 'connected' | 'selected'

export interface DawBridgeSourceDescriptor {
  id: string
  persistentId: string
  instanceId: string
  label: string
  customName: string | null
  trackName: string | null
  hostName: string | null
  sampleRate: number
  channelCount: number
  droppedFrames: number
  connectionState: DawBridgeConnectionState
}

export interface DawBridgeSnapshot {
  available: boolean
  reason: string | null
  selectedSourceId: string | null
  sources: DawBridgeSourceDescriptor[]
}

export interface DawTransportSnapshot {
  sequence: number
  timeInSamples?: number
  timeInSeconds?: number
  ppqPosition?: number
  bpm?: number
  ppqPositionOfLastBarStart?: number
  timeSignature?: {
    numerator: number
    denominator: number
  }
  loopPoints?: {
    ppqStart: number
    ppqEnd: number
  }
  isPlaying: boolean
  isRecording: boolean
  isLooping: boolean
}

export interface DawAnnotatedAudioChunk {
  sequence: number
  sampleRate: number
  channelCount: number
  left: Float32Array
  right: Float32Array
  transport: DawTransportSnapshot
}

export interface DawBridgeAudioPacket extends DawAnnotatedAudioChunk {
  sourceId: string
}

export interface DawBridgeAudioBatch {
  sourceId: string
  packets: DawBridgeAudioPacket[]
}

export interface DawBridgeHelloPayload {
  sourceId: string
  instanceId: string
  customName?: string
  trackName?: string
  hostName?: string
  sampleRate?: number
  channelCount?: number
  droppedFrames?: number
}

export interface DawBridgeSubscribePayload {
  selected: boolean
}

export interface DawBridgeRendererAPI {
  getSnapshot: () => Promise<DawBridgeSnapshot>
  selectSource: (sourceId: string | null) => Promise<DawBridgeSnapshot>
  onSnapshot: (callback: (snapshot: DawBridgeSnapshot) => void) => () => void
  onAudioBatch: (callback: (batch: DawBridgeAudioBatch) => void) => () => void
}

export type TimelineUnit = 'off' | 'bars-beats' | 'seconds'

export function isTimelineUnit(value: unknown): value is TimelineUnit {
  return value === 'off' || value === 'bars-beats' || value === 'seconds'
}

export const DEFAULT_TIMELINE_UNIT: TimelineUnit = 'bars-beats'

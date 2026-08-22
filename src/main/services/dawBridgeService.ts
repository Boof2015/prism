import { createServer, type Server, type Socket } from 'net'
import {
  DAW_BRIDGE_AUDIO_HEADER_BYTES,
  DAW_BRIDGE_FRAME_HEADER_BYTES,
  DAW_BRIDGE_FRAME_MAGIC,
  DAW_BRIDGE_HOST,
  DAW_BRIDGE_MAX_PAYLOAD_BYTES,
  DAW_BRIDGE_MESSAGE,
  DAW_BRIDGE_PORT,
  DAW_BRIDGE_PROTOCOL_VERSION,
  type DawBridgeAudioBatch,
  type DawBridgeAudioPacket,
  type DawBridgeHelloPayload,
  type DawBridgeSnapshot,
  type DawBridgeSourceDescriptor,
  type DawBridgeSubscribePayload,
  type DawTransportSnapshot,
} from '../../types/dawBridge'

const HEARTBEAT_INTERVAL_MS = 1000
const HEARTBEAT_TIMEOUT_MS = 3000
const AUDIO_BATCH_INTERVAL_MS = 10
const MAX_CONNECTIONS = 64
const MAX_PENDING_PACKETS = 128
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/

interface ClientState {
  socket: Socket
  receiveBuffer: Buffer
  source: DawBridgeSourceDescriptor | null
  lastHeartbeatAt: number
}

interface DawBridgeServiceOptions {
  host?: string
  port?: number
  onSnapshot?: (snapshot: DawBridgeSnapshot) => void
  onAudioBatch?: (batch: DawBridgeAudioBatch) => void
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  audioBatchIntervalMs?: number
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 160) : null
}

function isHelloPayload(value: unknown): value is DawBridgeHelloPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DawBridgeHelloPayload>
  return typeof candidate.sourceId === 'string'
    && SAFE_ID_PATTERN.test(candidate.sourceId)
    && typeof candidate.instanceId === 'string'
    && SAFE_ID_PATTERN.test(candidate.instanceId)
}

function sourceLabel(payload: DawBridgeHelloPayload): string {
  return optionalString(payload.customName)
    ?? optionalString(payload.trackName)
    ?? `Prism Bridge ${payload.sourceId.slice(0, 8)}`
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export class DawBridgeService {
  private readonly host: string
  private readonly port: number
  private readonly onSnapshot?: (snapshot: DawBridgeSnapshot) => void
  private readonly onAudioBatch?: (batch: DawBridgeAudioBatch) => void
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly audioBatchIntervalMs: number
  private server: Server | null = null
  private clients = new Set<ClientState>()
  private sources = new Map<string, ClientState>()
  private selectedSourceId: string | null = null
  private available = false
  private unavailableReason: string | null = 'The DAW bridge listener has not started.'
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private audioBatchTimer: ReturnType<typeof setTimeout> | null = null
  private pendingAudioPackets: DawBridgeAudioPacket[] = []

  constructor(options: DawBridgeServiceOptions = {}) {
    this.host = options.host ?? DAW_BRIDGE_HOST
    this.port = options.port ?? DAW_BRIDGE_PORT
    this.onSnapshot = options.onSnapshot
    this.onAudioBatch = options.onAudioBatch
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS
    this.audioBatchIntervalMs = options.audioBatchIntervalMs ?? AUDIO_BATCH_INTERVAL_MS
  }

  async start(): Promise<DawBridgeSnapshot> {
    if (this.server) return this.getSnapshot()

    const server = createServer((socket) => this.acceptClient(socket))
    this.server = server
    server.maxConnections = MAX_CONNECTIONS

    await new Promise<void>((resolve) => {
      const handleError = (error: Error): void => {
        server.removeListener('listening', handleListening)
        this.available = false
        this.unavailableReason = `Could not listen on ${this.host}:${this.port}: ${error.message}`
        this.server = null
        try {
          server.close()
        } catch {
          // The server may never have entered the listening state.
        }
        resolve()
      }
      const handleListening = (): void => {
        server.removeListener('error', handleError)
        this.available = true
        this.unavailableReason = null
        this.heartbeatTimer = setInterval(() => this.expireSilentClients(), this.heartbeatIntervalMs)
        resolve()
      }
      server.once('error', handleError)
      server.once('listening', handleListening)
      server.listen(this.port, this.host)
    })

    this.emitSnapshot()
    return this.getSnapshot()
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.audioBatchTimer) {
      clearTimeout(this.audioBatchTimer)
      this.audioBatchTimer = null
    }
    this.pendingAudioPackets = []
    for (const client of this.clients) {
      client.socket.destroy()
    }
    this.clients.clear()
    this.sources.clear()
    this.selectedSourceId = null
    this.server?.close()
    this.server = null
    this.available = false
    this.unavailableReason = 'The DAW bridge listener is stopped.'
  }

  getSnapshot(): DawBridgeSnapshot {
    return {
      available: this.available,
      reason: this.unavailableReason,
      selectedSourceId: this.selectedSourceId,
      sources: [...this.sources.values()]
        .flatMap((client) => client.source ? [client.source] : [])
        .sort((left, right) => left.label.localeCompare(right.label)),
    }
  }

  getListeningPort(): number | null {
    const address = this.server?.address()
    return typeof address === 'object' && address ? address.port : null
  }

  selectSource(sourceId: string | null): DawBridgeSnapshot {
    this.selectedSourceId = typeof sourceId === 'string' && this.sources.has(sourceId) ? sourceId : null
    for (const client of this.clients) {
      this.sendSubscription(client)
      if (client.source) {
        client.source = {
          ...client.source,
          connectionState: client.source.id === this.selectedSourceId ? 'selected' : 'connected',
        }
      }
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private acceptClient(socket: Socket): void {
    if (!isLoopbackAddress(socket.remoteAddress) || this.clients.size >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }

    socket.setNoDelay(true)
    socket.setKeepAlive(true, this.heartbeatIntervalMs)
    const client: ClientState = {
      socket,
      receiveBuffer: Buffer.alloc(0),
      source: null,
      lastHeartbeatAt: Date.now(),
    }
    this.clients.add(client)

    socket.on('data', (chunk) => this.handleData(client, chunk))
    socket.on('error', () => socket.destroy())
    socket.on('close', () => this.removeClient(client))
  }

  private handleData(client: ClientState, chunk: Buffer): void {
    client.lastHeartbeatAt = Date.now()
    client.receiveBuffer = client.receiveBuffer.length === 0
      ? chunk
      : Buffer.concat([client.receiveBuffer, chunk])

    while (client.receiveBuffer.length >= DAW_BRIDGE_FRAME_HEADER_BYTES) {
      const magic = client.receiveBuffer.readUInt32LE(0)
      const version = client.receiveBuffer.readUInt16LE(4)
      const messageType = client.receiveBuffer.readUInt16LE(6)
      const payloadLength = client.receiveBuffer.readUInt32LE(8)
      if (
        magic !== DAW_BRIDGE_FRAME_MAGIC
        || version !== DAW_BRIDGE_PROTOCOL_VERSION
        || payloadLength > DAW_BRIDGE_MAX_PAYLOAD_BYTES
      ) {
        client.socket.destroy()
        return
      }

      const frameLength = DAW_BRIDGE_FRAME_HEADER_BYTES + payloadLength
      if (client.receiveBuffer.length < frameLength) return
      const payload = client.receiveBuffer.subarray(DAW_BRIDGE_FRAME_HEADER_BYTES, frameLength)
      client.receiveBuffer = client.receiveBuffer.subarray(frameLength)
      if (!this.handleFrame(client, messageType, payload)) {
        client.socket.destroy()
        return
      }
    }
  }

  private handleFrame(client: ClientState, messageType: number, payload: Buffer): boolean {
    switch (messageType) {
      case DAW_BRIDGE_MESSAGE.hello:
      case DAW_BRIDGE_MESSAGE.sourceUpdate:
        return this.handleHello(client, payload)
      case DAW_BRIDGE_MESSAGE.heartbeat:
        return true
      case DAW_BRIDGE_MESSAGE.audio:
        return this.handleAudio(client, payload)
      default:
        return false
    }
  }

  private handleHello(client: ClientState, payloadBuffer: Buffer): boolean {
    let payload: unknown
    try {
      payload = JSON.parse(payloadBuffer.toString('utf8'))
    } catch {
      return false
    }
    if (!isHelloPayload(payload)) return false

    if (client.source) {
      this.sources.delete(client.source.id)
    }

    let liveId = payload.sourceId
    const conflictingClient = [...this.sources.values()].find((candidate) => (
      candidate !== client && candidate.source?.persistentId === payload.sourceId
    ))
    if (conflictingClient?.source) {
      const existingSource = conflictingClient.source
      if (existingSource.id === payload.sourceId) {
        this.sources.delete(existingSource.id)
        const distinctExistingId = this.allocateLiveId(
          payload.sourceId,
          existingSource.instanceId,
          conflictingClient,
        )
        conflictingClient.source = { ...existingSource, id: distinctExistingId, connectionState: 'connected' }
        this.sources.set(distinctExistingId, conflictingClient)
        this.pendingAudioPackets = this.pendingAudioPackets.filter((packet) => packet.sourceId !== payload.sourceId)
      }
      if (this.selectedSourceId === payload.sourceId) {
        this.selectedSourceId = null
      }
      this.sendSubscription(conflictingClient)
      liveId = this.allocateLiveId(payload.sourceId, payload.instanceId, client)
    }

    const descriptor: DawBridgeSourceDescriptor = {
      id: liveId,
      persistentId: payload.sourceId,
      instanceId: payload.instanceId,
      label: sourceLabel(payload),
      customName: optionalString(payload.customName),
      trackName: optionalString(payload.trackName),
      hostName: optionalString(payload.hostName),
      sampleRate: Math.max(1, finiteNumber(payload.sampleRate, 48000)),
      channelCount: Math.max(1, Math.min(2, Math.floor(finiteNumber(payload.channelCount, 2)))),
      droppedFrames: Math.max(0, Math.floor(finiteNumber(payload.droppedFrames, 0))),
      connectionState: liveId === this.selectedSourceId ? 'selected' : 'connected',
    }
    client.source = descriptor
    this.sources.set(descriptor.id, client)
    this.sendSubscription(client)
    this.emitSnapshot()
    return true
  }

  private handleAudio(client: ClientState, payload: Buffer): boolean {
    const source = client.source
    if (!source || source.id !== this.selectedSourceId || payload.length < DAW_BRIDGE_AUDIO_HEADER_BYTES) {
      return Boolean(source)
    }

    const sequence = payload.readUInt32LE(0)
    const frameCount = payload.readUInt16LE(4)
    const channelCount = payload.readUInt8(6)
    const flags = payload.readUInt8(7)
    const sampleRate = payload.readDoubleLE(8)
    const expectedBytes = DAW_BRIDGE_AUDIO_HEADER_BYTES + frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT
    if (
      frameCount === 0
      || (channelCount !== 1 && channelCount !== 2)
      || !Number.isFinite(sampleRate)
      || sampleRate <= 0
      || payload.length !== expectedBytes
    ) {
      return false
    }

    const transport: DawTransportSnapshot = {
      sequence,
      isPlaying: Boolean(flags & (1 << 0)),
      isRecording: Boolean(flags & (1 << 1)),
      isLooping: Boolean(flags & (1 << 2)),
    }
    if (flags & (1 << 3)) transport.timeInSamples = Number(payload.readBigInt64LE(16))
    if (flags & (1 << 4)) transport.timeInSeconds = payload.readDoubleLE(24)
    if (flags & (1 << 5)) {
      transport.ppqPosition = payload.readDoubleLE(32)
      const lastBar = payload.readDoubleLE(48)
      if (Number.isFinite(lastBar)) transport.ppqPositionOfLastBarStart = lastBar
    }
    if (flags & (1 << 6)) transport.bpm = payload.readDoubleLE(40)
    if (flags & (1 << 7)) {
      transport.timeSignature = {
        numerator: payload.readInt16LE(72),
        denominator: payload.readInt16LE(74),
      }
    }
    const loopStart = payload.readDoubleLE(56)
    const loopEnd = payload.readDoubleLE(64)
    if (transport.isLooping && Number.isFinite(loopStart) && Number.isFinite(loopEnd)) {
      transport.loopPoints = { ppqStart: loopStart, ppqEnd: loopEnd }
    }

    const audioOffset = DAW_BRIDGE_AUDIO_HEADER_BYTES
    const left = new Float32Array(frameCount)
    const right = new Float32Array(frameCount)
    for (let index = 0; index < frameCount; index += 1) {
      left[index] = payload.readFloatLE(audioOffset + index * 4)
    }
    if (channelCount === 2) {
      const rightOffset = audioOffset + frameCount * 4
      for (let index = 0; index < frameCount; index += 1) {
        right[index] = payload.readFloatLE(rightOffset + index * 4)
      }
    } else {
      right.set(left)
    }

    this.pendingAudioPackets.push({
      sourceId: source.id,
      sequence,
      sampleRate,
      channelCount,
      left,
      right,
      transport,
    })
    if (this.pendingAudioPackets.length > MAX_PENDING_PACKETS) {
      this.pendingAudioPackets.splice(0, this.pendingAudioPackets.length - MAX_PENDING_PACKETS)
    }
    this.scheduleAudioBatch()
    return true
  }

  private scheduleAudioBatch(): void {
    if (this.audioBatchTimer) return
    this.audioBatchTimer = setTimeout(() => {
      this.audioBatchTimer = null
      const sourceId = this.selectedSourceId
      if (!sourceId) {
        this.pendingAudioPackets = []
        return
      }
      const packets = this.pendingAudioPackets.filter((packet) => packet.sourceId === sourceId)
      this.pendingAudioPackets = []
      if (packets.length > 0) {
        this.onAudioBatch?.({ sourceId, packets })
      }
    }, this.audioBatchIntervalMs)
  }

  private sendSubscription(client: ClientState): void {
    if (!client.source || client.socket.destroyed) return
    const payload: DawBridgeSubscribePayload = {
      selected: client.source.id === this.selectedSourceId,
    }
    this.sendFrame(client.socket, DAW_BRIDGE_MESSAGE.subscribe, Buffer.from(JSON.stringify(payload), 'utf8'))
  }

  private allocateLiveId(sourceId: string, instanceId: string, owner: ClientState): string {
    const base = `${sourceId}:${instanceId.slice(0, 16)}`
    let candidate = base
    let suffix = 2
    while (this.sources.has(candidate) && this.sources.get(candidate) !== owner) {
      candidate = `${base}:${suffix}`
      suffix += 1
    }
    return candidate
  }

  private sendFrame(socket: Socket, messageType: number, payload: Buffer): void {
    const header = Buffer.allocUnsafe(DAW_BRIDGE_FRAME_HEADER_BYTES)
    header.writeUInt32LE(DAW_BRIDGE_FRAME_MAGIC, 0)
    header.writeUInt16LE(DAW_BRIDGE_PROTOCOL_VERSION, 4)
    header.writeUInt16LE(messageType, 6)
    header.writeUInt32LE(payload.length, 8)
    socket.write(Buffer.concat([header, payload]))
  }

  private expireSilentClients(): void {
    const cutoff = Date.now() - this.heartbeatTimeoutMs
    for (const client of this.clients) {
      if (client.lastHeartbeatAt < cutoff) {
        client.socket.destroy()
      }
    }
  }

  private removeClient(client: ClientState): void {
    this.clients.delete(client)
    if (client.source && this.sources.get(client.source.id) === client) {
      this.sources.delete(client.source.id)
      this.pendingAudioPackets = this.pendingAudioPackets.filter((packet) => packet.sourceId !== client.source!.id)
      this.emitSnapshot()
    }
  }

  private emitSnapshot(): void {
    this.onSnapshot?.(this.getSnapshot())
  }
}

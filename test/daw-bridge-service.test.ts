import assert from 'node:assert/strict'
import { connect, type Socket } from 'node:net'
import test from 'node:test'
import { DawBridgeService } from '../src/main/services/dawBridgeService'
import {
  DAW_BRIDGE_AUDIO_HEADER_BYTES,
  DAW_BRIDGE_FRAME_HEADER_BYTES,
  DAW_BRIDGE_FRAME_MAGIC,
  DAW_BRIDGE_MESSAGE,
  DAW_BRIDGE_PROTOCOL_VERSION,
  type DawBridgeAudioBatch,
} from '../src/types/dawBridge'

function frame(messageType: number, payload = Buffer.alloc(0), version = DAW_BRIDGE_PROTOCOL_VERSION): Buffer {
  const header = Buffer.alloc(DAW_BRIDGE_FRAME_HEADER_BYTES)
  header.writeUInt32LE(DAW_BRIDGE_FRAME_MAGIC, 0)
  header.writeUInt16LE(version, 4)
  header.writeUInt16LE(messageType, 6)
  header.writeUInt32LE(payload.length, 8)
  return Buffer.concat([header, payload])
}

function hello(sourceId: string, instanceId: string, trackName = 'Drums'): Buffer {
  return frame(DAW_BRIDGE_MESSAGE.hello, Buffer.from(JSON.stringify({
    sourceId,
    instanceId,
    trackName,
    hostName: 'Test DAW',
    sampleRate: 48000,
    channelCount: 2,
  })))
}

function audioPacket(sequence = 7): Buffer {
  const left = [0.25, -0.5]
  const right = [0.75, -1]
  const payload = Buffer.alloc(DAW_BRIDGE_AUDIO_HEADER_BYTES + 16)
  payload.writeUInt32LE(sequence, 0)
  payload.writeUInt16LE(2, 4)
  payload.writeUInt8(2, 6)
  payload.writeUInt8(0xff, 7)
  payload.writeDoubleLE(48000, 8)
  payload.writeBigInt64LE(96000n, 16)
  payload.writeDoubleLE(2, 24)
  payload.writeDoubleLE(8, 32)
  payload.writeDoubleLE(120, 40)
  payload.writeDoubleLE(8, 48)
  payload.writeDoubleLE(4, 56)
  payload.writeDoubleLE(12, 64)
  payload.writeInt16LE(4, 72)
  payload.writeInt16LE(4, 74)
  left.forEach((value, index) => payload.writeFloatLE(value, DAW_BRIDGE_AUDIO_HEADER_BYTES + index * 4))
  right.forEach((value, index) => payload.writeFloatLE(value, DAW_BRIDGE_AUDIO_HEADER_BYTES + 8 + index * 4))
  return frame(DAW_BRIDGE_MESSAGE.audio, payload)
}

async function openClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => resolve(socket))
    socket.once('error', reject)
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000, label = 'bridge state'): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for ${label}.`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('bridge service parses fragmented control frames and coalesced planar audio', async () => {
  let deliveredBatch: DawBridgeAudioBatch | null = null
  const service = new DawBridgeService({
    port: 0,
    audioBatchIntervalMs: 1,
    onAudioBatch: (batch) => { deliveredBatch = batch },
  })
  await service.start()
  const port = service.getListeningPort()
  assert.ok(port)
  const socket = await openClient(port)

  try {
    const helloFrame = hello('source-one', 'instance-one')
    socket.write(helloFrame.subarray(0, 5))
    socket.write(helloFrame.subarray(5))
    await waitFor(() => service.getSnapshot().sources.length === 1, 1000, 'fragmented hello')

    service.selectSource('source-one')
    socket.write(Buffer.concat([frame(DAW_BRIDGE_MESSAGE.heartbeat), audioPacket()]))
    await waitFor(() => deliveredBatch !== null)

    const packet = deliveredBatch!.packets[0]!
    assert.equal(deliveredBatch!.sourceId, 'source-one')
    assert.deepEqual([...packet.left], [0.25, -0.5])
    assert.deepEqual([...packet.right], [0.75, -1])
    assert.equal(packet.transport.timeInSamples, 96000)
    assert.equal(packet.transport.ppqPosition, 8)
    assert.deepEqual(packet.transport.timeSignature, { numerator: 4, denominator: 4 })
    assert.deepEqual(packet.transport.loopPoints, { ppqStart: 4, ppqEnd: 12 })
  } finally {
    socket.destroy()
    service.stop()
  }
})

test('duplicate persisted UUIDs get distinct live keys and clear implicit selection', async () => {
  const service = new DawBridgeService({ port: 0 })
  await service.start()
  const port = service.getListeningPort()
  assert.ok(port)
  const first = await openClient(port)
  const second = await openClient(port)

  try {
    first.write(hello('duplicate-source', 'instance-alpha'))
    await waitFor(() => service.getSnapshot().sources.length === 1)
    service.selectSource('duplicate-source')
    second.write(hello('duplicate-source', 'instance-beta'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(
      service.getSnapshot().sources.length,
      2,
      JSON.stringify(service.getSnapshot()),
    )

    const snapshot = service.getSnapshot()
    assert.equal(snapshot.selectedSourceId, null)
    assert.equal(new Set(snapshot.sources.map((source) => source.id)).size, 2)
    assert.ok(snapshot.sources.every((source) => source.id !== source.persistentId))
  } finally {
    first.destroy()
    second.destroy()
    service.stop()
  }
})

test('malformed protocol clients are rejected and silent sources expire', async () => {
  const service = new DawBridgeService({
    port: 0,
    heartbeatIntervalMs: 10,
    heartbeatTimeoutMs: 40,
  })
  await service.start()
  const port = service.getListeningPort()
  assert.ok(port)
  const malformed = await openClient(port)
  malformed.write(frame(DAW_BRIDGE_MESSAGE.hello, Buffer.from('{}'), 999))
  await new Promise((resolve) => malformed.once('close', resolve))
  assert.equal(service.getSnapshot().sources.length, 0)

  const silent = await openClient(port)
  try {
    silent.write(hello('silent-source', 'silent-instance'))
    await waitFor(() => service.getSnapshot().sources.length === 1)
    await waitFor(() => service.getSnapshot().sources.length === 0, 500)
  } finally {
    silent.destroy()
    service.stop()
  }
})

test('port conflicts surface an unavailable reason without changing ports', async () => {
  const owner = new DawBridgeService({ port: 0 })
  await owner.start()
  const port = owner.getListeningPort()
  assert.ok(port)
  const blocked = new DawBridgeService({ port })
  try {
    const snapshot = await blocked.start()
    assert.equal(snapshot.available, false)
    assert.match(snapshot.reason ?? '', /Could not listen|address already in use/i)
  } finally {
    blocked.stop()
    owner.stop()
  }
})

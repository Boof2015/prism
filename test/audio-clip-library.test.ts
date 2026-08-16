import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AudioClipLibrary,
  buildAudioClipBaseName,
  encodePcm16Wav,
  validateAudioClipDragPayload,
} from '../src/main/audioClipLibrary'
import type { AudioClipDragPayload } from '../src/types/audioClip'

function clipPayload(overrides: Partial<AudioClipDragPayload> = {}): AudioClipDragPayload {
  return {
    pcmBytes: new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01, 0x00]),
    sampleRate: 48000,
    channelCount: 2,
    frameCount: 2,
    ...overrides,
  }
}

test('validates rolling clip metadata and exact PCM byte count', () => {
  assert.deepEqual(validateAudioClipDragPayload(clipPayload()), clipPayload())
  assert.throws(() => validateAudioClipDragPayload(null), /payload is invalid/i)
  assert.throws(() => validateAudioClipDragPayload(clipPayload({ sampleRate: 384001 })), /sample rate/i)
  assert.throws(() => validateAudioClipDragPayload({
    ...clipPayload(),
    channelCount: 3,
  }), /channel count/i)
  assert.throws(() => validateAudioClipDragPayload(clipPayload({
    frameCount: 48000 * 60 + 1,
  })), /duration/i)
  assert.throws(() => validateAudioClipDragPayload(clipPayload({
    pcmBytes: new Uint8Array(6),
  })), /data length/i)
})

test('encodes a standard little-endian 16-bit PCM WAV', () => {
  const payload = clipPayload()
  const wav = encodePcm16Wav(payload)

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), 36 + payload.pcmBytes.byteLength)
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ')
  assert.equal(wav.readUInt16LE(20), 1)
  assert.equal(wav.readUInt16LE(22), 2)
  assert.equal(wav.readUInt32LE(24), 48000)
  assert.equal(wav.readUInt32LE(28), 192000)
  assert.equal(wav.readUInt16LE(32), 4)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(40), payload.pcmBytes.byteLength)
  assert.deepEqual(Array.from(wav.subarray(44)), Array.from(payload.pcmBytes))
})

test('writes persistent clips with safe timestamped collision-resistant names', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'prism-audio-clips-'))
  t.after(async () => rm(parent, { recursive: true, force: true }))
  const directory = join(parent, 'Prism Captures')
  const now = new Date('2026-08-16T17:42:03.123Z')
  const library = new AudioClipLibrary(directory, () => now)

  assert.equal(buildAudioClipBaseName(now), 'Prism Clip 2026-08-16 17-42-03.123')
  const firstPath = library.writeClip(clipPayload())
  const secondPath = library.writeClip(clipPayload())

  assert.equal(firstPath, join(directory, 'Prism Clip 2026-08-16 17-42-03.123.wav'))
  assert.equal(secondPath, join(directory, 'Prism Clip 2026-08-16 17-42-03.123 (2).wav'))
  assert.deepEqual(await readFile(firstPath), encodePcm16Wav(clipPayload()))
  assert.deepEqual(await readFile(secondPath), encodePcm16Wav(clipPayload()))
})

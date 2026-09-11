import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AudioClipLibrary,
  buildAudioClipBaseName,
  encodeAudioClipWav,
  validateAudioClipDragPayload,
} from '../src/main/audioClipLibrary'
import type { AudioClipDragPayload } from '../src/types/audioClip'
import { encodeAudioClipPayload } from '../src/shared/audioClipEncoding'

function clipPayload(overrides: Partial<AudioClipDragPayload> = {}): AudioClipDragPayload {
  return {
    format: 'pcm16',
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
  const wav = encodeAudioClipWav(payload)

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

test('rejects missing or unknown formats and mismatched float byte counts', () => {
  for (const format of [undefined, null, 'pcm32', 32]) {
    assert.throws(() => validateAudioClipDragPayload({ ...clipPayload(), format }), /format/i)
  }
  assert.throws(() => validateAudioClipDragPayload(clipPayload({ format: 'float32' })), /data length/i)
})

test('serializes PCM16 with existing clipping and rounding in little-endian order', () => {
  const pcmSamples = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN, Infinity, -Infinity])
  const payload = encodeAudioClipPayload({ pcmSamples, sampleRate: 44100, channelCount: 1, frameCount: 10 }, 'pcm16')
  assert.deepEqual(Array.from(payload.pcmBytes), [
    0, 128, 0, 128, 0, 192, 0, 0, 0, 64, 255, 127, 255, 127, 0, 0, 0, 0, 0, 0,
  ])
  const wav = encodeAudioClipWav(payload)
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 44100)
  assert.equal(wav.readUInt16LE(32), 2)
  assert.equal(wav.readUInt32LE(28), 88200)
})

test('encodes mono and stereo IEEE float WAV with full precision and a fact chunk', () => {
  for (const channelCount of [1, 2] as const) {
    const pcmSamples = new Float32Array([1.25, -2, 0.123456789, 1e-8, NaN, Infinity])
    const frameCount = pcmSamples.length / channelCount
    const payload = encodeAudioClipPayload({ pcmSamples, sampleRate: 96000, channelCount, frameCount }, 'float32')
    const wav = encodeAudioClipWav(payload)
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.readUInt32LE(4), wav.length - 8)
    assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ')
    assert.equal(wav.readUInt32LE(16), 18)
    assert.equal(wav.readUInt16LE(20), 3)
    assert.equal(wav.readUInt16LE(22), channelCount)
    assert.equal(wav.readUInt32LE(24), 96000)
    assert.equal(wav.readUInt32LE(28), 96000 * channelCount * 4)
    assert.equal(wav.readUInt16LE(32), channelCount * 4)
    assert.equal(wav.readUInt16LE(34), 32)
    assert.equal(wav.readUInt16LE(36), 0)
    assert.equal(wav.toString('ascii', 38, 42), 'fact')
    assert.equal(wav.readUInt32LE(42), 4)
    assert.equal(wav.readUInt32LE(46), frameCount)
    assert.equal(wav.toString('ascii', 50, 54), 'data')
    assert.equal(wav.readUInt32LE(54), pcmSamples.length * 4)
    assert.equal(wav.length, 58 + pcmSamples.length * 4)
    for (let index = 0; index < pcmSamples.length; index += 1) {
      assert.equal(wav.readFloatLE(58 + index * 4), Number.isFinite(pcmSamples[index]) ? pcmSamples[index] : 0)
    }
    assert.deepEqual(Array.from(payload.pcmBytes.subarray(0, 4)), [0, 0, 160, 63])
  }
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
  assert.deepEqual(await readFile(firstPath), encodeAudioClipWav(clipPayload()))
  assert.deepEqual(await readFile(secondPath), encodeAudioClipWav(clipPayload()))
  const floatPayload = encodeAudioClipPayload({
    pcmSamples: new Float32Array([1.25, -1.25]), sampleRate: 48000, channelCount: 2, frameCount: 1,
  }, 'float32')
  assert.deepEqual(await readFile(library.writeClip(floatPayload)), encodeAudioClipWav(floatPayload))
})

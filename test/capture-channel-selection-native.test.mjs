import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { captureChannelSelection } = require('../native/build/Release/visualizer_dsp.node')

function select(buffers, frames, sourceChannels, left, right) {
  return captureChannelSelection.selectFloat32(buffers, frames, sourceChannels, left, right)
}

function values(array) {
  return [...array]
}

test('selects non-adjacent channels from an interleaved buffer', () => {
  const result = select([{
    data: new Float32Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]),
    channelCount: 4,
  }], 2, 4, 3, 1)

  assert.equal(result.valid, true)
  assert.deepEqual(values(result.left), [4, 8])
  assert.deepEqual(values(result.right), [2, 6])
})

test('selects channels from planar buffers and supports duplicate routing', () => {
  const buffers = [
    { data: new Float32Array([1, 2]), channelCount: 1 },
    { data: new Float32Array([3, 4]), channelCount: 1 },
    { data: new Float32Array([5, 6]), channelCount: 1 },
  ]
  const result = select(buffers, 2, 3, 2, 2)

  assert.equal(result.valid, true)
  assert.deepEqual(values(result.left), [5, 6])
  assert.deepEqual(values(result.right), [5, 6])
})

test('selects across multiple buffers that each contain interleaved channels', () => {
  const result = select([
    { data: new Float32Array([1, 2, 5, 6]), channelCount: 2 },
    { data: new Float32Array([3, 4, 7, 8]), channelCount: 2 },
  ], 2, 4, 2, 0)

  assert.equal(result.valid, true)
  assert.deepEqual(values(result.left), [3, 7])
  assert.deepEqual(values(result.right), [1, 5])
})

test('renders silent or short native buffers safely', () => {
  const silent = select([null, null], 3, 2, 0, 1)
  assert.equal(silent.valid, true)
  assert.deepEqual(values(silent.left), [0, 0, 0])
  assert.deepEqual(values(silent.right), [0, 0, 0])

  const short = select([
    { data: new Float32Array([1]), channelCount: 1 },
    { data: new Float32Array([2]), channelCount: 1 },
  ], 2, 2, 0, 1)
  assert.deepEqual(values(short.left), [1, 0])
  assert.deepEqual(values(short.right), [2, 0])
})

test('rejects out-of-range routes without reading native memory', () => {
  const result = select([
    { data: new Float32Array([1, 2, 3, 4]), channelCount: 2 },
  ], 2, 2, 0, 8)

  assert.equal(result.valid, false)
  assert.deepEqual(values(result.left), [0, 0])
  assert.deepEqual(values(result.right), [0, 0])
})

test('measures every interleaved source channel independently of the stereo routes', () => {
  const buffers = [{
    data: new Float32Array([0.125, -0.25, 0, -0.75, -0.5, 0.125, 0, 0.25]),
    channelCount: 4,
  }]
  const original = values(buffers[0].data)
  const result = select(buffers, 2, 4, 0, 1)
  assert.deepEqual(values(result.sourceChannelPeaks), [0.5, 0.25, 0, 0.75])
  assert.deepEqual(values(result.left), [0.125, -0.5])
  assert.deepEqual(values(result.right), [-0.25, 0.125])
  assert.deepEqual(values(buffers[0].data), original)
  assert.deepEqual(values(select(buffers, 2, 4, 3, 3).sourceChannelPeaks), values(result.sourceChannelPeaks))
  assert.deepEqual(values(select(buffers, 2, 4, 0, 99).sourceChannelPeaks), values(result.sourceChannelPeaks))
})

test('measures planar, mixed-buffer, and mono source activity', () => {
  const planar = select([
    { data: new Float32Array([-0.25, 0.125]), channelCount: 1 },
    { data: new Float32Array([0.5, -1]), channelCount: 1 },
    { data: new Float32Array([0, 0]), channelCount: 1 },
  ], 2, 3, 0, 0)
  assert.deepEqual(values(planar.sourceChannelPeaks), [0.25, 1, 0])
  const mixed = select([
    { data: new Float32Array([0.25, -0.5, -0.125, 0.25]), channelCount: 2 },
    { data: new Float32Array([0.75, -1, 0.5, 0]), channelCount: 2 },
  ], 2, 4, 1, 2)
  assert.deepEqual(values(mixed.sourceChannelPeaks), [0.25, 0.5, 0.75, 1])
  const mono = select([{ data: new Float32Array([-0.75, 0.5]), channelCount: 1 }], 2, 1, 0, 0)
  assert.deepEqual(values(mono.sourceChannelPeaks), [0.75])
  assert.deepEqual(values(mono.left), values(mono.right))
})

test('source activity treats absent and short buffers as silence and respects frame limits', () => {
  assert.deepEqual(values(select([null, null], 3, 2, 0, 1).sourceChannelPeaks), [0, 0])
  assert.deepEqual(values(select([
    { data: new Float32Array([0.25]), channelCount: 2 },
    null,
  ], 2, 4, 0, 1).sourceChannelPeaks), [0.25, 0, 0, 0])
  const buffers = [{ data: new Float32Array([0.125, 1]), channelCount: 1 }]
  assert.deepEqual(values(select(buffers, 1, 1, 0, 0).sourceChannelPeaks), [0.125])
  assert.deepEqual(values(select(buffers, 0, 1, 0, 0).sourceChannelPeaks), [0])
})

test('source activity ignores nonfinite samples but retains finite overrange peaks', () => {
  const result = select([
    { data: new Float32Array([NaN, Infinity, -Infinity, -0.5]), channelCount: 1 },
    { data: new Float32Array([NaN, Infinity, -Infinity, 0]), channelCount: 1 },
    { data: new Float32Array([-2, 1.5, 0, 0]), channelCount: 1 },
  ], 4, 3, 2, 2)
  assert.deepEqual(values(result.sourceChannelPeaks), [0.5, 0, 2])
})

function encodePCM(values, format) {
  const bytes = format.bitsPerChannel / 8
  const buffer = new Uint8Array(values.length * bytes)
  const view = new DataView(buffer.buffer)
  for (let index = 0; index < values.length; index++) {
    if (format.encoding === 'float') {
      view[bytes === 4 ? 'setFloat32' : 'setFloat64'](index * bytes, values[index], !format.bigEndian)
      continue
    }
    const bits = format.validBitsPerChannel ?? format.bitsPerChannel
    const magnitude = 2 ** (bits - 1)
    const scale = format.normalizeByPowerOfTwo || format.encoding === 'unsigned' ? magnitude : magnitude - 1
    let sample = BigInt(Math.round(values[index] * scale))
    if (format.encoding === 'unsigned') sample += BigInt(magnitude)
    sample = BigInt.asUintN(bits, sample)
    if (format.highAligned) sample <<= BigInt(format.bitsPerChannel - bits)
    for (let byte = 0; byte < bytes; byte++) {
      buffer[index * bytes + (format.bigEndian ? bytes - byte - 1 : byte)] = Number((sample >> BigInt(8 * byte)) & 255n)
    }
  }
  return buffer
}

const pcmFormats = [
  { encoding: 'unsigned', bitsPerChannel: 8 },
  ...[8, 16, 24, 32].map(bitsPerChannel => ({ encoding: 'signed', bitsPerChannel })),
  { encoding: 'signed', bitsPerChannel: 32, validBitsPerChannel: 24, highAligned: true },
  { encoding: 'signed', bitsPerChannel: 32, validBitsPerChannel: 20, highAligned: true },
  { encoding: 'signed', bitsPerChannel: 32, validBitsPerChannel: 24, normalizeByPowerOfTwo: true },
  ...[16, 24, 32].map(bitsPerChannel => ({ encoding: 'signed', bitsPerChannel, normalizeByPowerOfTwo: true })),
  { encoding: 'float', bitsPerChannel: 32 },
  { encoding: 'float', bitsPerChannel: 64 },
]

for (const baseFormat of pcmFormats) {
  for (const bigEndian of [false, true]) {
    const format = { ...baseFormat, bigEndian }
    test(`routes and measures multichannel PCM: ${JSON.stringify(format)}`, () => {
      const pcm = encodePCM([0.125, -0.25, 0.5, -0.75, -0.5, 0.125, -0.25, 0.25], format)
      // A subarray verifies that the native helper respects typed-array offsets.
      const padded = new Uint8Array(pcm.length + 8)
      padded.set(pcm, 4)
      const buffers = [{ data: padded.subarray(4, 4 + pcm.length), channelCount: 4 }]
      const result = captureChannelSelection.selectPCM(buffers, 2, 4, 3, 1, format)
      assert.equal(result.valid, true)
      const close = (actual, expected) => actual.forEach((sample, index) => {
        assert.ok(Math.abs(sample - expected[index]) < 0.005, `${sample} != ${expected[index]}`)
      })
      close(result.left, [-0.75, 0.25])
      close(result.right, [-0.25, 0.125])
      close(result.sourceChannelPeaks, [0.5, 0.25, 0.5, 0.75])
      const duplicate = captureChannelSelection.selectPCM(buffers, 2, 4, 2, 2, format)
      assert.deepEqual(values(duplicate.left), values(duplicate.right))
      assert.deepEqual(values(duplicate.sourceChannelPeaks), values(result.sourceChannelPeaks))
    })
  }
}

test('invalid PCM formats render silence instead of decoding unsupported memory layouts', () => {
  for (const format of [
    { encoding: 'float', bitsPerChannel: 24 },
    { encoding: 'signed', bitsPerChannel: 64 },
    { encoding: 'signed', bitsPerChannel: 32, validBitsPerChannel: 40 },
    { encoding: 'compressed', bitsPerChannel: 16 },
  ]) {
    const result = captureChannelSelection.selectPCM(
      [{ data: new Uint8Array(32).fill(255), channelCount: 2 }], 2, 2, 0, 1, format)
    assert.equal(result.valid, false)
    assert.deepEqual(values(result.left), [0, 0])
    assert.deepEqual(values(result.right), [0, 0])
    assert.deepEqual(values(result.sourceChannelPeaks), [0, 0])
  }
})

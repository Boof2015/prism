import assert from 'node:assert/strict'
import test from 'node:test'
import { RollingAudioBuffer } from '../src/renderer/audio/RollingAudioBuffer'

test('rolling audio buffer allocates exact fixed float capacity and preserves stereo headroom', () => {
  const buffer = new RollingAudioBuffer(5, 2, 2)
  assert.equal(buffer.allocatedBytes, 5 * 2 * 2 * 4)
  assert.equal(buffer.frameCount, 0)
  assert.equal(buffer.snapshot(), null)

  buffer.append(
    new Float32Array([-2, -0.5, 0, 0.5, 2, Number.NaN]),
    new Float32Array([1, 0.25, 0, -0.25, -1, Number.POSITIVE_INFINITY]),
    2,
  )

  const snapshot = buffer.snapshot()
  assert.ok(snapshot)
  assert.equal(snapshot.channelCount, 2)
  assert.equal(snapshot.sampleRate, 2)
  assert.equal(snapshot.frameCount, 6)
  assert.deepEqual(Array.from(snapshot.pcmSamples), [
    -2, 1,
    -0.5, 0.25,
    0, 0,
    0.5, -0.25,
    2, -1,
    0, 0,
  ])
})

test('rolling audio buffer keeps chronological newest frames across wrapping', () => {
  const buffer = new RollingAudioBuffer(5, 2, 2)
  const left = new Float32Array(Array.from({ length: 12 }, (_, index) => index / 20))
  const right = new Float32Array(Array.from({ length: 12 }, (_, index) => -index / 20))

  buffer.append(left.subarray(0, 6), right.subarray(0, 6), 2)
  buffer.append(left.subarray(6), right.subarray(6), 2)

  const snapshot = buffer.snapshot()
  assert.ok(snapshot)
  assert.equal(snapshot.frameCount, 10)
  assert.equal(buffer.isReady, true)

  const expected: number[] = []
  for (let index = 2; index < 12; index += 1) {
    expected.push(left[index], right[index])
  }
  assert.deepEqual(Array.from(snapshot.pcmSamples), expected)
})

test('rolling audio buffer supports mono and ignores mismatched channel chunks', () => {
  const buffer = new RollingAudioBuffer(5, 2, 1)
  buffer.append(new Float32Array([0.25, -0.25]), new Float32Array([1, 1]), 2)
  assert.equal(buffer.frameCount, 0)

  buffer.append(new Float32Array([0.25, -0.25]), new Float32Array(), 1)
  const snapshot = buffer.snapshot()
  assert.ok(snapshot)
  assert.equal(snapshot.channelCount, 1)
  assert.deepEqual(Array.from(snapshot.pcmSamples), [0.25, -0.25])
})

test('rolling audio buffer preserves newest audio while growing and shrinking', () => {
  const buffer = new RollingAudioBuffer(5, 2, 1)
  const initial = new Float32Array(Array.from({ length: 10 }, (_, index) => index / 20))
  buffer.append(initial, new Float32Array(), 1)

  buffer.resize(10)
  assert.equal(buffer.allocatedBytes, 10 * 2 * 1 * 4)
  assert.equal(buffer.frameCount, 10)
  assert.equal(buffer.isReady, false)

  const appended = new Float32Array(Array.from({ length: 12 }, (_, index) => (index + 10) / 40))
  buffer.append(appended, new Float32Array(), 1)
  buffer.resize(5)

  const snapshot = buffer.snapshot()
  assert.ok(snapshot)
  assert.equal(snapshot.frameCount, 10)
  assert.equal(buffer.isReady, true)
  assert.deepEqual(
    Array.from(snapshot.pcmSamples),
    Array.from(appended.subarray(2)),
  )
})

test('rolling audio buffer keeps only the tail of chunks larger than capacity', () => {
  const buffer = new RollingAudioBuffer(5, 2, 1)
  const input = new Float32Array(Array.from({ length: 14 }, (_, index) => index / 20))
  buffer.append(input, new Float32Array(), 1)

  const snapshot = buffer.snapshot()
  assert.ok(snapshot)
  assert.deepEqual(
    Array.from(snapshot.pcmSamples),
    Array.from(input.subarray(4)),
  )
})

test('rolling audio buffer append stays below the one millisecond chunk budget', () => {
  const buffer = new RollingAudioBuffer(60, 48000, 2)
  const left = new Float32Array(128).fill(0.25)
  const right = new Float32Array(128).fill(-0.25)

  for (let index = 0; index < 100; index += 1) {
    buffer.append(left, right, 2)
  }

  const durations: number[] = []
  for (let index = 0; index < 1000; index += 1) {
    const startedAt = performance.now()
    buffer.append(left, right, 2)
    durations.push(performance.now() - startedAt)
  }
  durations.sort((leftDuration, rightDuration) => leftDuration - rightDuration)

  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
  assert.ok(p95 < 1, `expected rolling buffer p95 under 1ms, received ${p95.toFixed(3)}ms`)
})

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

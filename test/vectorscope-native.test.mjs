import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { vectorscope } = require('../native/build/Release/visualizer_dsp.node')

function createHighFrequencyStereo(frequencyHz, sampleRate, length) {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const phase = 2 * Math.PI * frequencyHz * index / sampleRate
    left[index] = 0.75 * Math.sin(phase)
    right[index] = -0.4 * Math.cos(phase)
  }
  return { left, right }
}

function assertArrayAlmostEqual(actual, expected, tolerance, message) {
  assert.equal(actual.length, expected.length, `${message} length`)
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${message} sample ${index}: expected ${expected[index]} +/- ${tolerance}, got ${actual[index]}`,
    )
  }
}

test('native vectorscope preserves full-band channel samples above the former 8 kHz cutoff', () => {
  const length = 512

  for (const sampleRate of [44100, 48000, 96000]) {
    const frequencyHz = 12000
    const { left, right } = createHighFrequencyStereo(frequencyHz, sampleRate, length)

    vectorscope.setSampleRate(sampleRate)
    vectorscope.reset()
    vectorscope.pushSamples(left, right)
    const result = vectorscope.getPoints(length)

    assert.equal(result.count, length)
    assertArrayAlmostEqual(result.x, right, 1e-7, `${sampleRate}Hz right/X`)
    assertArrayAlmostEqual(result.y, left, 1e-7, `${sampleRate}Hz left/Y`)
  }
})

test('native vectorscope legacy process keeps the renderer-facing X/Y channel shape', () => {
  const { left, right } = createHighFrequencyStereo(15000, 48000, 256)
  vectorscope.setSampleRate(48000)
  vectorscope.reset()

  const result = vectorscope.process(left, right)
  assertArrayAlmostEqual(result.x, right, 1e-7, 'legacy right/X')
  assertArrayAlmostEqual(result.y, left, 1e-7, 'legacy left/Y')
})

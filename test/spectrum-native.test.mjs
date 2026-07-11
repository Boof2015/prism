import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { spectrum } = require('../native/build/Release/visualizer_dsp.node')

const SAMPLE_RATE = 48000
const SILENCE_DB = -120

function createTone(frequencyHz, length, amplitude = 1) {
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE) * amplitude
  }
  return samples
}

function configure(fftSize) {
  spectrum.setFFTSize(fftSize)
  spectrum.setSampleRate(SAMPLE_RATE)
  spectrum.setSmoothing(0)
  spectrum.reset()
}

function assertAlmostEqual(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  )
}

function interpolatePeakDb(magnitudes) {
  let peakBin = 1
  for (let index = 2; index < magnitudes.length - 1; index += 1) {
    if (magnitudes[index] > magnitudes[peakBin]) peakBin = index
  }

  const y1 = magnitudes[peakBin - 1]
  const y2 = magnitudes[peakBin]
  const y3 = magnitudes[peakBin + 1]
  const denominator = y1 - (2 * y2) + y3
  if (Math.abs(denominator) <= 1e-9) return y2
  const offset = Math.max(-0.5, Math.min(0.5, 0.5 * (y1 - y3) / denominator))
  return y2 - (0.25 * (y1 - y3) * offset)
}

test('spectrum channel-max dBFS is calibrated for bin-centered amplitudes', () => {
  const fftSize = 2048
  const bin = 42
  const frequencyHz = bin * SAMPLE_RATE / fftSize

  for (const amplitude of [1, 0.5, 0.1]) {
    configure(fftSize)
    spectrum.pushSamples(createTone(frequencyHz, fftSize, amplitude))
    const expectedDbfs = 20 * Math.log10(amplitude)
    const filledMagnitudes = new Float32Array(fftSize / 2)
    assert.equal(spectrum.fillChannelMaxMagnitudes(filledMagnitudes), fftSize / 2)
    assertAlmostEqual(
      filledMagnitudes[bin],
      expectedDbfs,
      0.05,
      `amplitude ${amplitude}`,
    )
  }
})

test('spectrum off-bin dBFS interpolation stays within 0.3 dB across FFT sizes', () => {
  for (const fftSize of [1024, 2048, 4096, 8192, 16384]) {
    configure(fftSize)
    spectrum.pushSamples(createTone(440, fftSize))
    assertAlmostEqual(
      interpolatePeakDb(spectrum.getChannelMaxMagnitudes()),
      0,
      0.3,
      `FFT size ${fftSize}`,
    )
  }
})

test('spectrum preserves Mid/Side curves while channel-max follows the louder L/R channel', () => {
  const fftSize = 2048
  const bin = 42
  const frequencyHz = bin * SAMPLE_RATE / fftSize
  const fullScale = createTone(frequencyHz, fftSize)
  const halfScale = createTone(frequencyHz, fftSize, 0.5)
  const silence = new Float32Array(fftSize)
  const inverted = Float32Array.from(fullScale, (sample) => -sample)

  configure(fftSize)
  spectrum.pushStereoSamples(fullScale, silence)
  assertAlmostEqual(spectrum.getMagnitudes()[bin], -6.0206, 0.05, 'left-only Mid level')
  assertAlmostEqual(spectrum.getSideMagnitudes()[bin], -6.0206, 0.05, 'left-only Side level')
  assertAlmostEqual(spectrum.getChannelMaxMagnitudes()[bin], 0, 0.05, 'left-only channel max')

  configure(fftSize)
  spectrum.pushStereoSamples(silence, fullScale)
  assertAlmostEqual(spectrum.getChannelMaxMagnitudes()[bin], 0, 0.05, 'right-only channel max')

  configure(fftSize)
  spectrum.pushStereoSamples(halfScale, fullScale)
  assertAlmostEqual(spectrum.getChannelMaxMagnitudes()[bin], 0, 0.05, 'unequal-channel max')

  configure(fftSize)
  spectrum.pushStereoSamples(fullScale, inverted)
  assert.equal(spectrum.getMagnitudes()[bin], SILENCE_DB)
  assertAlmostEqual(spectrum.getSideMagnitudes()[bin], 0, 0.05, 'anti-phase Side level')
  assertAlmostEqual(spectrum.getChannelMaxMagnitudes()[bin], 0, 0.05, 'anti-phase channel max')
})

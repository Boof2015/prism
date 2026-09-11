import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { waterfall, spectrum } = require('../native/build/Release/visualizer_dsp.node')
const defaults = { sampleRate: 48000, fftSize: 2048, smoothing: 0, tiltDbPerOctave: 0, historySeconds: 5, minFrequency: 10, maxFrequency: 24000, scaleMode: 'log' }
function configure(options = {}) { waterfall.reset(); waterfall.configure({ ...defaults, ...options }) }
function tone(length, hz = 1007.8125, amplitude = 0.5, sampleRate = 48000) {
  return Float32Array.from({ length }, (_, index) => amplitude * Math.sin(2 * Math.PI * hz * index / sampleRate))
}
function push(samples, chunkSize = samples.length, antiPhase = false) {
  const right = antiPhase ? samples.map((value) => -value) : samples
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    waterfall.processStereo(samples.subarray(offset, offset + chunkSize), right.subarray(offset, offset + chunkSize))
  }
}

test('waterfall preserves calibrated stereo levels and frequency placement at every FFT size and scale', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const fftSize of [1024, 2048, 4096, 8192, 16384]) {
      const hz = Math.round(1000 * fftSize / sampleRate) * sampleRate / fftSize
      for (const scaleMode of ['log', 'mel', 'linear']) {
        configure({ sampleRate, fftSize, scaleMode })
        push(tone(sampleRate, hz, 0.5, sampleRate), 713, true)
        const frame = waterfall.getFrame(32, 512)
        const latest = frame.levels.subarray(0, frame.columns)
        const peak = Math.max(...latest)
        assert.ok(Math.abs(peak - 20 * Math.log10(0.5)) < 0.1, `${sampleRate}/${fftSize}/${scaleMode}: ${peak}`)
        const index = latest.indexOf(peak)
        assert.ok(Math.abs(frame.frequencies[index] - hz) < Math.max(100, sampleRate / fftSize))
      }
    }
  }
})

test('waterfall cadence and history are independent of chunks and 30/60/120 FPS reads', () => {
  for (const sampleRate of [44100, 48000, 44101]) {
    const audio = tone(sampleRate * 3, 731, 0.4, sampleRate)
    let expected
    for (const fps of [30, 60, 120]) {
      configure({ sampleRate })
      let offset = 0
      for (let frame = 1; offset < audio.length; frame++) {
        const end = Math.min(audio.length, Math.round(frame * sampleRate / fps))
        const chunk = audio.subarray(offset, end)
        waterfall.processStereo(chunk, chunk)
        const first = waterfall.getFrame(32, 128)
        assert.deepEqual(waterfall.getFrame(32, 128), first, 'reads must not advance history')
        offset = end
      }
      const result = waterfall.getFrame(32, 128)
      assert.equal(result.audioSeconds, 3)
      assert.ok(result.ages.length > 12)
      if (expected) assert.deepEqual(result, expected)
      expected = result
    }
    configure({ sampleRate })
    push(audio, 137)
    assert.deepEqual(waterfall.getFrame(32, 128), expected)
  }
})

test('history grows from available audio, retains recent rows on resize, and stays bounded', () => {
  configure({ historySeconds: 1 })
  push(tone(48000 * 2))
  const recent = waterfall.getFrame(32, 128)
  assert.ok(recent.ages.every((age) => age <= 1))
  waterfall.configure({ ...defaults, historySeconds: 30 })
  const expanded = waterfall.getFrame(64, 128)
  assert.equal(expanded.audioSeconds, 2)
  assert.deepEqual(expanded.levels.subarray(0, 128), recent.levels.subarray(0, 128))
  assert.ok(expanded.ages.every((age) => age <= 1.04), 'cannot invent missing history')
  push(tone(48000 * 32))
  const full = waterfall.getFrame(10000, 10000)
  assert.ok(full.ages.length <= 64 && full.levels.length <= 64 * 512)
  assert.ok(full.ages.at(-1) > 29 && full.ages.at(-1) <= 30)
  waterfall.configure({ ...defaults, historySeconds: 1 })
  assert.ok(waterfall.getFrame(64, 128).ages.every((age) => age <= 1))
})

test('appearance projection preserves history while sample rate, FFT size, and reset clear it', () => {
  configure()
  push(tone(48000))
  waterfall.configure({ ...defaults, scaleMode: 'mel', tiltDbPerOctave: 4, smoothing: 0.8 })
  assert.equal(waterfall.getFrame(32, 128).audioSeconds, 1)
  assert.ok(waterfall.getFrame(32, 128).ages.length > 0)
  waterfall.configure({ ...defaults, fftSize: 4096 })
  assert.equal(waterfall.getFrame(32, 128).ages.length, 0)
  push(tone(48000))
  waterfall.configure({ ...defaults, fftSize: 4096, sampleRate: 44100 })
  assert.equal(waterfall.getFrame(32, 128).ages.length, 0)
  push(tone(44100))
  waterfall.reset()
  assert.equal(waterfall.getFrame(32, 128).audioSeconds, 0)
  assert.equal(waterfall.getFrame(32, 128).ages.length, 0)
})

test('silence and invalid samples stay finite and waterfall does not change Spectrum state', () => {
  spectrum.setFFTSize(4096)
  spectrum.setSmoothing(0)
  const audio = tone(48000)
  spectrum.pushStereoSamples(audio, audio)
  const spectrumBefore = spectrum.getChannelMaxMagnitudes()
  configure()
  push(new Float32Array(48000))
  assert.ok(waterfall.getFrame(32, 128).levels.every((db) => db <= -99))
  push(Float32Array.from({ length: 48000 }, (_, i) => i % 2 ? NaN : Infinity))
  assert.ok(waterfall.getFrame(32, 128).levels.every(Number.isFinite))
  assert.equal(spectrum.getFFTSize(), 4096)
  assert.deepEqual(spectrum.getChannelMaxMagnitudes(), spectrumBefore)
  assert.throws(() => waterfall.processStereo(new Float64Array(10), new Float32Array(10)), /Float32Array/)
})

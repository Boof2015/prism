import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { referenceAnalysis, spectrum } = require('../native/build/Release/visualizer_dsp.node')
const directory = mkdtempSync(join(tmpdir(), 'prism-reference-dsp-'))
after(() => rmSync(directory, { recursive: true, force: true }))
const sizes = [1024, 2048, 4096, 8192, 16384]
function wav(rate = 48000, seconds = 2, gain = 0.1, mode = 'mono') {
  const channels = mode === 'mono' ? 1 : 2, frames = Math.round(rate * seconds)
  const bytes = Buffer.alloc(44 + frames * channels * 4)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 4, 28)
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  for (let i = 0; i < frames; i++) {
    const sample = gain * Math.sin(2 * Math.PI * 1500 * i / rate)
    bytes.writeFloatLE(sample, 44 + i * channels * 4)
    if (channels === 2) bytes.writeFloatLE(mode === 'antiphase' ? -sample : mode === 'left' ? 0 : sample, 48 + i * 8)
  }
  return bytes
}
let counter = 0
function analyze(bytes, chunk = 4096) {
  const path = join(directory, `référence 日本語 ${counter++}.wav`)
  writeFileSync(path, bytes)
  const previews = []
  return new Promise((resolve, reject) => referenceAnalysis.start(path, (fraction, data) => previews.push({ fraction, data }),
    (error, result) => error ? reject(error) : resolve({ ...result, previews }), chunk))
}
test('all FFT sizes preserve tone calibration and level at different source sample rates', async () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    const result = await analyze(wav(rate))
    assert.ok(Math.abs(result.meanSquare - 0.005) < 0.00001, `RMS ${rate}`)
    assert.ok(Math.abs(result.durationSeconds - 2) < 1 / 48000)
    assert.equal(result.sourceNyquistHz, rate / 2)
    for (const size of sizes) {
      assert.equal(result.curves[size].length, size / 2)
      const level = 10 * Math.log10(result.curves[size][1500 * size / 48000])
      assert.ok(Math.abs(level + 20) < 0.06, `${rate}/${size}: ${level}`)
    }
  }
})
test('chunk boundaries and previews do not alter whole-track analysis', async () => {
  const bytes = wav(44100, 1.137)
  const a = await analyze(bytes, 257), b = await analyze(bytes, 16384)
  assert.ok(Math.abs(a.meanSquare - b.meanSquare) < 1e-12)
  for (const size of sizes) assert.deepEqual(a.curves[size], b.curves[size])
  assert.ok(a.previews.length > 0)
  assert.ok(a.previews.every(p => p.fraction >= 0 && p.fraction < 1))
})
test('stereo Mid follows existing analyzer semantics; silence and damaged files fail cleanly', async () => {
  const mono = await analyze(wav()), stereo = await analyze(wav(48000, 2, 0.1, 'stereo'))
  assert.deepEqual(mono.curves, stereo.curves)
  const left = await analyze(wav(48000, 2, 0.1, 'left'))
  assert.ok(Math.abs(10 * Math.log10(left.meanSquare / mono.meanSquare) + 6.0206) < 0.001)
  await assert.rejects(analyze(wav(48000, 1, 0.1, 'antiphase')), /no usable signal/)
  await assert.rejects(analyze(wav(48000, 1, 0)), /no usable signal/)
  await assert.rejects(analyze(Buffer.from('not audio')), /Could not open/)
  await assert.rejects(analyze(wav().subarray(0, 1000)), /incomplete|damaged/)
  const short = await analyze(wav(48000, 0.01))
  assert.ok(sizes.every(size => short.curves[size].every(Number.isFinite)))
  const impulse = wav(48000, 1 / 48000); impulse.writeFloatLE(0.1, 44)
  const tiny = await analyze(impulse)
  assert.equal(tiny.durationSeconds, 1 / 48000)
  assert.ok(sizes.every(size => tiny.curves[size][10] > 0), 'partial Hann windows retain very short nonzero audio')
})

test('native teardown releases an active resampler before shared caches', () => {
  const addonPath = require.resolve('../native/build/Release/visualizer_dsp.node')
  const result = spawnSync(process.execPath, ['-e', `const {spectrum}=require(${JSON.stringify(addonPath)}); spectrum.setSampleRate(44100); spectrum.setReferenceEnabled(true); spectrum.pushSamples(new Float32Array(8000).fill(0.1));`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
test('imports and cancellation leave live analyzer state untouched', async () => {
  spectrum.setReferenceEnabled(false); spectrum.setFFTSize(2048); spectrum.setSmoothing(0); spectrum.reset()
  const samples = Float32Array.from({ length: 2048 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 1500 * i / 48000))
  spectrum.pushSamples(samples)
  const before = spectrum.getMagnitudes().slice()
  await analyze(wav())
  assert.deepEqual(spectrum.getMagnitudes(), before)
  const path = join(directory, 'cancel.wav'); writeFileSync(path, wav(48000, 10))
  await new Promise(resolve => {
    const id = referenceAnalysis.start(path, () => {}, error => { assert.ok(error); resolve() })
    referenceAnalysis.cancel(id)
  })
  assert.deepEqual(spectrum.getMagnitudes(), before)
})
test('live reference analysis uses the canonical frequency axis and a bounded three-second level window', () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    spectrum.setSampleRate(rate); spectrum.setReferenceEnabled(true); spectrum.setFFTSize(2048); spectrum.setSmoothing(0); spectrum.reset()
    for (let start = 0; start < rate * 4; start += 1024) {
      const samples = Float32Array.from({ length: Math.min(1024, rate * 4 - start) }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 1500 * (i + start) / rate))
      spectrum.pushSamples(samples)
    }
    const level = spectrum.getReferenceLevel()
    assert.equal(level.seconds, 3)
    assert.ok(Math.abs(level.meanSquare - 0.005) < 0.00001)
    assert.equal(spectrum.binToFrequency(64), 1500)
    assert.ok(Math.abs(spectrum.getMagnitudes()[64] + 20) < 0.06)
    spectrum.pushSamples(new Float32Array(Math.ceil(rate * 0.12)))
    assert.equal(spectrum.getReferenceLevel().meanSquare, 0, 'recent silence disables matching despite older signal')
    spectrum.reset(); assert.equal(spectrum.getReferenceLevel().seconds, 0)
  }
  spectrum.setReferenceEnabled(false)
})

test('broadband gain comparisons are independent of import chunk boundaries', async () => {
  const bytes = wav(48000, 3), louder = Buffer.from(bytes)
  let seed = 12345
  for (let offset = 44; offset < bytes.length; offset += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const sample = (seed / 4294967296 - 0.5) * 0.1
    bytes.writeFloatLE(sample, offset); louder.writeFloatLE(sample * 2, offset)
  }
  const a = await analyze(bytes, 73), b = await analyze(louder, 8192)
  assert.ok(Math.abs(10 * Math.log10(b.meanSquare / a.meanSquare) - 6.0206) < 0.0001)
  for (const size of sizes) for (let bin = 1; bin < size / 2; bin++)
    assert.ok(Math.abs(10 * Math.log10(b.curves[size][bin] / a.curves[size][bin]) - 6.0206) < 0.0001)
})

test('reference comparison primes at the measured level after startup and silence, without rising from the floor', () => {
  spectrum.setReferenceEnabled(true); spectrum.setSampleRate(48000); spectrum.setSmoothing(0.96)
  for (const size of sizes) {
    spectrum.setFFTSize(size); spectrum.reset()
    const hop = size / 4
    const samples = Float32Array.from({ length: hop }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 1500 * i / 48000))
    for (let repeat = 0; repeat < 2; repeat++) {
      for (let i = 0; i < 8; i++) spectrum.pushSamples(new Float32Array(hop))
      for (let i = 0; i < 3; i++) {
        spectrum.pushSamples(samples)
        assert.ok(spectrum.getMagnitudes().every(db => db <= -119.9), 'incomplete signal windows are not displayed')
      }
      spectrum.pushSamples(samples)
      const delta = spectrum.getMagnitudes()[1500 * size / 48000] + 20
      assert.ok(Math.abs(delta) < 0.01, `first full ${size} frame should equal the reference, got ${delta} dB`)
    }
  }
  spectrum.setReferenceEnabled(false)
})

test('live smoothing compares dynamic audio against imported power without a systematic negative offset', async () => {
  const bytes = wav(48000, 12)
  const samples = new Float32Array((bytes.length - 44) / 4)
  for (let i = 0; i < samples.length; i++) {
    const gain = Math.floor(i / 512) % 16 < 8 ? 0.1 : 0.001
    samples[i] = gain * Math.sin(2 * Math.PI * 1500 * i / 48000)
    bytes.writeFloatLE(samples[i], 44 + i * 4)
  }
  const reference = await analyze(bytes)
  const referenceDb = 10 * Math.log10(reference.curves[2048][64])
  spectrum.setReferenceEnabled(true); spectrum.setSampleRate(48000); spectrum.setFFTSize(2048); spectrum.setSmoothing(0.96); spectrum.reset()
  let delta = 0, frames = 0
  for (let i = 0; i < samples.length; i += 512) {
    spectrum.pushSamples(samples.subarray(i, i + 512))
    if (i >= 48000 * 2) { delta += spectrum.getMagnitudes()[64] - referenceDb; frames++ }
  }
  assert.ok(Math.abs(delta / frames) < 0.3, `same dynamic program should fluctuate around zero, got ${delta / frames} dB`)
  spectrum.setReferenceEnabled(false)
})
test('the bundled decoder reads AIFF, FLAC and MP3 fixtures', async () => {
  for (const format of ['aiff', 'flac', 'mp3']) {
    const result = await analyze(readFileSync(new URL(`./fixtures/reference-tone.${format}`, import.meta.url)))
    assert.ok(result.durationSeconds > 0.9)
    const db = 10 * Math.log10(result.curves[2048][64])
    assert.ok(Math.abs(db + 20) < (format === 'mp3' ? 0.6 : 0.1), `${format}: ${db}`)
  }
})

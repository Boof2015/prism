import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { lufsmeter } = require('../native/build/Release/visualizer_dsp.node')

const EBU_SAMPLE_RATE = 48000
const EBU_TOLERANCE_BELOW_DB = 0.4
const EBU_TOLERANCE_ABOVE_DB = 0.2
const SILENCE_DB = -60

function assertEbuTolerance(actual, expected, label) {
  assert.ok(
    actual >= expected - EBU_TOLERANCE_BELOW_DB
      && actual <= expected + EBU_TOLERANCE_ABOVE_DB,
    `${label}: expected ${expected} dBTP (+${EBU_TOLERANCE_ABOVE_DB}/-${EBU_TOLERANCE_BELOW_DB}), got ${actual}`,
  )
}

function createPhaseTone(
  sampleRate,
  frequency,
  amplitude,
  phaseDegrees,
  durationSeconds = 0.1,
) {
  const length = Math.max(1, Math.round(sampleRate * durationSeconds))
  const taperSamples = Math.max(1, Math.round(sampleRate * 0.01))
  const phaseRadians = phaseDegrees * Math.PI / 180
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const fadeIn = Math.min(1, index / taperSamples)
    const fadeOut = Math.min(1, (length - 1 - index) / taperSamples)
    const taper = Math.max(0, Math.min(fadeIn, fadeOut))
    samples[index] = amplitude
      * Math.sin((2 * Math.PI * frequency * index) / sampleRate + phaseRadians)
      * taper
  }
  return samples
}

function pushStereo(left, right = left, chunkSizes = null) {
  if (!chunkSizes) {
    lufsmeter.pushSamples(left, right)
    return
  }

  let offset = 0
  let chunkIndex = 0
  while (offset < Math.min(left.length, right.length)) {
    const requestedSize = chunkSizes[chunkIndex % chunkSizes.length]
    const length = Math.min(requestedSize, left.length - offset, right.length - offset)
    lufsmeter.pushSamples(
      left.subarray(offset, offset + length),
      right.subarray(offset, offset + length),
    )
    offset += length
    chunkIndex += 1
  }
}

function measure(sampleRate, left, right = left, chunkSizes = null) {
  lufsmeter.setSampleRate(sampleRate)
  lufsmeter.reset()
  pushStereo(left, right, chunkSizes)
  return lufsmeter.getSnapshot()
}

function besselI0(value) {
  let sum = 1
  let term = 1
  const squaredQuarter = value * value / 4
  for (let index = 1; index < 40; index += 1) {
    term *= squaredQuarter / (index * index)
    sum += term
    if (term < sum * 1e-15) break
  }
  return sum
}

function createTransientReferenceAt4x(sampleRate = EBU_SAMPLE_RATE) {
  const oversample = 4
  const highRate = sampleRate * oversample
  const durationSeconds = 0.12
  const length = Math.round(highRate * durationSeconds)
  const source = new Float64Array(length)
  const taperSamples = Math.round(highRate * 0.01)

  for (let index = 0; index < length; index += 1) {
    const taper = Math.max(0, Math.min(
      1,
      index / taperSamples,
      (length - 1 - index) / taperSamples,
    ))
    source[index] = 0.5 * Math.sin((2 * Math.PI * (sampleRate / 6) * index) / highRate) * taper
  }

  const transientStart = Math.floor(length / 2) - 8
  for (let index = 0; index < 16; index += 1) {
    source[transientStart + index] += Math.sin(Math.PI * index / 8)
  }

  const tapCount = 129
  const half = (tapCount - 1) / 2
  const cutoff = 0.5 / oversample
  const beta = 8.6
  const inverseI0Beta = 1 / besselI0(beta)
  const coefficients = new Float64Array(tapCount)
  let coefficientSum = 0
  for (let tap = 0; tap < tapCount; tap += 1) {
    const distance = tap - half
    const sincArgument = 2 * cutoff * distance
    const sinc = Math.abs(sincArgument) < 1e-12
      ? 1
      : Math.sin(Math.PI * sincArgument) / (Math.PI * sincArgument)
    const ratio = distance / half
    const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - ratio * ratio))) * inverseI0Beta
    coefficients[tap] = 2 * cutoff * sinc * window
    coefficientSum += coefficients[tap]
  }
  for (let tap = 0; tap < tapCount; tap += 1) coefficients[tap] /= coefficientSum

  const filtered = new Float64Array(length)
  for (let index = half; index < length - half; index += 1) {
    let value = 0
    for (let tap = 0; tap < tapCount; tap += 1) {
      value += coefficients[tap] * source[index + tap - half]
    }
    filtered[index] = value
  }

  let maximum = 0
  for (const value of filtered) maximum = Math.max(maximum, Math.abs(value))
  for (let index = 0; index < filtered.length; index += 1) filtered[index] /= maximum
  return filtered
}

function downsample4x(reference, offset) {
  const length = Math.floor((reference.length - offset) / 4)
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    samples[index] = reference[index * 4 + offset]
  }
  return samples
}

test('BS.1770 true peak passes EBU Tech 3341 phase-tone cases 15-19', () => {
  const cases = [
    { number: 15, divisor: 4, amplitude: 0.5, phase: 0, expected: -6 },
    { number: 16, divisor: 4, amplitude: 0.5, phase: 45, expected: -6 },
    { number: 17, divisor: 6, amplitude: 0.5, phase: 60, expected: -6 },
    { number: 18, divisor: 8, amplitude: 0.5, phase: 67.5, expected: -6 },
    { number: 19, divisor: 4, amplitude: 1.41, phase: 45, expected: 3 },
  ]

  for (const vector of cases) {
    const tone = createPhaseTone(
      EBU_SAMPLE_RATE,
      EBU_SAMPLE_RATE / vector.divisor,
      vector.amplitude,
      vector.phase,
    )
    const snapshot = measure(EBU_SAMPLE_RATE, tone)
    assertEbuTolerance(snapshot.maxTruePeakDb, vector.expected, `EBU case ${vector.number}`)
    assertEbuTolerance(snapshot.truePeakLDb, vector.expected, `EBU case ${vector.number} left marker`)
    assertEbuTolerance(snapshot.truePeakRDb, vector.expected, `EBU case ${vector.number} right marker`)
  }
})

test('BS.1770 true peak passes four phase offsets of a filtered transient (EBU cases 20-23)', () => {
  const reference = createTransientReferenceAt4x()
  for (let offset = 0; offset < 4; offset += 1) {
    const samples = downsample4x(reference, offset)
    const snapshot = measure(EBU_SAMPLE_RATE, samples)
    assertEbuTolerance(snapshot.maxTruePeakDb, 0, `EBU transient case ${20 + offset}`)
  }
})

test('true-peak state is independent of arbitrary audio chunk boundaries', () => {
  const tone = createPhaseTone(EBU_SAMPLE_RATE, EBU_SAMPLE_RATE / 4, 1.41, 45)
  const contiguous = measure(EBU_SAMPLE_RATE, tone).maxTruePeakDb
  const irregular = measure(EBU_SAMPLE_RATE, tone, tone, [1, 7, 113, 2, 509, 31]).maxTruePeakDb
  assert.ok(Math.abs(contiguous - irregular) < 1e-6, `${contiguous} vs ${irregular}`)
})

test('true peak supports common host rates with rate-aware oversampling', () => {
  for (const sampleRate of [44100, 48000, 96000, 192000]) {
    const tone = createPhaseTone(sampleRate, sampleRate / 4, 1.41, 45)
    const snapshot = measure(sampleRate, tone)
    assertEbuTolerance(snapshot.maxTruePeakDb, 3, `${sampleRate} Hz`)
  }
})

test('true-peak channels preserve polarity and remain independent', () => {
  const positive = createPhaseTone(EBU_SAMPLE_RATE, EBU_SAMPLE_RATE / 4, 1.41, 45)
  const negative = Float32Array.from(positive, (sample) => -sample)
  const silence = new Float32Array(positive.length)

  const positiveSnapshot = measure(EBU_SAMPLE_RATE, positive, silence)
  assertEbuTolerance(positiveSnapshot.truePeakLDb, 3, 'left channel')
  assert.equal(positiveSnapshot.truePeakRDb, SILENCE_DB)

  const negativeSnapshot = measure(EBU_SAMPLE_RATE, negative, silence)
  assert.ok(Math.abs(negativeSnapshot.truePeakLDb - positiveSnapshot.truePeakLDb) < 1e-6)
  assert.equal(negativeSnapshot.truePeakRDb, SILENCE_DB)
})

test('maximum true peak persists across quieter input and clears on reset', () => {
  const loud = createPhaseTone(EBU_SAMPLE_RATE, EBU_SAMPLE_RATE / 4, 1.41, 45)
  const quiet = createPhaseTone(EBU_SAMPLE_RATE, EBU_SAMPLE_RATE / 4, 0.1, 45)
  const silence = new Float32Array(1024)

  lufsmeter.setSampleRate(EBU_SAMPLE_RATE)
  lufsmeter.reset()
  pushStereo(loud)
  const loudSnapshot = lufsmeter.getSnapshot()
  assert.ok(loudSnapshot.maxTruePeakDb > 0)

  pushStereo(quiet)
  assert.equal(lufsmeter.getSnapshot().maxTruePeakDb, loudSnapshot.maxTruePeakDb)

  lufsmeter.reset()
  assert.deepEqual(
    {
      truePeakLDb: lufsmeter.getSnapshot().truePeakLDb,
      truePeakRDb: lufsmeter.getSnapshot().truePeakRDb,
      maxTruePeakDb: lufsmeter.getSnapshot().maxTruePeakDb,
    },
    { truePeakLDb: SILENCE_DB, truePeakRDb: SILENCE_DB, maxTruePeakDb: SILENCE_DB },
  )
  pushStereo(silence)
  assert.equal(lufsmeter.getSnapshot().maxTruePeakDb, SILENCE_DB)
})

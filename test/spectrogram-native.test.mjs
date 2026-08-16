import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { spectrogram } = require('../native/build/Release/visualizer_dsp.node')

const MIN_FREQUENCY = 20
const MAX_FREQUENCY = 20000
const CLASSIC_GAMMA = 1.4
const SHARPER_GAMMA = 1.1

function createTone(frequencyHz, sampleRate, length, amplitude = 1) {
  return Float32Array.from(
    { length },
    (_, index) => amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate),
  )
}

function createCompositeTone(tones, sampleRate, length) {
  return Float32Array.from(
    { length },
    (_, index) => tones.reduce((sample, tone) => (
      sample + tone.amplitude * Math.sin((2 * Math.PI * tone.frequencyHz * index) / sampleRate)
    ), 0),
  )
}

function configure(overrides = {}) {
  spectrogram.configure({
    fftSize: 4096,
    sampleRate: 48000,
    rowCount: 401,
    minFrequency: MIN_FREQUENCY,
    maxFrequency: MAX_FREQUENCY,
    minDecibels: -100,
    maxDecibels: 0,
    scrollSpeed: 2,
    contrast: 1,
    tiltDbPerOctave: 0,
    clarityMode: 'classic',
    scaleMode: 'log',
    orientation: 'horizontal',
    ...overrides,
  })
  spectrogram.reset()
}

function hzToMelSlaney(frequencyHz) {
  const linearSpacing = 200 / 3
  const minimumLogMel = 1000 / linearSpacing
  const logStep = Math.log(6.4) / 27
  return frequencyHz < 1000
    ? frequencyHz / linearSpacing
    : minimumLogMel + Math.log(frequencyHz / 1000) / logStep
}

function expectedNormalizedPosition(frequencyHz, scaleMode, minFrequency, maxFrequency) {
  if (scaleMode === 'linear') {
    return (frequencyHz - minFrequency) / (maxFrequency - minFrequency)
  }
  if (scaleMode === 'mel') {
    const melMin = hzToMelSlaney(minFrequency)
    const melMax = hzToMelSlaney(maxFrequency)
    return (hzToMelSlaney(frequencyHz) - melMin) / (melMax - melMin)
  }
  return Math.log10(frequencyHz / minFrequency) / Math.log10(maxFrequency / minFrequency)
}

function findPeakRow(values) {
  let peakRow = 0
  for (let row = 1; row < values.length; row += 1) {
    if (values[row] > values[peakRow]) peakRow = row
  }
  return peakRow
}

function decodeClassicDisplayDb(value, minDecibels, maxDecibels) {
  const normalized = Math.pow(value, 1 / CLASSIC_GAMMA)
  return minDecibels + normalized * (maxDecibels - minDecibels)
}

function decodeSharperDisplayDb(value, gamma, minDecibels, maxDecibels) {
  const normalized = Math.pow(value, 1 / gamma)
  return minDecibels + normalized * (maxDecibels - minDecibels)
}

function finalColumn(result) {
  const offset = (result.columnCount - 1) * result.rowCount
  return result.display.subarray(offset, offset + result.rowCount)
}

function localPeak(values, centerRow, radius = 2) {
  let peak = 0
  for (
    let row = Math.max(0, Math.round(centerRow) - radius);
    row <= Math.min(values.length - 1, Math.round(centerRow) + radius);
    row += 1
  ) {
    peak = Math.max(peak, values[row])
  }
  return peak
}

function assertAlmostEqual(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  )
}

test('spectrogram places tones accurately on log, mel, and linear axes', () => {
  const rowCount = 401
  const configurations = [
    { sampleRate: 44100, fftSize: 2048 },
    { sampleRate: 48000, fftSize: 4096 },
    { sampleRate: 96000, fftSize: 8192 },
  ]
  const frequencies = [55, 440, 1000, 5234.5, 15000, 19777]
  const amplitudes = [0.001, 0.1]

  for (const { sampleRate, fftSize } of configurations) {
    const maximum = Math.min(MAX_FREQUENCY, sampleRate / 2)
    for (const scaleMode of ['log', 'mel', 'linear']) {
      for (const frequencyHz of frequencies) {
        if (frequencyHz > maximum) continue
        for (const amplitude of amplitudes) {
          configure({ sampleRate, fftSize, rowCount, scaleMode })
          const result = spectrogram.process(createTone(frequencyHz, sampleRate, fftSize, amplitude))
          const peakRow = findPeakRow(result.display)
          const expectedRow = (
            1 - expectedNormalizedPosition(frequencyHz, scaleMode, MIN_FREQUENCY, maximum)
          ) * (rowCount - 1)

          assert.equal(result.columnCount, 1)
          assert.ok(result.display[peakRow] > 0.05, `${scaleMode} ${frequencyHz}Hz should remain visible`)
          assertAlmostEqual(
            peakRow,
            expectedRow,
            1,
            `${scaleMode} ${frequencyHz}Hz at ${sampleRate}Hz / FFT ${fftSize}, amplitude ${amplitude}`,
          )
        }
      }
    }
  }
})

test('spectrogram log rows retain narrow high-frequency tones between row centers', () => {
  configure({ scaleMode: 'log', rowCount: 401 })
  const result = spectrogram.process(createTone(15000, 48000, 4096, 0.01))
  const peakRow = findPeakRow(result.display)
  const expectedRow = (
    1 - expectedNormalizedPosition(15000, 'log', MIN_FREQUENCY, MAX_FREQUENCY)
  ) * 400

  assert.ok(result.display[peakRow] > 0.3)
  assertAlmostEqual(peakRow, expectedRow, 1, '15kHz log-axis regression')
})

test('spectrogram Hann normalization reports calibrated tone levels', () => {
  const minDecibels = -120
  const maxDecibels = 12

  for (const fftSize of [1024, 4096, 8192]) {
    for (const binPosition of [37, 37.37]) {
      const frequencyHz = binPosition * 48000 / fftSize
      for (const amplitude of [1, 0.5, 0.1]) {
        configure({ fftSize, rowCount: 1, minDecibels, maxDecibels })
        const result = spectrogram.process(createTone(frequencyHz, 48000, fftSize, amplitude))
        const measuredDbfs = decodeClassicDisplayDb(result.display[0], minDecibels, maxDecibels)
        assertAlmostEqual(
          measuredDbfs,
          20 * Math.log10(amplitude),
          0.3,
          `amplitude ${amplitude} at FFT ${fftSize}, bin ${binPosition}`,
        )
      }
    }
  }

  configure({ fftSize: 4096, rowCount: 1, minDecibels, maxDecibels })
  const silence = spectrogram.process(new Float32Array(4096))
  assert.equal(silence.display[0], 0)
  assert.ok(silence.display.every(Number.isFinite))
  assert.ok(silence.heat.every(Number.isFinite))
})

test('spectrogram Sharper conserves calibrated power while frequency-reassigning every visible bin', () => {
  const sampleRate = 48000
  const minDecibels = -120
  const maxDecibels = 12

  for (const fftSize of [1024, 4096, 8192]) {
    const hopSize = fftSize / 16
    for (const binPosition of [37, 37.37]) {
      const frequencyHz = binPosition * sampleRate / fftSize
      for (const amplitude of [0.5, 0.1]) {
        configure({
          fftSize,
          sampleRate,
          rowCount: 1,
          minDecibels,
          maxDecibels,
          clarityMode: 'sharper',
        })
        const result = spectrogram.process(createTone(
          frequencyHz,
          sampleRate,
          fftSize + hopSize,
          amplitude,
        ))
        const measuredDbfs = decodeSharperDisplayDb(
          finalColumn(result)[0],
          SHARPER_GAMMA,
          minDecibels,
          maxDecibels,
        )
        assertAlmostEqual(
          measuredDbfs,
          20 * Math.log10(amplitude),
          0.3,
          `Sharper amplitude ${amplitude} at FFT ${fftSize}, bin ${binPosition}`,
        )
      }
    }
  }
})

test('spectrogram Sharper keeps reassigned tones on the correct Log, Mel, and Linear rows', () => {
  const rowCount = 601
  for (const { sampleRate, fftSize } of [
    { sampleRate: 44100, fftSize: 2048 },
    { sampleRate: 48000, fftSize: 4096 },
    { sampleRate: 96000, fftSize: 8192 },
  ]) {
    const hopSize = fftSize / 16
    const maximum = Math.min(MAX_FREQUENCY, sampleRate / 2)
    for (const scaleMode of ['log', 'mel', 'linear']) {
      for (const frequencyHz of [440, 5234.5, 15000]) {
        configure({ sampleRate, fftSize, rowCount, scaleMode, clarityMode: 'sharper' })
        const result = spectrogram.process(createTone(
          frequencyHz,
          sampleRate,
          fftSize + hopSize,
          0.01,
        ))
        const peakRow = findPeakRow(finalColumn(result))
        const expectedRow = (
          1 - expectedNormalizedPosition(frequencyHz, scaleMode, MIN_FREQUENCY, maximum)
        ) * (rowCount - 1)
        assertAlmostEqual(
          peakRow,
          expectedRow,
          1,
          `Sharper ${scaleMode} ${frequencyHz}Hz at ${sampleRate}Hz / FFT ${fftSize}`,
        )
      }
    }
  }
})

test('spectrogram Sharper resolves quiet nearby detail without retaining the Classic blob', () => {
  const sampleRate = 48000
  const fftSize = 4096
  const rowCount = 801
  const hopSize = fftSize / 16
  const strongFrequencyHz = 1000
  const quietFrequencyHz = 1120
  const strongOnly = [{ frequencyHz: strongFrequencyHz, amplitude: 1 }]
  const withQuietDetail = [...strongOnly, { frequencyHz: quietFrequencyHz, amplitude: 0.01 }]

  const renderFinalColumn = (clarityMode, tones) => {
    configure({ fftSize, sampleRate, rowCount, clarityMode })
    return finalColumn(spectrogram.process(createCompositeTone(
      tones,
      sampleRate,
      fftSize + hopSize,
    )))
  }

  const classicTone = renderFinalColumn('classic', strongOnly)
  const sharperTone = renderFinalColumn('sharper', strongOnly)
  const classicHalfHeightRows = classicTone.filter((value) => value >= Math.max(...classicTone) * 0.5).length
  const sharperHalfHeightRows = sharperTone.filter((value) => value >= Math.max(...sharperTone) * 0.5).length
  assert.ok(sharperHalfHeightRows <= 3, `expected a narrow Sharper line, got ${sharperHalfHeightRows} rows`)
  assert.ok(sharperHalfHeightRows < classicHalfHeightRows)

  const detailed = renderFinalColumn('sharper', withQuietDetail)
  const quietRow = (
    1 - expectedNormalizedPosition(quietFrequencyHz, 'log', MIN_FREQUENCY, MAX_FREQUENCY)
  ) * (rowCount - 1)
  const quietDisplay = localPeak(detailed, quietRow)
  const quietDbfs = decodeSharperDisplayDb(quietDisplay, SHARPER_GAMMA, -100, 0)
  assertAlmostEqual(quietDbfs, -40, 2, 'quiet detail beside a full-scale tone')
})

test('spectrogram Focused restores the former sparse peak-isolation profile', () => {
  const sampleRate = 48000
  const fftSize = 4096
  const rowCount = 801
  const hopSize = fftSize / 16
  let noiseState = 7
  const signal = Float32Array.from({ length: fftSize + hopSize }, (_, index) => {
    noiseState = ((noiseState * 1664525) + 1013904223) >>> 0
    const noise = (((noiseState / 0x100000000) * 2) - 1) * 0.03
    return (
      (0.55 * Math.sin((2 * Math.PI * 220 * index) / sampleRate))
      + (0.3 * Math.sin((2 * Math.PI * 440.3 * index) / sampleRate))
      + (0.15 * Math.sin((2 * Math.PI * 997 * index) / sampleRate))
      + noise
    )
  })

  const render = (clarityMode) => {
    configure({ fftSize, sampleRate, rowCount, clarityMode })
    return finalColumn(spectrogram.process(signal))
  }
  const focused = render('focused')
  const sharper = render('sharper')
  const focusedActiveRows = Array.from(focused).filter((value) => value > 0.1).length
  const sharperActiveRows = Array.from(sharper).filter((value) => value > 0.1).length

  assert.ok(Math.max(...focused) > 0.5, 'Focused should retain strong spectral peaks')
  assert.ok(
    focusedActiveRows < sharperActiveRows * 0.6,
    `Focused should isolate peaks (${focusedActiveRows} active rows vs ${sharperActiveRows} in Sharper)`,
  )
})

test('spectrogram combines stereo energy without dropping anti-phase content', () => {
  assert.equal(typeof spectrogram.processStereo, 'function')
  const fftSize = 4096
  const minDecibels = -120
  const maxDecibels = 12
  const amplitude = 0.5
  const frequencyHz = 83 * 48000 / fftSize
  const tone = createTone(frequencyHz, 48000, fftSize, amplitude)
  const invertedTone = Float32Array.from(tone, (sample) => -sample)
  const silence = new Float32Array(fftSize)
  const expectedStereoDbfs = 20 * Math.log10(amplitude)

  for (const [label, left, right, expectedDbfs] of [
    ['centered', tone, tone, expectedStereoDbfs],
    ['anti-phase', tone, invertedTone, expectedStereoDbfs],
    ['left-only', tone, silence, expectedStereoDbfs - (20 * Math.log10(Math.sqrt(2)))],
  ]) {
    configure({ fftSize, rowCount: 1, minDecibels, maxDecibels })
    const result = spectrogram.processStereo(left, right)
    const measuredDbfs = decodeClassicDisplayDb(result.display[0], minDecibels, maxDecibels)
    assertAlmostEqual(measuredDbfs, expectedDbfs, 0.3, `${label} stereo level`)
  }
})

test('spectrogram clamps its frequency mapping to Nyquist', () => {
  const sampleRate = 32000
  const fftSize = 4096
  const rowCount = 401
  const frequencyHz = 15000
  const nyquist = sampleRate / 2
  configure({ sampleRate, fftSize, rowCount, maxFrequency: MAX_FREQUENCY, scaleMode: 'log' })

  const result = spectrogram.process(createTone(frequencyHz, sampleRate, fftSize, 0.01))
  const peakRow = findPeakRow(result.display)
  const expectedRow = (
    1 - expectedNormalizedPosition(frequencyHz, 'log', MIN_FREQUENCY, nyquist)
  ) * (rowCount - 1)

  assertAlmostEqual(peakRow, expectedRow, 1, 'Nyquist-clamped row')
})

test('spectrogram scroll speeds produce the expected analysis hop counts through x8', () => {
  const fftSize = 1024
  const extraSamples = 512
  for (const scrollSpeed of [1, 2, 4, 8]) {
    configure({ fftSize, rowCount: 8, scrollSpeed })
    const result = spectrogram.process(new Float32Array(fftSize + extraSamples))
    const hopSize = fftSize / Math.round(8 * scrollSpeed)
    const expectedColumns = 1 + Math.floor(extraSamples / hopSize)
    assert.equal(result.columnCount, expectedColumns, `x${scrollSpeed} column count`)
    assert.equal(result.display.length, expectedColumns * 8)
    assert.equal(result.heat.length, expectedColumns * 8)
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ReferenceTrackJobs, type NativeReferenceAnalysis, type NativeReferenceCurve } from '../src/main/referenceTrackJobs'
import { REFERENCE_FFT_SIZES, encodeReferencePower, decodeReferencePower, normalizeReferenceAsset,
  normalizeSpectrumReference, referenceMatchTrim, type SpectrumReferenceAsset } from '../src/types/spectrumReference'
import { createDefaultProfile, normalizeProfileFile, profileToFileData } from '../src/shared/profileState'
import { referenceDbAt, differenceReferenceBins, ReferenceCurveTransition } from '../src/renderer/visualizers/referenceCurve'

function nativeCurve(): NativeReferenceCurve {
  return { sourceNyquistHz: 22050, durationSeconds: 3, meanSquare: 0.01,
    curves: Object.fromEntries(REFERENCE_FFT_SIZES.map(size => [size, new Float32Array(size / 2).fill(0.01)])) }
}
function asset(): SpectrumReferenceAsset {
  const curve = nativeCurve()
  return { version: 1, id: 'reference-one', name: 'My reference.wav', sampleRate: 48000,
    ...curve, curves: Object.fromEntries(REFERENCE_FFT_SIZES.map(size => [size, encodeReferencePower(curve.curves[size])])) as SpectrumReferenceAsset['curves'] }
}

test('portable reference curves validate exact dimensions, numeric values and metadata', () => {
  const ref = asset()
  assert.ok(normalizeReferenceAsset(ref))
  assert.equal(decodeReferencePower(ref.curves[1024], 1024)?.length, 512)
  assert.equal(normalizeReferenceAsset({ ...ref, sampleRate: 44100 }), null)
  assert.equal(normalizeReferenceAsset({ ...ref, meanSquare: Infinity }), null)
  assert.equal(normalizeReferenceAsset({ ...ref, curves: { ...ref.curves, 1024: ref.curves[2048] } }), null)
  const invalid = new Float32Array(512).fill(0.01); invalid[23] = NaN
  assert.equal(decodeReferencePower(encodeReferencePower(invalid), 1024), null)
  invalid[23] = -1
  assert.equal(decodeReferencePower(encodeReferencePower(invalid), 1024), null)
  assert.equal(normalizeSpectrumReference({ asset: ref, trimDb: 120, view: 'unknown' })?.trimDb, 24)
  assert.equal(normalizeSpectrumReference({ asset: ref, trimDb: 0, view: 'unknown' })?.view, 'overlay')
})

test('reference survives profile serialization without an audio path; legacy v6 stays empty', () => {
  const profile = createDefaultProfile()
  profile.scopeSettings.spectrum.reference = { asset: asset(), trimDb: -6.2, view: 'difference' }
  const file = profileToFileData('one', profile)
  assert.equal(file.version, 7)
  const restored = normalizeProfileFile(JSON.parse(JSON.stringify(file)), 'one')
  assert.deepEqual(restored.scopeSettings.spectrum.reference, profile.scopeSettings.spectrum.reference)
  assert.equal(JSON.stringify(file).includes('sourcePath'), false)
  const old = normalizeProfileFile({ ...file, version: 6, scopeSettings: { spectrum: { fftSize: 4096 } } }, 'old')
  assert.equal(old.scopeSettings.spectrum.reference, null)
})

test('level match has the right sign, rounds trim and excludes silence/stale or short windows', () => {
  assert.equal(referenceMatchTrim(0.04, { meanSquare: 0.01, seconds: 3 }), -6)
  assert.equal(referenceMatchTrim(0.01, { meanSquare: 0.04, seconds: 1 }), 6)
  assert.equal(referenceMatchTrim(0.01, { meanSquare: 1e-4, seconds: 0.9 }), null)
  assert.equal(referenceMatchTrim(0.01, { meanSquare: 0, seconds: 3 }), null)
  assert.equal(referenceMatchTrim(0, { meanSquare: 0.01, seconds: 3 }), null)
  assert.equal(referenceMatchTrim(1e-6, { meanSquare: 1, seconds: 3 }), 24)
})

test('reference projection preserves absolute levels and masks unsupported source frequencies', () => {
  const reference = asset()
  for (const fft of REFERENCE_FFT_SIZES) assert.ok(Math.abs(referenceDbAt(reference, fft, 1000)! + 20) < 0.0001)
  assert.equal(referenceDbAt(reference, 2048, 23000), null)
  const transition = new ReferenceCurveTransition()
  const start = new Float32Array([-30, -40]), end = new Float32Array([-10, -20])
  transition.sample(start, 0, false)
  assert.deepEqual([...transition.sample(end, 100, false)], [-30, -40])
  const partial = [...transition.sample(end, 200, false)]
  assert.ok(partial[0] > -30 && partial[0] < -10)
  assert.deepEqual([...transition.sample(end, 300, false)], [-10, -20])
  assert.deepEqual([...transition.sample(start, 400, true)], [-30, -40])
  assert.deepEqual([...start], [-30, -40])
})

test('Difference subtracts power-derived dB at each bin before projection and clipping', () => {
  const reference = asset()
  const power = new Float32Array(512).fill(1e-10)
  power[1] = 1e-2; power[2] = 1e-4; power[3] = 0
  reference.curves[1024] = encodeReferencePower(power)
  const live = new Float32Array(512).fill(-110)
  live[1] = -30; live[2] = -30; live[3] = -30
  const result = differenceReferenceBins(live, reference, 1024, -6)
  assert.ok(Math.abs(result[0] + 4) < 0.0001)
  assert.ok(Math.abs(result[1] + 4) < 0.0001)
  assert.ok(Math.abs(result[2] - 16) < 0.0001)
  assert.ok(Number.isNaN(result[3]))
  assert.ok(Number.isNaN(result[500]))
  assert.equal(live[2], -30)
})

test('desktop jobs ignore late progress and completions after replacement or cancellation', () => {
  const callbacks: { progress: Parameters<NativeReferenceAnalysis['start']>[1]; done: Parameters<NativeReferenceAnalysis['start']>[2] }[] = []
  const cancelled: number[] = []
  const native: NativeReferenceAnalysis = {
    start: (_path, progress, done) => { callbacks.push({ progress, done }); return callbacks.length },
    cancel: id => { cancelled.push(id) },
  }
  const jobs = new ReferenceTrackJobs(() => native, () => {})
  jobs.start('/tmp/first.wav')
  jobs.start('/tmp/second.wav')
  assert.deepEqual(cancelled, [1])
  callbacks[0].progress(0.5, nativeCurve()); callbacks[0].done(null, nativeCurve())
  assert.equal(jobs.getState().name, 'second.wav')
  assert.equal(jobs.getState().phase, 'opening')
  callbacks[1].progress(0.5, nativeCurve())
  assert.equal(jobs.getState().phase, 'analyzing')
  assert.equal(jobs.getState().result, null)
  callbacks[1].done(null, nativeCurve())
  assert.equal(jobs.getState().phase, 'ready')
  callbacks[1].progress(0.8, nativeCurve())
  assert.equal(jobs.getState().phase, 'ready')
  jobs.cancel()
  callbacks[1].done(null, nativeCurve())
  assert.equal(jobs.getState().phase, 'idle')
})

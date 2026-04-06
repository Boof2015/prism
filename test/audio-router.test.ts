import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioRouter } from '../src/renderer/audio/AudioRouter'

function createChunk(value: number, length = 4): Float32Array {
  return new Float32Array(Array.from({ length }, () => value))
}

test('routes chunks only to demanded scopes and prunes queues when demand is removed', () => {
  const router = new AudioRouter()
  const sessionId = router.beginSession(48000, 2, 'native-macos')

  router.ingestChunk(createChunk(1), createChunk(1), {
    sessionId,
    channelCount: 2,
    sequence: 1,
    capturedAt: performance.now() - 5,
  })
  assert.equal(router.flushPendingSpectrumSamples().length, 0)
  assert.equal(router.getDiagnosticsSnapshot().undemandedChunks, 1)

  router.setVisualizerConsumerDemand('test-consumer', { spectrum: true, waveform: true })
  router.ingestChunk(createChunk(2), createChunk(4), {
    sessionId,
    channelCount: 2,
    sequence: 2,
    capturedAt: performance.now() - 5,
  })

  const spectrumChunks = router.flushPendingSpectrumSamples()
  const waveformChunks = router.flushPendingWaveformSamples()
  const oscilloscopeChunks = router.flushPendingOscilloscopeSamples()

  assert.equal(spectrumChunks.length, 1)
  assert.equal(waveformChunks.length, 1)
  assert.equal(oscilloscopeChunks.length, 0)
  assert.deepEqual(Array.from(spectrumChunks[0]), [3, 3, 3, 3])
  assert.deepEqual(Array.from(waveformChunks[0]), [2, 2, 2, 2])

  router.ingestChunk(createChunk(7), createChunk(9), {
    sessionId,
    channelCount: 2,
    sequence: 3,
    capturedAt: performance.now() - 5,
  })
  router.clearVisualizerConsumerDemand('test-consumer')

  assert.equal(router.flushPendingSpectrumSamples().length, 0)
  assert.equal(router.flushPendingWaveformSamples().length, 0)
  assert.equal(router.flushPendingWaveformStereoSamples().length, 0)
})

test('spectrum keeps stereo chunks for the side overlay path and still exposes mono downmixes', () => {
  const router = new AudioRouter()
  const sessionId = router.beginSession(48000, 2, 'native-macos')
  router.setVisualizerConsumerDemand('test-consumer', { spectrum: true })

  router.ingestChunk(createChunk(2), createChunk(4), {
    sessionId,
    channelCount: 2,
    sequence: 1,
    capturedAt: performance.now() - 5,
  })

  const stereoChunks = router.flushPendingSpectrumStereoSamples()
  assert.equal(stereoChunks.length, 1)
  assert.deepEqual(Array.from(stereoChunks[0]?.left ?? []), [2, 2, 2, 2])
  assert.deepEqual(Array.from(stereoChunks[0]?.right ?? []), [4, 4, 4, 4])
  assert.equal(router.flushPendingSpectrumSamples().length, 0)

  router.ingestChunk(createChunk(6), createChunk(10), {
    sessionId,
    channelCount: 2,
    sequence: 2,
    capturedAt: performance.now() - 5,
  })

  const monoChunks = router.flushPendingSpectrumSamples()
  assert.equal(monoChunks.length, 1)
  assert.deepEqual(Array.from(monoChunks[0] ?? []), [8, 8, 8, 8])
  assert.equal(router.flushPendingSpectrumStereoSamples().length, 0)
})

test('waveform keeps stereo chunks for stereo mode while mono flushes still expose the left channel', () => {
  const router = new AudioRouter()
  const sessionId = router.beginSession(48000, 2, 'native-macos')
  router.setVisualizerConsumerDemand('test-consumer', { waveform: true })

  router.ingestChunk(createChunk(2), createChunk(4), {
    sessionId,
    channelCount: 2,
    sequence: 1,
    capturedAt: performance.now() - 5,
  })

  const stereoChunks = router.flushPendingWaveformStereoSamples()
  assert.equal(stereoChunks.length, 1)
  assert.deepEqual(Array.from(stereoChunks[0]?.left ?? []), [2, 2, 2, 2])
  assert.deepEqual(Array.from(stereoChunks[0]?.right ?? []), [4, 4, 4, 4])
  assert.equal(router.flushPendingWaveformSamples().length, 0)

  router.ingestChunk(createChunk(6), createChunk(10), {
    sessionId,
    channelCount: 2,
    sequence: 2,
    capturedAt: performance.now() - 5,
  })

  const monoChunks = router.flushPendingWaveformSamples()
  assert.equal(monoChunks.length, 1)
  assert.deepEqual(Array.from(monoChunks[0] ?? []), [6, 6, 6, 6])
  assert.equal(router.flushPendingWaveformStereoSamples().length, 0)
})

test('keeps the newest chunks when a fixed-capacity ring overflows', () => {
  const router = new AudioRouter()
  const sessionId = router.beginSession(48000, 2, 'native-macos')
  router.setVisualizerConsumerDemand('test-consumer', { oscilloscope: true })

  for (let sequence = 1; sequence <= 25; sequence += 1) {
    router.ingestChunk(createChunk(sequence), createChunk(sequence), {
      sessionId,
      channelCount: 2,
      sequence,
      capturedAt: performance.now() - 2,
    })
  }

  const oscilloscopeChunks = router.flushPendingOscilloscopeSamples()
  assert.equal(oscilloscopeChunks.length, 20)
  assert.equal(oscilloscopeChunks[0]?.[0], 6)
  assert.equal(oscilloscopeChunks[19]?.[0], 25)

  const diagnostics = router.getDiagnosticsSnapshot()
  assert.equal(diagnostics.scopes.oscilloscope.overwriteCount, 5)
  assert.ok((diagnostics.scopes.oscilloscope.p95CaptureToScopeMs ?? 0) >= 0)
})

test('drops stale-session chunks before they reach scope queues', () => {
  const router = new AudioRouter()
  const sessionId = router.beginSession(48000, 1, 'device-input')
  router.setVisualizerConsumerDemand('test-consumer', { vumeter: true })

  router.ingestChunk(createChunk(1), createChunk(1), {
    sessionId: sessionId + 1,
    channelCount: 1,
    sequence: 1,
    capturedAt: performance.now() - 1,
  })

  assert.equal(router.flushPendingVUMeterSamples().length, 0)
  assert.equal(router.getDiagnosticsSnapshot().staleSessionDrops, 1)
})

test('publishes aggregated visualizer demand changes for downstream transports', () => {
  const router = new AudioRouter()
  const snapshots: Array<ReturnType<AudioRouter['getActiveVisualizerDemand']>> = []

  const unsubscribe = router.subscribeToDemandChanges((demand) => {
    snapshots.push({ ...demand })
  })

  router.setVisualizerConsumerDemand('docked-strip', { spectrum: true, oscilloscope: true })
  router.setVisualizerConsumerDemand('popout:vectorscope', { vectorscope: true })
  router.clearVisualizerConsumerDemand('docked-strip')
  unsubscribe()

  assert.deepEqual(snapshots[0], {
    spectrum: false,
    oscilloscope: false,
    vectorscope: false,
    spectrogram: false,
    vumeter: false,
    lufsmeter: false,
    waveform: false,
  })
  assert.deepEqual(snapshots[1], {
    spectrum: true,
    oscilloscope: true,
    vectorscope: false,
    spectrogram: false,
    vumeter: false,
    lufsmeter: false,
    waveform: false,
  })
  assert.deepEqual(snapshots[2], {
    spectrum: true,
    oscilloscope: true,
    vectorscope: true,
    spectrogram: false,
    vumeter: false,
    lufsmeter: false,
    waveform: false,
  })
  assert.deepEqual(snapshots[3], {
    spectrum: false,
    oscilloscope: false,
    vectorscope: true,
    spectrogram: false,
    vumeter: false,
    lufsmeter: false,
    waveform: false,
  })
})

test('audio diagnostics stay scoped to audio-only visualizers', () => {
  const router = new AudioRouter()

  assert.equal('astra' in router.getDiagnosticsSnapshot().scopes, false)
})

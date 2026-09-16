import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioRouter } from '../src/renderer/audio/AudioRouter'
import { VisualizerFrameLoop } from '../src/renderer/visualizers/visualizerFrameLoop'
import type { FrameScheduler } from '../src/renderer/visualizers/frameScheduler'
import { latencyProbe } from '../src/renderer/benchmark/latencyProbe'

test('real router drains bind to the active visualizer frame without modifying samples', () => {
  const probe = latencyProbe!
  const router = new AudioRouter()
  const session = router.beginSession(48000, 2, 'native-macos')
  router.setVisualizerConsumerDemand('bench-test', { spectrum: true })
  const callbacks = new Set<() => void>()
  const scheduler = { subscribe(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback) } } as FrameScheduler
  const left = Float32Array.of(0.5, 0.25), right = Float32Array.of(-0.5, -0.25)
  let observed: ReturnType<AudioRouter['flushPendingSpectrumStereoSamples']> = []
  const loop = new VisualizerFrameLoop({ frameScheduler: scheduler, benchmarkScope: 'spectrum', shouldRun: () => true,
    onFrame: () => { observed = router.flushPendingSpectrumStereoSamples(); probe.drawn() } })
  probe.start('probe', session)
  probe.receipt(4, 100, 2, 0.5)
  router.ingestChunk(left, right, { sessionId: session, sequence: 4, capturedAt: 100 })
  loop.start()
  for (const cb of callbacks) cb()
  assert.equal(observed[0].left, left)
  assert.equal(observed[0].right, right)
  for (const cb of callbacks) cb()
  loop.dispose(); probe.stop()
  const raw = probe.export()
  assert.equal(raw.records.length, 1)
  assert.equal(raw.records[0][1], 4)
  assert.equal(raw.records[0][8], 1)
  assert.equal(raw.frames.length, 2)
  assert.equal(callbacks.size, 0)
})

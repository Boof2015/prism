import test from 'node:test'
import assert from 'node:assert/strict'
import { LatencyProbe, clockBounds, calibrateClock, percentile } from '../src/renderer/benchmark/latencyProbe'
import { analyzeMeasurement, type RawMeasurement } from '../src/renderer/benchmark/analyze'

const calibration = [{ before: 0, native: 1000, after: 0.2 }]
function fixture(capacity = 100) {
  let time = 0
  const probe = new LatencyProbe(capacity, () => time)
  probe.start('probe', 7)
  return { probe, at: (t: number) => { time = t } }
}
function raw(probe: LatencyProbe): RawMeasurement {
  const router = { totalOverwriteCount: 0, scopes: { spectrum: { queuedChunks: 0 } } } as RawMeasurement['routerStart']
  return { ...probe.export(), clockStart: calibration, clockEnd: calibration, hiddenEvents: 0,
    routerStart: router, routerEnd: router, metadata: { hidden: false, visibleScopes: ['spectrum'],
      capture: { activeBackendKind: 'native-macos', isCapturing: true } } }
}
test('clock calibration brackets calls and retains drift as uncertainty', () => {
  let clock = 0
  const samples = calibrateClock(() => 1000, () => clock++, 2)
  assert.deepEqual(samples, [{ before: 0, native: 1000, after: 1 }, { before: 2, native: 1000, after: 3 }])
  const bounds = clockBounds([{ before: 1, native: 1000, after: 9 }, ...calibration], [{ before: 100, native: 1099, after: 100.2 }])
  assert.equal(bounds.low, -1000)
  assert.ok(Math.abs(bounds.high + 998.8) < 1e-9)
  assert.ok(Math.abs(bounds.uncertaintyMs - 0.6) < 1e-9)
  assert.throws(() => clockBounds([], calibration))
})
test('multiple chunks retain their own capture ages and exact frame association', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(1, 1001, 128, 0.02)
  at(4); probe.receipt(2, 1002, 256, 0.03)
  at(8); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.consume('spectrum', 2)
  probe.drawn(); at(10); probe.endFrame()
  at(20); probe.beginFrame('spectrum'); probe.drawn(); at(21); probe.endFrame()
  probe.stop()
  const data = raw(probe), summary = analyzeMeasurement(data)
  assert.equal(data.records.length, 2, 'redrawing without new audio must not add samples')
  assert.equal(data.records[0][3], data.records[1][3])
  assert.equal(data.records[0][9], 128)
  assert.equal(summary.scopes[0].latencyMs.count, 2)
  assert.ok(Math.abs(summary.scopes[0].latencyMs.p95! - 8.9) < 1e-8)
  assert.equal(summary.scopes[0].upperLatencyMs.p95, 9)
  assert.equal(summary.valid, true)
})
test('skipped frames are not reported as successful low latency', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(1, 1001, 128, 0.02)
  at(4); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.endFrame(); probe.stop()
  const result = analyzeMeasurement(raw(probe))
  assert.equal(result.scopes[0].skippedChunks, 1)
  assert.equal(result.scopes[0].latencyMs.count, 0)
  assert.equal(result.valid, false)
})
test('negative clock ordering is invalid, never clamped into a fast result', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(1, 1100, 128, 0.02)
  at(4); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); probe.endFrame(); probe.stop()
  const result = analyzeMeasurement(raw(probe))
  assert.equal(result.scopes[0].invalid, 1)
  assert.equal(result.scopes[0].latencyMs.count, 0)
})
test('same sequence from a new session cannot use old receipt metadata', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(1, 1001, 128, 0.02)
  probe.sessionChanged(8)
  at(4); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); probe.endFrame(); probe.stop()
  assert.equal(probe.export().counters.sessionChanges, 1)
  assert.equal(probe.export().records[0][8], -1)
  assert.equal(analyzeMeasurement(raw(probe)).valid, false)
})
test('native drops, trimming, sequence gaps and metadata loss are explicit', () => {
  const { probe, at } = fixture()
  probe.nativeDrain(2, 3, 1)
  at(3); probe.receipt(1, 1001, 128, 0.02); probe.receipt(4, 1002, 128, 0.02)
  probe.beginFrame('spectrum'); probe.consume('spectrum', 3); probe.endFrame(); probe.stop()
  const counters = probe.export().counters
  assert.equal(counters.nativeOverwrites, 2)
  assert.equal(counters.sequenceGaps, 2)
  assert.equal(counters.trimmedChunks, 1)
  assert.equal(counters.missingReceipts, 1)
})
test('pre-existing boundary chunks are excluded explicitly, pending tail remains censored', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(10, 1001, 128, 0.02)
  probe.beginFrame('spectrum'); probe.consume('spectrum', 9); probe.consume('spectrum', 10); probe.drawn(); probe.endFrame()
  at(5); probe.receipt(11, 1004, 128, 0.02)
  at(6); probe.beginFrame('spectrum'); probe.drawn(); probe.endFrame(); probe.stop()
  const data = raw(probe)
  data.routerEnd = { ...data.routerEnd, scopes: { ...data.routerEnd.scopes, spectrum: { ...data.routerEnd.scopes.spectrum, queuedChunks: 1 } } }
  const result = analyzeMeasurement(data)
  assert.equal(result.counters.boundaryChunks, 1)
  assert.equal(result.scopes[0].latencyMs.count, 1)
  assert.equal(result.scopes[0].unconsumedAtStop, 1)
  assert.equal(result.valid, true)
})
test('baseline observes frames but records no chunk probes; overflow never silently overwrites', () => {
  const { probe, at } = fixture(1)
  at(3); probe.receipt(1, 1001, 128, 0.02); probe.receipt(2, 1002, 128, 0.02)
  probe.stop()
  assert.equal(probe.export().chunks.length, 1)
  assert.equal(probe.export().counters.bufferOverflow, 1)
  probe.start('baseline', 7); probe.receipt(1, 1001, 128, 0.02)
  probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); probe.endFrame(); probe.stop()
  assert.equal(probe.export().records.length, 0)
  assert.equal(probe.export().frames.length, 1)
})
test('quantiles use nearest rank and preserve worst-case tails', () => {
  assert.equal(percentile([], 0.95), null)
  assert.equal(percentile([2, 100, 1, 3], 0.5), 2)
  assert.equal(percentile([2, 100, 1, 3], 0.95), 100)
})

test('timer-quantized delivery is unresolved while later draw latency remains measurable', () => {
  const { probe, at } = fixture()
  at(1); probe.receipt(1, 1001.05, 128, 0.02)
  at(4); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); at(5); probe.endFrame()
  at(10); probe.beginFrame('spectrum'); probe.drawn(); probe.endFrame(); probe.stop()
  const data = raw(probe); data.timerQuantumMs = 0.1
  const result = analyzeMeasurement(data)
  assert.equal(result.valid, true)
  assert.equal(result.scopes[0].unresolvedDelivery, 1)
  assert.equal(result.scopes[0].captureToReceiptMs.count, 0)
  assert.equal(result.scopes[0].latencyMs.count, 1)
  assert.ok(Math.abs(result.latencyUncertaintyMs - 0.3) < 1e-8)
  assert.ok(result.scopes[0].upperLatencyMs.p95! > result.scopes[0].latencyMs.p95!)
})

test('duplicate consumption and changed configuration cannot support a claim', () => {
  const { probe, at } = fixture()
  at(3); probe.receipt(1, 1001, 128, 0.02)
  at(4); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); probe.endFrame()
  at(8); probe.beginFrame('spectrum'); probe.consume('spectrum', 1); probe.drawn(); probe.endFrame(); probe.stop()
  const data = raw(probe); data.startMetadata = { changed: true }
  const result = analyzeMeasurement(data)
  assert.equal(result.scopes[0].duplicate, 1)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some(p => p.includes('settings changed')))
})

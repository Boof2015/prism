import test from 'node:test'
import assert from 'node:assert/strict'
import { linkPresentation } from '../scripts/benchmark/presentation.mjs'
const fixture = () => {
  const identity = { sequence_number: 2, source_id: 1 }
  const event = (name, ph, ts, args = {}, extra = {}) => ({ name, ph, ts, args, pid: 10, tid: 20, id2: { local: '0x3' }, ...extra })
  const events = [
    event('AnimationFrame', 'b', 100000, { id: 'exact-id', animation_frame_timing_info: { begin_frame_id: identity } }),
    event('AnimationFrame', 'e', 104000),
    event('FireAnimationFrame', 'X', 101000, {}, { dur: 2000 }),
    event('prism.frame.0.spectrum.start', 'I', 101100, { data: { callTime: 101100, startTime: 1.1 } }),
    event('prism.frame.0.spectrum.end', 'I', 102100, { data: { callTime: 102100, startTime: 2.1 } }),
    event('AnimationFrame::Presentation', 'n', 110000, { id: 'exact-id', begin_frame_id: identity }),
    event('PipelineReporter', 'b', 99000, { frame_reporter: { frame_source: 1, frame_sequence: 2, state: 'STATE_PRESENTED_ALL' } }, { tid: 30 }),
  ]
  const raw = { scopes: ['spectrum'], frames: [[0, 0, 1, 2, 1]], records: [[1, 4, 0, 0, 1001, 1, 1.5, 2, 1, 128]] }
  const clock = { offset: -1000, uncertaintyMs: 0.1, timerQuantumMs: 0.1 }
  return { events, raw, clock }
}
test('presentation estimate requires complete identity chain and calibrated clock bridge', () => {
  const { events, raw, clock } = fixture(), result = linkPresentation(events, raw, clock)
  assert.equal(result.available, true)
  assert.equal(result.samples[0].latencyMs, 9)
  assert.equal(result.frameLinks[0].drawToPresentationEstimateMs, 8)
})
test('duplicate or wrong-frame presentation is rejected, regardless of proximity', () => {
  const { events, raw, clock } = fixture()
  assert.equal(linkPresentation([...events, events[5]], raw, clock).available, false)
  events[5].args.begin_frame_id = { source_id: 1, sequence_number: 3 }
  assert.equal(linkPresentation(events, raw, clock).available, false)
})
test('a partial compositor frame or marker outside its RAF task cannot establish presentation', () => {
  const { events, raw, clock } = fixture()
  events[6].args.frame_reporter.state = 'STATE_PRESENTED_PARTIAL'
  assert.equal(linkPresentation(events, raw, clock).available, false)
  events[6].args.frame_reporter.state = 'STATE_PRESENTED_ALL'
  events[2].dur = 10
  assert.equal(linkPresentation(events, raw, clock).available, false)
})

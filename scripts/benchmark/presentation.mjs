/** Conservative association using frame IDs and enclosing RAF tasks, never nearest timestamps. */
export function linkPresentation(events, raw, clock) {
  const key = e => `${e.pid}:${e.tid}:${e.id2?.local ?? e.id2?.global ?? e.id}`
  const intervals = [], stacks = new Map(), presentations = new Map(), reporters = new Map(), marks = new Map()
  const append = (map, id, value) => map.set(id, [...(map.get(id) ?? []), value])
  const rafTasks = events.filter(e => e.name === 'FireAnimationFrame' && e.ph === 'X' && e.dur > 0)
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.name === 'AnimationFrame') {
      if (e.ph === 'b') append(stacks, key(e), e)
      if (e.ph === 'e') {
        const start = stacks.get(key(e))?.pop()
        if (start?.args?.id) intervals.push({ start, end: e })
      }
    }
    if (e.name === 'AnimationFrame::Presentation') append(presentations, `${e.pid}:${e.args?.id}`, e)
    if (e.name === 'PipelineReporter' && e.ph === 'b') {
      const info = e.args?.frame_reporter
      if (info) append(reporters, `${e.pid}:${info.frame_source}:${info.frame_sequence}`, e)
    }
    const match = /^prism\.frame\.(\d+)\.([a-z]+)\.(start|end)$/.exec(e.name ?? '')
    if (match) append(marks, `${match[1]}:${match[2]}:${match[3]}`, e)
  }
  const frameLinks = [], rejected = []
  for (const frame of raw.frames) {
    const id = frame[0], scope = raw.scopes[frame[1]]
    if (!frame[4]) continue
    const starts = marks.get(`${id}:${scope}:start`) ?? [], ends = marks.get(`${id}:${scope}:end`) ?? []
    const fail = reason => rejected.push({ frame: id, scope, reason })
    if (starts.length !== 1 || ends.length !== 1) { fail('missing or duplicate scope markers'); continue }
    const start = starts[0], end = ends[0]
    const startCall = start.args?.data?.callTime, endCall = end.args?.data?.callTime
    const endPerformance = end.args?.data?.startTime
    if (![startCall, endCall, endPerformance].every(Number.isFinite) || start.pid !== end.pid || start.tid !== end.tid) { fail('invalid marker clock/thread'); continue }
    const parents = intervals.filter(x => x.start.pid === start.pid && x.start.tid === start.tid && x.start.ts <= startCall && x.end.ts >= endCall)
    const tasks = rafTasks.filter(x => x.pid === start.pid && x.tid === start.tid && x.ts <= startCall && x.ts + x.dur >= endCall)
    if (parents.length !== 1 || tasks.length !== 1) { fail('ambiguous enclosing animation frame or RAF task'); continue }
    const parent = parents[0].start, beginId = parent.args?.animation_frame_timing_info?.begin_frame_id
    const present = presentations.get(`${parent.pid}:${parent.args.id}`) ?? []
    const pipeline = reporters.get(`${parent.pid}:${beginId?.source_id}:${beginId?.sequence_number}`) ?? []
    if (present.length !== 1 || pipeline.length !== 1 || pipeline[0].args.frame_reporter.state !== 'STATE_PRESENTED_ALL') { fail('missing/ambiguous presentation or incomplete compositor frame'); continue }
    const p = present[0], presentId = p.args?.begin_frame_id
    if (!beginId || beginId.source_id !== presentId?.source_id || beginId.sequence_number !== presentId?.sequence_number
      || p.ts < endCall || endPerformance + clock.timerQuantumMs < frame[3]) { fail('frame identity or time ordering mismatch'); continue }
    const rendererPresentationMs = endPerformance + (p.ts - endCall) / 1000
    frameLinks.push({ frame: id, scope, rendererPid: parent.pid, animationId: parent.args.id,
      beginFrameSource: beginId.source_id, beginFrameSequence: beginId.sequence_number,
      presentationTraceUs: p.ts, markerCallTraceUs: endCall, markerPerformanceMs: endPerformance,
      rendererPresentationMs, drawToPresentationEstimateMs: rendererPresentationMs - frame[3] })
  }
  const byFrame = new Map(frameLinks.map(link => [link.frame, link]))
  const samples = []
  for (const r of raw.records) {
    const link = byFrame.get(r[3])
    if (!link || r[8] !== 1 || !Number.isFinite(r[4])) continue
    const latencyMs = link.rendererPresentationMs - (r[4] + clock.offset)
    if (latencyMs >= 0) samples.push({ session: r[0], sequence: r[1], frame: r[3], scope: link.scope, latencyMs })
  }
  return { available: samples.length > 0, source: 'Chromium AnimationFrame::Presentation; macOS presentation feedback is an estimate',
    caveat: 'Separate tracing workload. Software clock bounds do not bound OS presentation-estimation error or physical pixel response.',
    matchedFrames: frameLinks.length, rejectedFrames: rejected.length, matchedChunkScopeRecords: samples.length,
    successfulChunkScopeRecords: raw.records.filter(r => r[8] === 1).length,
    softwareTimingUncertaintyMs: clock.uncertaintyMs + clock.timerQuantumMs,
    frameLinks, rejected, samples }
}

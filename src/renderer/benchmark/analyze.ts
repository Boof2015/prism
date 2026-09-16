import { clockBounds, percentile, type ClockSample, type LatencyProbe } from './latencyProbe'
import type { AudioRouterDiagnostics } from '../audio/AudioRouter'

export type RawMeasurement = ReturnType<LatencyProbe['export']> & {
  clockStart: ClockSample[]; clockEnd: ClockSample[]
  timerQuantumMs?: number
  routerStart: AudioRouterDiagnostics; routerEnd: AudioRouterDiagnostics
  hiddenEvents: number
  startMetadata?: unknown
  metadata: { hidden: boolean; visibleScopes: string[]; capture: { activeBackendKind: string | null; isCapturing: boolean } }
}
export function statistics(values: number[]) {
  return { count: values.length, median: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: percentile(values, 1) }
}

export function analyzeMeasurement(raw: RawMeasurement) {
  const timerQuantumMs = raw.timerQuantumMs ?? 0
  const clock = { ...clockBounds(raw.clockStart, raw.clockEnd, timerQuantumMs), timerQuantumMs }
  const latencyUncertaintyMs = clock.uncertaintyMs + timerQuantumMs
  const problems: string[] = []
  if (raw.startMetadata && JSON.stringify(raw.startMetadata) !== JSON.stringify(raw.metadata)) problems.push('Capture, display geometry, or scope settings changed during measurement')
  if (raw.hiddenEvents || raw.metadata.hidden) problems.push('Window visibility changed or window was hidden')
  if (!raw.metadata.capture.isCapturing || raw.metadata.capture.activeBackendKind !== 'native-macos') problems.push('Native macOS system capture was not active')
  for (const key of ['nativeOverwrites', 'sequenceGaps', 'sessionChanges', 'bufferOverflow', 'missingReceipts', 'trimmedChunks', 'consumedOutsideFrame'] as const) {
    if (raw.counters[key]) problems.push(`${key}: ${raw.counters[key]}`)
  }
  if (raw.routerEnd.totalOverwriteCount !== raw.routerStart.totalOverwriteCount) problems.push('Router overwrites occurred')
  if (raw.mode !== 'baseline' && !raw.chunks.some(c => c[5] > 0.00001)) problems.push('No non-silent captured signal verified')
  if (raw.mode !== 'baseline' && !raw.chunks.length) problems.push('No captured chunks')
  const scopes = raw.scopes.filter(s => raw.metadata.visibleScopes.includes(s)).map(scope => {
    const id = raw.scopes.indexOf(scope)
    const rows = raw.records.filter(r => r[2] === id)
    const frames = raw.frames.filter(f => f[1] === id)
    const frameIntervals = frames.slice(1).map((f, i) => f[2] - frames[i][2])
    const drawWork = frames.map(f => f[3] - f[2])
    const total: number[] = [], upper: number[] = [], delivery: number[] = [], queue: number[] = [], render: number[] = []
    const seen = new Set<string>()
    let invalid = 0, skipped = 0, duplicate = 0, unresolvedDelivery = 0
    for (const r of rows) {
      const key = `${r[0]}:${r[1]}`
      if (seen.has(key)) { duplicate++; continue }
      seen.add(key)
      if (r[8] === 0) { skipped++; continue }
      if (r[8] !== 1 || !r.slice(4, 8).every(Number.isFinite)) { invalid++; continue }
      const capture = r[4] + clock.offset
      // Reject impossible ordering. Overlapping receipt/capture uncertainty intervals
      // leave delivery duration unresolved, but need not invalidate a later draw endpoint.
      if (r[5] + timerQuantumMs < r[4] + clock.low || r[6] < r[5] || r[7] < r[6]
          || r[7] - capture < 0) { invalid++; continue }
      total.push(r[7] - capture)
      upper.push(r[7] + timerQuantumMs - (r[4] + clock.low))
      if (r[5] - timerQuantumMs >= r[4] + clock.high) delivery.push(r[5] - capture)
      else unresolvedDelivery++
      queue.push(r[6] - r[5]); render.push(r[7] - r[6])
    }
    if (raw.mode !== 'baseline' && (!total.length || invalid || skipped || duplicate)) problems.push(`${scope}: ${invalid} invalid, ${skipped} skipped, ${duplicate} duplicate, ${total.length} valid`)
    // End-of-window arrivals still in the normal scope queue are right-censored, not successful draws.
    const unconsumedAtStop = Math.max(0, raw.chunks.length - seen.size)
    const pendingAtStop = raw.routerEnd.scopes[scope].queuedChunks
    if (raw.mode !== 'baseline' && unconsumedAtStop > pendingAtStop) problems.push(`${scope}: unexplained unconsumed chunks`)
    return { scope, latencyMs: statistics(total), upperLatencyMs: statistics(upper), captureToReceiptMs: statistics(delivery),
      receiptToConsumptionMs: statistics(queue), consumptionToDrawEndMs: statistics(render),
      frameWorkMs: statistics(drawWork), frameIntervalMs: statistics(frameIntervals),
      observedFps: frames.length > 1 ? (frames.length - 1) * 1000 / (frames[frames.length - 1][2] - frames[0][2]) : 0,
      frameCount: frames.length, skippedDrawFrames: frames.filter(f => !f[4]).length,
      invalid, skippedChunks: skipped, duplicate, unresolvedDelivery, unconsumedAtStop, pendingAtStop }
  })
  if (!scopes.length || scopes.some(s => s.frameCount < 2)) problems.push('Insufficient scope frames')
  return { durationMs: raw.stoppedAt - raw.startedAt, clock, latencyUncertaintyMs, problems, valid: problems.length === 0,
    counters: raw.counters, chunkSizes: [...new Set(raw.chunks.map(c => c[4]))], scopes }
}

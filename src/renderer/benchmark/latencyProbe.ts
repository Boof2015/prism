/** Benchmark-only observation. This module never changes capture or DSP state. */
export const BENCHMARK_BUILD = typeof __PRISM_LATENCY_BENCHMARK__ !== 'undefined' && __PRISM_LATENCY_BENCHMARK__
export const BENCH_SCOPES = ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter'] as const
export type BenchScope = typeof BENCH_SCOPES[number]
export type ProbeMode = 'baseline' | 'probe' | 'trace'
export const CHUNK_COLUMNS = ['session', 'sequence', 'nativeAt', 'receivedAt', 'sampleFrames', 'peak'] as const
export const RECORD_COLUMNS = ['session', 'sequence', 'scope', 'frame', 'nativeAt', 'receivedAt', 'consumedAt', 'drawEnd', 'outcome', 'sampleFrames'] as const
export const FRAME_COLUMNS = ['frame', 'scope', 'start', 'end', 'drew'] as const
// outcome: 1 = successful draw invocation, 0 = skipped; -1 = missing receipt metadata.
const C = CHUNK_COLUMNS.length, R = RECORD_COLUMNS.length, F = FRAME_COLUMNS.length

export interface ClockSample { before: number; native: number; after: number }
export function measureTimerQuantum(now = () => performance.now(), minimumMs = 0.1): number {
  const deltas: number[] = []
  let previous = now()
  for (let i = 0; i < 1000000 && deltas.length < 32; i++) {
    const current = now()
    if (current > previous) { deltas.push(current - previous); previous = current }
  }
  if (!deltas.length) throw new Error('Renderer clock did not advance')
  return Math.max(minimumMs, Math.min(...deltas) * 1.05)
}
export function calibrateClock(readNative: () => number, now = () => performance.now(), count = 64): ClockSample[] {
  return Array.from({ length: count }, () => {
    const before = now(), native = readNative(), after = now()
    return { before, native, after }
  })
}

/** Lowest round-trip bracket, widened to cover both endpoint calibrations. */
export function clockBounds(start: ClockSample[], end: ClockSample[], timerQuantumMs = 0) {
  const best = (samples: ClockSample[]) => samples.filter(s =>
    Number.isFinite(s.native) && Number.isFinite(s.before) && Number.isFinite(s.after) && s.after >= s.before,
  ).sort((a, b) => (a.after - a.before) - (b.after - b.before))[0]
  const a = best(start), b = best(end)
  if (!a || !b) throw new Error('Missing valid clock calibration')
  const low = Math.min(a.before - a.native, b.before - b.native) - timerQuantumMs
  const high = Math.max(a.after - a.native, b.after - b.native) + timerQuantumMs
  return { low, high, offset: (low + high) / 2, uncertaintyMs: (high - low) / 2,
    endpointDriftMs: Math.abs((a.before + a.after) / 2 - a.native - ((b.before + b.after) / 2 - b.native)) }
}

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))]
}

export class LatencyProbe {
  active = false
  mode: ProbeMode = 'probe'
  private chunks: Float64Array
  private records: Float64Array
  private frames: Float64Array
  private receiptSlots: Int32Array
  private boundaryChunks = 0
  private latestNativeOverwrites = 0
  private chunkCount = 0
  private recordCount = 0
  private frameCount = 0
  private frameRecordStart = 0
  private currentFrame = -1
  private currentScope = -1
  private didDraw = false
  private session = 0
  private lastSequence = 0
  private nativeOverwrites = 0
  private sequenceGaps = 0
  private sessionChanges = 0
  private overflow = 0
  private missingReceipts = 0
  private trimmedChunks = 0
  private outsideFrame = 0
  private nativeQueueMax = 0
  private lastNativeOverwrites: number | null = null
  private startedAt = 0
  private stoppedAt = 0
  constructor(private capacity = 262144, private now = () => performance.now()) {
    this.chunks = new Float64Array(capacity * C)
    this.records = new Float64Array(capacity * R)
    this.frames = new Float64Array(65536 * F)
    this.receiptSlots = new Int32Array(8192).fill(-1)
  }
  start(mode: ProbeMode, session: number): void {
    if (this.active) throw new Error('Benchmark already running')
    this.mode = mode
    this.session = session
    this.chunkCount = this.recordCount = this.frameCount = this.lastSequence = 0
    this.nativeOverwrites = this.sequenceGaps = this.sessionChanges = this.overflow = 0
    this.missingReceipts = this.trimmedChunks = this.outsideFrame = this.nativeQueueMax = 0
    this.currentFrame = -1
    this.lastNativeOverwrites = this.latestNativeOverwrites
    this.boundaryChunks = 0
    this.receiptSlots.fill(-1)
    this.startedAt = this.now()
    this.active = true
  }
  sessionChanged(session: number): void {
    if (!this.active || session === this.session) return
    this.sessionChanges++
    this.session = session
    this.lastSequence = 0
    this.lastNativeOverwrites = null
    this.receiptSlots.fill(-1)
  }
  nativeDrain(overwrites: number, queueDepth: number, trimmed: number): void {
    this.latestNativeOverwrites = overwrites
    if (!this.active || this.mode === 'baseline') return
    if (this.lastNativeOverwrites !== null) this.nativeOverwrites += Math.max(0, overwrites - this.lastNativeOverwrites)
    this.lastNativeOverwrites = overwrites
    this.nativeQueueMax = Math.max(this.nativeQueueMax, queueDepth)
    this.trimmedChunks += trimmed
  }
  receipt(sequence: number, nativeAt: number, sampleFrames: number, peak: number): void {
    if (!this.active || this.mode === 'baseline') return
    const receivedAt = this.now()
    if (this.lastSequence && sequence !== this.lastSequence + 1) this.sequenceGaps += Math.max(1, sequence - this.lastSequence - 1)
    this.lastSequence = sequence
    if (this.chunkCount >= this.capacity) { this.overflow++; return }
    const row = this.chunkCount++, i = row * C
    this.chunks[i] = this.session; this.chunks[i + 1] = sequence
    this.chunks[i + 2] = nativeAt; this.chunks[i + 3] = receivedAt
    this.chunks[i + 4] = sampleFrames; this.chunks[i + 5] = peak
    this.receiptSlots[sequence % this.receiptSlots.length] = row
  }
  beginFrame(scope: BenchScope): void {
    if (!this.active) return
    if (this.currentFrame !== -1) throw new Error('Nested benchmark frames')
    if (this.frameCount >= this.frames.length / F) { this.overflow++; return }
    this.currentScope = BENCH_SCOPES.indexOf(scope)
    this.currentFrame = this.frameCount++
    this.frameRecordStart = this.recordCount
    this.didDraw = false
    const i = this.currentFrame * F
    this.frames[i] = this.currentFrame; this.frames[i + 1] = this.currentScope
    this.frames[i + 2] = this.now()
    if (this.mode === 'trace') performance.mark(`prism.frame.${this.currentFrame}.${scope}.start`)
  }
  consume(scope: string, sequence: number): void {
    if (!this.active || this.mode === 'baseline' || !BENCH_SCOPES.includes(scope as BenchScope)) return
    if (this.currentFrame < 0 || BENCH_SCOPES[this.currentScope] !== scope) { this.outsideFrame++; return }
    if (this.chunkCount === 0 || (this.chunks[0] === this.session && sequence < this.chunks[1])) { this.boundaryChunks++; return }
    if (this.recordCount >= this.capacity) { this.overflow++; return }
    const i = this.recordCount++ * R
    const slot = this.receiptSlots[sequence % this.receiptSlots.length], c = slot * C
    const found = slot >= 0 && this.chunks[c] === this.session && this.chunks[c + 1] === sequence
    if (!found) this.missingReceipts++
    this.records[i] = this.session; this.records[i + 1] = sequence
    this.records[i + 2] = this.currentScope; this.records[i + 3] = this.currentFrame
    this.records[i + 4] = found ? this.chunks[c + 2] : NaN
    this.records[i + 5] = found ? this.chunks[c + 3] : NaN
    this.records[i + 6] = this.now(); this.records[i + 7] = NaN
    this.records[i + 8] = found ? 0 : -1
    this.records[i + 9] = found ? this.chunks[c + 4] : 0
  }
  drawn(): void { if (this.active) this.didDraw = true }
  endFrame(): void {
    if (!this.active || this.currentFrame < 0) return
    // Capture endpoint before observer bookkeeping and trace emission.
    const end = this.now(), i = this.currentFrame * F
    this.frames[i + 3] = end; this.frames[i + 4] = Number(this.didDraw)
    for (let row = this.frameRecordStart; row < this.recordCount; row++) {
      const r = row * R
      this.records[r + 7] = end
      if (this.records[r + 8] !== -1) this.records[r + 8] = Number(this.didDraw)
    }
    if (this.mode === 'trace') performance.mark(`prism.frame.${this.currentFrame}.${BENCH_SCOPES[this.currentScope]}.end`)
    this.currentFrame = -1
  }
  stop(): void { this.stoppedAt = this.now(); this.active = false }
  export() {
    if (this.active) throw new Error('Stop before export')
    const rows = (data: Float64Array, count: number, width: number) => Array.from({ length: count }, (_, i) => Array.from(data.subarray(i * width, (i + 1) * width)))
    return { mode: this.mode, startedAt: this.startedAt, stoppedAt: this.stoppedAt,
      scopes: BENCH_SCOPES, chunkColumns: CHUNK_COLUMNS, recordColumns: RECORD_COLUMNS, frameColumns: FRAME_COLUMNS,
      chunks: rows(this.chunks, this.chunkCount, C), records: rows(this.records, this.recordCount, R), frames: rows(this.frames, this.frameCount, F),
      counters: { boundaryChunks: this.boundaryChunks, nativeOverwrites: this.nativeOverwrites, sequenceGaps: this.sequenceGaps, sessionChanges: this.sessionChanges,
        bufferOverflow: this.overflow, missingReceipts: this.missingReceipts, trimmedChunks: this.trimmedChunks,
        consumedOutsideFrame: this.outsideFrame, nativeQueueMax: this.nativeQueueMax } }
  }
}

// Allocate only in the explicit benchmark build, never in a normal build.
export const latencyProbe = BENCHMARK_BUILD ? new LatencyProbe() : null

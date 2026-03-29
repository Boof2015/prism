/**
 * AudioRouter — demand-aware audio chunk routing for Prism's visualizers.
 * Captured worklet chunks are stored in fixed-capacity rings so hidden scopes
 * do not accumulate backlog and queue overflow never reallocates.
 */

import { AUDIO_SCOPE_KINDS, type AudioScopeKind } from '../../types/scope'
import type { CaptureBackendKind } from '../../types/capture'

const MAX_PENDING_CHUNKS = 20
const MAX_PENDING_SPECTRUM_CHUNKS = 96
const MAX_PENDING_VECTORSCOPE_CHUNKS = 20
const LATENCY_SAMPLE_WINDOW = 240

const SCOPE_RING_CAPACITY: Record<AudioScopeKind, number> = {
  spectrum: MAX_PENDING_SPECTRUM_CHUNKS,
  oscilloscope: MAX_PENDING_CHUNKS,
  vectorscope: MAX_PENDING_VECTORSCOPE_CHUNKS,
  spectrogram: MAX_PENDING_SPECTRUM_CHUNKS,
  vumeter: MAX_PENDING_VECTORSCOPE_CHUNKS,
  lufsmeter: MAX_PENDING_SPECTRUM_CHUNKS,
  waveform: MAX_PENDING_SPECTRUM_CHUNKS,
}

export interface AudioSessionState {
  sessionId: number
  sampleRate: number
  channelCount: number
  capturing: boolean
  backendKind: CaptureBackendKind | null
}

export interface VisualizerConsumerDemand {
  spectrum?: boolean
  oscilloscope?: boolean
  vectorscope?: boolean
  spectrogram?: boolean
  vumeter?: boolean
  lufsmeter?: boolean
  waveform?: boolean
}

export interface AudioRouterScopeDiagnostics {
  lastCaptureToScopeMs: number | null
  p95CaptureToScopeMs: number | null
  drainedChunks: number
  overwriteCount: number
  queuedChunks: number
  lastSequence: number | null
}

export interface AudioRouterDiagnostics {
  updatedAt: number
  activeDemand: VisualizerConsumerDemand
  overallP95CaptureToScopeMs: number | null
  totalOverwriteCount: number
  notCapturingDrops: number
  staleSessionDrops: number
  undemandedChunks: number
  scopes: Record<AudioScopeKind, AudioRouterScopeDiagnostics>
}

export type NormalizedVisualizerConsumerDemand = Required<VisualizerConsumerDemand>

interface AudioChunkMeta {
  sessionId?: number
  channelCount?: number
  capturedAt?: number
  sequence?: number
}

interface MonoChunkRecord {
  samples: Float32Array
  capturedAt: number
  sequence: number
}

interface StereoChunkRecord {
  left: Float32Array
  right: Float32Array
  capturedAt: number
  sequence: number
}

interface ScopeLatencyTracker {
  lastCaptureToScopeMs: number | null
  drainedChunks: number
  lastSequence: number | null
  latencyWindow: RollingLatencyWindow
}

type ScopeRingMap = {
  spectrum: FixedChunkRing<StereoChunkRecord>
  oscilloscope: FixedChunkRing<MonoChunkRecord>
  vectorscope: FixedChunkRing<StereoChunkRecord>
  spectrogram: FixedChunkRing<MonoChunkRecord>
  vumeter: FixedChunkRing<StereoChunkRecord>
  lufsmeter: FixedChunkRing<StereoChunkRecord>
  waveform: FixedChunkRing<StereoChunkRecord>
}

class FixedChunkRing<T> {
  private readonly buffer: Array<T | undefined>
  private start = 0
  private size = 0
  private overwriteCount = 0

  constructor(private readonly capacity: number) {
    this.buffer = new Array<T | undefined>(Math.max(1, capacity))
  }

  push(item: T): void {
    if (this.capacity <= 0) return

    if (this.size < this.capacity) {
      const index = (this.start + this.size) % this.capacity
      this.buffer[index] = item
      this.size += 1
      return
    }

    this.buffer[this.start] = item
    this.start = (this.start + 1) % this.capacity
    this.overwriteCount += 1
  }

  drain(): T[] {
    if (this.size === 0) return []

    const drained = new Array<T>(this.size)
    for (let index = 0; index < this.size; index += 1) {
      const bufferIndex = (this.start + index) % this.capacity
      const item = this.buffer[bufferIndex]
      if (item !== undefined) {
        drained[index] = item
      }
      this.buffer[bufferIndex] = undefined
    }

    this.start = 0
    this.size = 0
    return drained.filter((item): item is T => item !== undefined)
  }

  clear(): void {
    if (this.size === 0) return
    for (let index = 0; index < this.size; index += 1) {
      const bufferIndex = (this.start + index) % this.capacity
      this.buffer[bufferIndex] = undefined
    }
    this.start = 0
    this.size = 0
  }

  getSize(): number {
    return this.size
  }

  getOverwriteCount(): number {
    return this.overwriteCount
  }
}

class RollingLatencyWindow {
  private readonly values: number[]
  private cursor = 0
  private count = 0

  constructor(size: number) {
    this.values = new Array<number>(Math.max(1, size))
  }

  push(value: number): void {
    this.values[this.cursor] = value
    this.cursor = (this.cursor + 1) % this.values.length
    this.count = Math.min(this.count + 1, this.values.length)
  }

  getP95(): number | null {
    if (this.count === 0) return null
    const sorted = this.values.slice(0, this.count).sort((left, right) => left - right)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
    return sorted[index] ?? null
  }

  reset(): void {
    this.cursor = 0
    this.count = 0
  }
}

function createEmptyDemand(): NormalizedVisualizerConsumerDemand {
  return {
    spectrum: false,
    oscilloscope: false,
    vectorscope: false,
    spectrogram: false,
    vumeter: false,
    lufsmeter: false,
    waveform: false,
  }
}

function createScopeLatencyTracker(): ScopeLatencyTracker {
  return {
    lastCaptureToScopeMs: null,
    drainedChunks: 0,
    lastSequence: null,
    latencyWindow: new RollingLatencyWindow(LATENCY_SAMPLE_WINDOW),
  }
}

export class AudioRouter {
  private readonly rings: ScopeRingMap = {
    spectrum: new FixedChunkRing<StereoChunkRecord>(SCOPE_RING_CAPACITY.spectrum),
    oscilloscope: new FixedChunkRing<MonoChunkRecord>(SCOPE_RING_CAPACITY.oscilloscope),
    vectorscope: new FixedChunkRing<StereoChunkRecord>(SCOPE_RING_CAPACITY.vectorscope),
    spectrogram: new FixedChunkRing<MonoChunkRecord>(SCOPE_RING_CAPACITY.spectrogram),
    vumeter: new FixedChunkRing<StereoChunkRecord>(SCOPE_RING_CAPACITY.vumeter),
    lufsmeter: new FixedChunkRing<StereoChunkRecord>(SCOPE_RING_CAPACITY.lufsmeter),
    waveform: new FixedChunkRing<StereoChunkRecord>(SCOPE_RING_CAPACITY.waveform),
  }

  private readonly scopeLatency: Record<AudioScopeKind, ScopeLatencyTracker> = {
    spectrum: createScopeLatencyTracker(),
    oscilloscope: createScopeLatencyTracker(),
    vectorscope: createScopeLatencyTracker(),
    spectrogram: createScopeLatencyTracker(),
    vumeter: createScopeLatencyTracker(),
    lufsmeter: createScopeLatencyTracker(),
    waveform: createScopeLatencyTracker(),
  }

  private readonly consumerDemand = new Map<string, VisualizerConsumerDemand>()

  private _sampleRate = 48000
  private _capturing = false
  private _channelCount = 2
  private _sessionId = 0
  private _backendKind: CaptureBackendKind | null = null

  private notCapturingDrops = 0
  private staleSessionDrops = 0
  private undemandedChunks = 0

  private sessionListeners = new Set<(state: AudioSessionState) => void>()
  private demandListeners = new Set<(demand: NormalizedVisualizerConsumerDemand) => void>()

  private emitSessionState(): void {
    const state = this.getSessionState()
    for (const listener of this.sessionListeners) {
      listener(state)
    }
  }

  getSampleRate(): number {
    return this._sampleRate
  }

  isCapturing(): boolean {
    return this._capturing
  }

  getChannelCount(): number {
    return this._channelCount
  }

  getSessionState(): AudioSessionState {
    return {
      sessionId: this._sessionId,
      sampleRate: this._sampleRate,
      channelCount: this._channelCount,
      capturing: this._capturing,
      backendKind: this._backendKind,
    }
  }

  beginSession(sampleRate: number, channelCount: number, backendKind: CaptureBackendKind | null = null): number {
    this._sessionId += 1
    this._sampleRate = sampleRate
    this._channelCount = Math.max(1, Math.floor(channelCount) || 1)
    this._capturing = true
    this._backendKind = backendKind
    this.reset()
    this.emitSessionState()
    return this._sessionId
  }

  endSession(): void {
    this._sessionId += 1
    this._capturing = false
    this._backendKind = null
    this.reset()
    this.emitSessionState()
  }

  subscribeToSessionChanges(listener: (state: AudioSessionState) => void): () => void {
    this.sessionListeners.add(listener)
    listener(this.getSessionState())
    return () => {
      this.sessionListeners.delete(listener)
    }
  }

  subscribeToDemandChanges(listener: (demand: NormalizedVisualizerConsumerDemand) => void): () => void {
    this.demandListeners.add(listener)
    listener(this.getActiveVisualizerDemand())
    return () => {
      this.demandListeners.delete(listener)
    }
  }

  getActiveVisualizerDemand(): NormalizedVisualizerConsumerDemand {
    return this.getActiveDemand()
  }

  setVisualizerConsumerDemand(consumerId: string, demand: VisualizerConsumerDemand): void {
    const normalized: VisualizerConsumerDemand = {
      spectrum: Boolean(demand.spectrum),
      oscilloscope: Boolean(demand.oscilloscope),
      vectorscope: Boolean(demand.vectorscope),
      spectrogram: Boolean(demand.spectrogram),
      vumeter: Boolean(demand.vumeter),
      lufsmeter: Boolean(demand.lufsmeter),
      waveform: Boolean(demand.waveform),
    }

    const hasAnyDemand = Object.values(normalized).some(Boolean)
    if (hasAnyDemand) {
      this.consumerDemand.set(consumerId, normalized)
    } else {
      this.consumerDemand.delete(consumerId)
    }

    this.pruneQueuesForDemand()
    this.emitDemandState()
  }

  clearVisualizerConsumerDemand(consumerId: string): void {
    if (this.consumerDemand.delete(consumerId)) {
      this.pruneQueuesForDemand()
      this.emitDemandState()
    }
  }

  ingestChunk(left: Float32Array, right: Float32Array, meta: AudioChunkMeta = {}): void {
    if (!this._capturing) {
      this.notCapturingDrops += 1
      return
    }

    if (meta.sessionId !== undefined && meta.sessionId !== this._sessionId) {
      this.staleSessionDrops += 1
      return
    }

    const effectiveChannelCount = Math.max(1, Math.floor(meta.channelCount ?? this._channelCount) || 1)
    this._channelCount = effectiveChannelCount

    const resolvedRight = effectiveChannelCount > 1 && right.length > 0 ? right : left
    const len = Math.min(left.length, resolvedRight.length)
    if (len === 0) return

    const activeDemand = this.getActiveDemand()
    const needsSpectrum = Boolean(activeDemand.spectrum)
    const needsMono = Boolean(activeDemand.spectrogram)
    const needsStereo = Boolean(activeDemand.vectorscope || activeDemand.vumeter || activeDemand.lufsmeter || activeDemand.waveform)
    const needsLeft = Boolean(activeDemand.oscilloscope)

    if (!needsSpectrum && !needsMono && !needsStereo && !needsLeft) {
      this.undemandedChunks += 1
      return
    }

    const capturedAt = meta.capturedAt ?? performance.now()
    const sequence = meta.sequence ?? 0
    const leftSamples = left.length === len ? left : left.subarray(0, len)
    const rightSamples = resolvedRight.length === len ? resolvedRight : resolvedRight.subarray(0, len)

    let mono: Float32Array | null = null
    if (needsMono) {
      mono = new Float32Array(len)
      for (let index = 0; index < len; index += 1) {
        mono[index] = (leftSamples[index] + rightSamples[index]) * 0.5
      }
    }

    if (activeDemand.oscilloscope) {
      this.rings.oscilloscope.push({ samples: leftSamples, capturedAt, sequence })
    }

    if (activeDemand.spectrum) {
      this.rings.spectrum.push({ left: leftSamples, right: rightSamples, capturedAt, sequence })
    }

    if (activeDemand.spectrogram && mono) {
      this.rings.spectrogram.push({ samples: mono, capturedAt, sequence })
    }

    if (activeDemand.vectorscope) {
      this.rings.vectorscope.push({ left: leftSamples, right: rightSamples, capturedAt, sequence })
    }

    if (activeDemand.vumeter) {
      this.rings.vumeter.push({ left: leftSamples, right: rightSamples, capturedAt, sequence })
    }

    if (activeDemand.lufsmeter) {
      this.rings.lufsmeter.push({ left: leftSamples, right: rightSamples, capturedAt, sequence })
    }

    if (activeDemand.waveform) {
      this.rings.waveform.push({ left: leftSamples, right: rightSamples, capturedAt, sequence })
    }
  }

  flushPendingOscilloscopeSamples(): Float32Array[] {
    const records = this.rings.oscilloscope.drain()
    this.recordScopeDrain('oscilloscope', records)
    return records.map((record) => record.samples)
  }

  flushPendingSpectrumSamples(): Float32Array[] {
    const records = this.rings.spectrum.drain()
    this.recordScopeDrain('spectrum', records)
    return records.map((record) => {
      const length = Math.min(record.left.length, record.right.length)
      const mono = new Float32Array(length)
      for (let index = 0; index < length; index += 1) {
        mono[index] = (record.left[index] + record.right[index]) * 0.5
      }
      return mono
    })
  }

  flushPendingSpectrumStereoSamples(): { left: Float32Array; right: Float32Array }[] {
    const records = this.rings.spectrum.drain()
    this.recordScopeDrain('spectrum', records)
    return records.map((record) => ({ left: record.left, right: record.right }))
  }

  flushPendingSpectrogramSamples(): Float32Array[] {
    const records = this.rings.spectrogram.drain()
    this.recordScopeDrain('spectrogram', records)
    return records.map((record) => record.samples)
  }

  flushPendingVectorscopeSamples(): { left: Float32Array; right: Float32Array }[] {
    const records = this.rings.vectorscope.drain()
    this.recordScopeDrain('vectorscope', records)
    return records.map((record) => ({ left: record.left, right: record.right }))
  }

  flushPendingVUMeterSamples(): { left: Float32Array; right: Float32Array }[] {
    const records = this.rings.vumeter.drain()
    this.recordScopeDrain('vumeter', records)
    return records.map((record) => ({ left: record.left, right: record.right }))
  }

  flushPendingLUFSMeterSamples(): { left: Float32Array; right: Float32Array }[] {
    const records = this.rings.lufsmeter.drain()
    this.recordScopeDrain('lufsmeter', records)
    return records.map((record) => ({ left: record.left, right: record.right }))
  }

  flushPendingWaveformSamples(): Float32Array[] {
    const records = this.rings.waveform.drain()
    this.recordScopeDrain('waveform', records)
    return records.map((record) => record.left)
  }

  flushPendingWaveformStereoSamples(): { left: Float32Array; right: Float32Array }[] {
    const records = this.rings.waveform.drain()
    this.recordScopeDrain('waveform', records)
    return records.map((record) => ({ left: record.left, right: record.right }))
  }

  getDiagnosticsSnapshot(): AudioRouterDiagnostics {
    const activeDemand = this.getActiveDemand()
    let totalOverwriteCount = 0
    let overallP95CaptureToScopeMs: number | null = null

    const scopes = AUDIO_SCOPE_KINDS.reduce<Record<AudioScopeKind, AudioRouterScopeDiagnostics>>((result, scope) => {
      const scopeTracker = this.scopeLatency[scope]
      const overwriteCount = this.getRing(scope).getOverwriteCount()
      totalOverwriteCount += overwriteCount

      const p95CaptureToScopeMs = scopeTracker.latencyWindow.getP95()
      if (p95CaptureToScopeMs !== null && activeDemand[scope]) {
        overallP95CaptureToScopeMs = overallP95CaptureToScopeMs === null
          ? p95CaptureToScopeMs
          : Math.max(overallP95CaptureToScopeMs, p95CaptureToScopeMs)
      }

      result[scope] = {
        lastCaptureToScopeMs: scopeTracker.lastCaptureToScopeMs,
        p95CaptureToScopeMs,
        drainedChunks: scopeTracker.drainedChunks,
        overwriteCount,
        queuedChunks: this.getRing(scope).getSize(),
        lastSequence: scopeTracker.lastSequence,
      }
      return result
    }, {} as Record<AudioScopeKind, AudioRouterScopeDiagnostics>)

    return {
      updatedAt: performance.now(),
      activeDemand,
      overallP95CaptureToScopeMs,
      totalOverwriteCount,
      notCapturingDrops: this.notCapturingDrops,
      staleSessionDrops: this.staleSessionDrops,
      undemandedChunks: this.undemandedChunks,
      scopes,
    }
  }

  reset(): void {
    this.clearAllRings()
    this.resetLatencyTrackers()
  }

  private getActiveDemand(): NormalizedVisualizerConsumerDemand {
    const aggregated = createEmptyDemand()
    for (const demand of this.consumerDemand.values()) {
      for (const scope of AUDIO_SCOPE_KINDS) {
        if (demand[scope]) {
          aggregated[scope] = true
        }
      }
    }
    return aggregated
  }

  private emitDemandState(): void {
    const demand = this.getActiveVisualizerDemand()
    for (const listener of this.demandListeners) {
      listener(demand)
    }
  }

  private pruneQueuesForDemand(): void {
    const activeDemand = this.getActiveDemand()
    for (const scope of AUDIO_SCOPE_KINDS) {
      if (!activeDemand[scope]) {
        this.getRing(scope).clear()
      }
    }
  }

  private clearAllRings(): void {
    for (const scope of AUDIO_SCOPE_KINDS) {
      this.getRing(scope).clear()
    }
  }

  private resetLatencyTrackers(): void {
    for (const scope of AUDIO_SCOPE_KINDS) {
      const tracker = this.scopeLatency[scope]
      tracker.lastCaptureToScopeMs = null
      tracker.drainedChunks = 0
      tracker.lastSequence = null
      tracker.latencyWindow.reset()
    }
  }

  private recordScopeDrain(scope: AudioScopeKind, records: Array<MonoChunkRecord | StereoChunkRecord>): void {
    if (records.length === 0) return

    const tracker = this.scopeLatency[scope]
    const now = performance.now()
    for (const record of records) {
      const captureToScopeMs = Math.max(0, now - record.capturedAt)
      tracker.lastCaptureToScopeMs = captureToScopeMs
      tracker.latencyWindow.push(captureToScopeMs)
      tracker.lastSequence = record.sequence
    }
    tracker.drainedChunks += records.length
  }

  private getRing(scope: AudioScopeKind): FixedChunkRing<MonoChunkRecord> | FixedChunkRing<StereoChunkRecord> {
    return this.rings[scope]
  }
}

export const audioRouter = new AudioRouter()

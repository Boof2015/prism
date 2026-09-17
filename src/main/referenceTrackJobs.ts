import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EMPTY_REFERENCE_IMPORT, REFERENCE_FFT_SIZES, REFERENCE_SAMPLE_RATE, encodeReferencePower, normalizeReferenceAsset, type SpectrumReferenceAsset, type SpectrumReferenceImportState } from '../types/spectrumReference'

export interface NativeReferenceCurve {
  sourceNyquistHz: number
  durationSeconds: number
  meanSquare: number
  curves: Record<number, Float32Array>
}
export interface NativeReferenceAnalysis {
  start: (path: string, progress: (fraction: number, curve: NativeReferenceCurve) => void,
    complete: (error: unknown, curve: NativeReferenceCurve | null) => void) => number
  cancel: (id: number) => void
}

export class ReferenceTrackJobs {
  private state: SpectrumReferenceImportState = { ...EMPTY_REFERENCE_IMPORT }
  private nativeJob: number | null = null
  generation = 0
  constructor(private readonly native: () => NativeReferenceAnalysis, private readonly publish: (state: SpectrumReferenceImportState) => void) {}
  getState(): SpectrumReferenceImportState { return this.state }
  private setState(state: SpectrumReferenceImportState): void { this.state = state; this.publish(state) }
  cancel(): void {
    this.generation++
    if (this.nativeJob !== null) this.native().cancel(this.nativeJob)
    this.nativeJob = null
    this.setState({ ...EMPTY_REFERENCE_IMPORT })
  }
  start(path: string): void {
    this.cancel()
    const jobId = randomUUID(), name = basename(path).slice(0, 1024)
    this.setState({ ...EMPTY_REFERENCE_IMPORT, jobId, name, phase: 'opening' })
    const toAsset = (curve: NativeReferenceCurve): SpectrumReferenceAsset | null => normalizeReferenceAsset({
      version: 1, id: jobId, name, sampleRate: REFERENCE_SAMPLE_RATE,
      sourceNyquistHz: curve.sourceNyquistHz, durationSeconds: curve.durationSeconds,
      meanSquare: curve.meanSquare,
      curves: Object.fromEntries(REFERENCE_FFT_SIZES.map(size => [size, encodeReferencePower(curve.curves[size])])),
    })
    try {
      this.nativeJob = this.native().start(path, (fraction, curve) => {
        if (this.state.jobId !== jobId || this.state.phase === 'ready' || this.state.phase === 'error') return
        try {
          this.setState({ ...this.state, phase: 'analyzing', progress: fraction >= 0 ? Math.min(1, fraction) : null, preview: toAsset(curve) })
        } catch { /* A malformed preview must not disrupt the import or live metering. */ }
      }, (error, curve) => {
        if (this.state.jobId !== jobId) return
        this.nativeJob = null
        try {
          if (error) throw error
          const asset = curve ? toAsset(curve) : null
          if (!asset) throw new Error('The reference analysis result is invalid.')
          this.setState({ ...this.state, phase: 'ready', progress: 1, preview: null, result: asset })
        } catch (failure) {
          this.setState({ ...this.state, phase: 'error', preview: null, error: failure instanceof Error ? failure.message : String(failure) })
        }
      })
    } catch (error) {
      this.setState({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }
}

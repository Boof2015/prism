export const REFERENCE_SAMPLE_RATE = 48000
export const REFERENCE_FFT_SIZES = [1024, 2048, 4096, 8192, 16384] as const
export type ReferenceFFTSize = typeof REFERENCE_FFT_SIZES[number]
export type SpectrumReferenceView = 'overlay' | 'difference'

/** Float32 little-endian linear-power bins, encoded for portable profile/DAW recall. */
export interface SpectrumReferenceAsset {
  version: 1
  id: string
  name: string
  sampleRate: typeof REFERENCE_SAMPLE_RATE
  sourceNyquistHz: number
  durationSeconds: number
  meanSquare: number
  curves: Record<ReferenceFFTSize, string>
}

export interface SpectrumReferenceSettings {
  asset: SpectrumReferenceAsset
  trimDb: number
  view: SpectrumReferenceView
}

export interface SpectrumReferenceLevel {
  meanSquare: number
  seconds: number
}

export interface SpectrumReferenceImportState {
  jobId: string | null
  phase: 'idle' | 'opening' | 'analyzing' | 'ready' | 'error'
  name: string
  progress: number | null
  preview: SpectrumReferenceAsset | null
  result: SpectrumReferenceAsset | null
  error: string | null
}

export const EMPTY_REFERENCE_IMPORT: SpectrumReferenceImportState = {
  jobId: null, phase: 'idle', name: '', progress: null, preview: null, result: null, error: null,
}
export const REFERENCE_FILE_ACCEPT = '.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3'
export const isReferenceImporting = (state: SpectrumReferenceImportState): boolean =>
  state.phase === 'opening' || state.phase === 'analyzing'

export function clampReferenceTrim(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(-24, Math.min(24, value)) * 10) / 10 : 0
}

export function encodeReferencePower(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, i) => view.setFloat32(i * 4, value, true))
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function decodeReferencePower(encoded: string, fftSize: number): Float32Array | null {
  const byteCount = fftSize * 2
  if (encoded.length !== Math.ceil(byteCount / 3) * 4) return null
  try {
    const binary = atob(encoded)
    if (binary.length !== byteCount) return null
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    const result = new Float32Array(fftSize / 2)
    for (let i = 0; i < result.length; i++) {
      const value = view.getFloat32(i * 4, true)
      if (!Number.isFinite(value) || value < 0 || value > 1e12) return null
      result[i] = value
    }
    return result
  } catch { return null }
}

const assetCache = new WeakMap<object, SpectrumReferenceAsset | null>()
export function normalizeReferenceAsset(raw: unknown): SpectrumReferenceAsset | null {
  if (!raw || typeof raw !== 'object') return null
  if (assetCache.has(raw)) return assetCache.get(raw) ?? null
  const p = raw as Partial<SpectrumReferenceAsset>
  let result: SpectrumReferenceAsset | null = null
  if (p.version === 1 && p.sampleRate === REFERENCE_SAMPLE_RATE
    && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 128
    && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 1024
    && typeof p.sourceNyquistHz === 'number' && Number.isFinite(p.sourceNyquistHz) && p.sourceNyquistHz >= 4000 && p.sourceNyquistHz <= 192000
    && typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0
    && typeof p.meanSquare === 'number' && Number.isFinite(p.meanSquare) && p.meanSquare >= 0 && p.meanSquare <= 1e12
    && p.curves && typeof p.curves === 'object'
    && REFERENCE_FFT_SIZES.every(size => typeof p.curves?.[size] === 'string' && decodeReferencePower(p.curves[size], size))) {
    result = { version: 1, id: p.id, name: p.name, sampleRate: REFERENCE_SAMPLE_RATE,
      sourceNyquistHz: p.sourceNyquistHz, durationSeconds: p.durationSeconds, meanSquare: p.meanSquare,
      curves: Object.fromEntries(REFERENCE_FFT_SIZES.map(size => [size, p.curves![size]])) as SpectrumReferenceAsset['curves'] }
    assetCache.set(result, result)
  }
  assetCache.set(raw, result)
  return result
}

export function normalizeSpectrumReference(raw: unknown): SpectrumReferenceSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<SpectrumReferenceSettings>
  const asset = normalizeReferenceAsset(p.asset)
  return asset ? { asset, trimDb: clampReferenceTrim(p.trimDb), view: p.view === 'difference' ? 'difference' : 'overlay' } : null
}

export function referenceMatchTrim(referencePower: number, live: SpectrumReferenceLevel | null): number | null {
  if (!live || live.seconds < 1 || !Number.isFinite(live.meanSquare) || live.meanSquare <= 1e-9
    || !Number.isFinite(referencePower) || referencePower <= 1e-12) return null
  return clampReferenceTrim(10 * Math.log10(live.meanSquare / referencePower))
}

export interface SpectrumReferenceTransport {
  subscribe: (callback: (state: SpectrumReferenceImportState) => void) => () => void
  getState: () => Promise<SpectrumReferenceImportState>
  choose: () => Promise<void>
  importFile: (file: File) => Promise<void>
  cancel: () => Promise<void>
}

import { decodeReferencePower, type ReferenceFFTSize, type SpectrumReferenceAsset } from '../../types/spectrumReference'

const cache = new WeakMap<SpectrumReferenceAsset, Map<number, Float32Array>>()
export function referenceBins(asset: SpectrumReferenceAsset, fftSize: number): Float32Array {
  let sizes = cache.get(asset)
  if (!sizes) { sizes = new Map(); cache.set(asset, sizes) }
  let bins = sizes.get(fftSize)
  if (!bins) {
    const power = decodeReferencePower(asset.curves[fftSize as ReferenceFFTSize] ?? '', fftSize)
    bins = power ? Float32Array.from(power, value => 10 * Math.log10(Math.max(1e-12, value))) : new Float32Array(fftSize / 2).fill(-120)
    sizes.set(fftSize, bins)
  }
  return bins
}

export function referenceDbAt(asset: SpectrumReferenceAsset, fftSize: number, frequency: number): number | null {
  if (frequency > Math.min(asset.sourceNyquistHz, 24000) || frequency < 0) return null
  const bins = referenceBins(asset, fftSize)
  const bin = Math.min(bins.length - 1, frequency * fftSize / 48000)
  const lo = Math.floor(bin), hi = Math.min(bins.length - 1, lo + 1)
  const value = bins[lo] + (bins[hi] - bins[lo]) * (bin - lo)
  return value > -119.9 ? value : null
}

/** Subtract matching frequency bins before projection, tilt, or display clipping. */
export function differenceReferenceBins(live: Float32Array, asset: SpectrumReferenceAsset, fftSize: number, trim: number, output = new Float32Array(live.length)): Float32Array {
  const reference = referenceBins(asset, fftSize)
  for (let i = 0; i < output.length; i++) {
    output[i] = i < live.length && i < reference.length && reference[i] > -119.9
      && i * 48000 / fftSize <= asset.sourceNyquistHz ? live[i] - reference[i] - trim : NaN
  }
  return output
}

/** Display-only interpolation; these samples never enter matching or persisted analysis. */
export class ReferenceCurveTransition {
  private current = new Float32Array(0)
  private from = new Float32Array(0)
  private target: Float32Array | null = null
  private start = 0
  sample(target: Float32Array, now: number, reducedMotion: boolean): Float32Array {
    if (target.length !== this.current.length) {
      this.current = target.slice(); this.from = target.slice(); this.target = null
    }
    if (target !== this.target) { this.from.set(this.current); this.target = target; this.start = now }
    const t = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - this.start) / 200))
    const ease = 1 - Math.pow(1 - t, 3)
    for (let i = 0; i < target.length; i++) this.current[i] = this.from[i] + (target[i] - this.from[i]) * ease
    return this.current
  }
}

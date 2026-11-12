import type { PitchSettings } from '../../types/moduleInstance'

interface Peak { hz: number; power: number }
interface Request { id: number; samples: Float32Array; sampleRate: number; settings: PitchSettings }

function goertzel(samples: Float32Array, sampleRate: number, hz: number): number {
  const w = 2 * Math.PI * hz / sampleRate
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < samples.length; i += 1) {
    s0 = samples[i]! + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)
}

function applyHannWindow(samples: Float32Array): Float32Array {
  const windowed = new Float32Array(samples.length)
  const denominator = Math.max(1, samples.length - 1)
  for (let i = 0; i < samples.length; i += 1) {
    windowed[i] = samples[i]! * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / denominator))
  }
  return windowed
}

function refine(samples: Float32Array, sampleRate: number, center: number, span = 0.14): Peak {
  let best = { hz: center, power: 0 }
  for (let i = -6; i <= 6; i += 1) {
    const hz = center * 2 ** ((i / 6) * span)
    const power = goertzel(samples, sampleRate, hz)
    if (power > best.power) best = { hz, power }
  }
  return best
}

function harmonicPower(samples: Float32Array, sampleRate: number, hz: number): number {
  let score = goertzel(samples, sampleRate, hz)
  if (hz * 2 < sampleRate * 0.45) score += goertzel(samples, sampleRate, hz * 2) * 0.42
  if (hz * 3 < sampleRate * 0.45) score += goertzel(samples, sampleRate, hz * 3) * 0.2
  return score
}

function detectBand(samples: Float32Array, sampleRate: number, minHz: number, maxHz: number): Peak | undefined {
  let best: Peak | undefined
  for (let midi = 20; midi <= 105; midi += 2) {
    const hz = 440 * 2 ** ((midi - 69) / 12)
    if (hz < minHz || hz > Math.min(maxHz, sampleRate * 0.45)) continue
    const power = harmonicPower(samples, sampleRate, hz)
    if (!best || power > best.power) best = { hz, power }
  }
  return best ? refine(samples, sampleRate, best.hz, 0.1) : undefined
}

function detect({ samples, sampleRate, settings }: Request): Array<Peak | undefined> {
  if (samples.length < 128) return []
  // Window once per analysis. Applying the Hann window inside every Goertzel
  // candidate made Pitch perform millions of redundant Math.cos calls.
  const windowed = applyHannWindow(samples)
  if (settings.mode === 'semi-auto') {
    return [refine(windowed, sampleRate, settings.primaryTargetHz), refine(windowed, sampleRate, settings.secondaryTargetHz)]
  }
  return [detectBand(windowed, sampleRate, 80, 1100), detectBand(windowed, sampleRate, 35, 250)]
}

self.onmessage = (event: MessageEvent<Request>): void => {
  self.postMessage({ id: event.data.id, peaks: detect(event.data) })
}

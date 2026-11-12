import { useEffect, useRef, type JSX } from 'react'
import type { PitchSettings } from '../../types/moduleInstance'
import type { ScopeInstanceDataSource } from '../audio/scopeInstanceDataSource'
import type { FrameScheduler } from '../visualizers/frameScheduler'

interface Peak { hz: number; power: number }
const MIN_HZ = 40
const MAX_HZ = 2200

function goertzel(samples: Float32Array, sampleRate: number, hz: number): number {
  const w = 2 * Math.PI * hz / sampleRate
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < samples.length; i += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, samples.length - 1))
    s0 = samples[i]! * window + coeff * s1 - s2
    s2 = s1; s1 = s0
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)
}

function refine(samples: Float32Array, sampleRate: number, center: number, span = 0.14): Peak {
  let best = { hz: center, power: 0 }
  for (let i = -8; i <= 8; i += 1) {
    const hz = center * 2 ** ((i / 8) * span)
    const power = goertzel(samples, sampleRate, hz)
    if (power > best.power) best = { hz, power }
  }
  return best
}

function detect(samples: Float32Array, sampleRate: number, settings: PitchSettings): Peak[] {
  if (samples.length < 128) return []
  if (settings.mode === 'semi-auto') {
    return [refine(samples, sampleRate, settings.primaryTargetHz), refine(samples, sampleRate, settings.secondaryTargetHz)]
  }
  const candidates: Peak[] = []
  for (let midi = 28; midi <= 100; midi += 1) {
    const hz = 440 * 2 ** ((midi - 69) / 12)
    if (hz < MIN_HZ || hz > Math.min(MAX_HZ, sampleRate * 0.45)) continue
    candidates.push({ hz, power: goertzel(samples, sampleRate, hz) })
  }
  candidates.sort((a, b) => b.power - a.power)
  const refined = candidates.slice(0, 8).map((peak) => refine(samples, sampleRate, peak.hz, 0.045)).sort((a, b) => b.power - a.power)
  const first = refined[0]
  if (!first) return []
  const second = refined.find((peak) => {
    const ratio = Math.max(peak.hz, first.hz) / Math.min(peak.hz, first.hz)
    return peak.power >= first.power * 0.08 && Math.abs(12 * Math.log2(ratio)) > 1.25
  })
  return second ? [first, second] : [first]
}

function formatPitch(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—'
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}  ${hz.toFixed(1)} Hz`
}

export default function PitchMeter({ settings, dataSource, frameScheduler }: { settings: PitchSettings; dataSource: ScopeInstanceDataSource; frameScheduler: FrameScheduler }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<Peak[]>([])
  const settingsRef = useRef(settings)
  const lastDetectionRef = useRef(0)
  const audioBufferRef = useRef<number[]>([])
  settingsRef.current = settings

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    const draw = (): void => {
      if (disposed) return
      const chunks = dataSource.getPendingVUMeterSamples()
      const now = performance.now()
      for (const chunk of chunks) for (let i = 0; i < Math.min(chunk.left.length, chunk.right.length); i += 1) audioBufferRef.current.push((chunk.left[i]! + chunk.right[i]!) * 0.5)
      if (audioBufferRef.current.length > 8192) audioBufferRef.current.splice(0, audioBufferRef.current.length - 8192)
      if (audioBufferRef.current.length >= 2048 && now - lastDetectionRef.current >= 100) {
        lastDetectionRef.current = now
        const analysis = Float32Array.from(audioBufferRef.current.slice(-4096))
        peaksRef.current = detect(analysis, dataSource.getSampleRate(), settingsRef.current)
      }
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = canvas.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = rect.width, h = rect.height, cx = w / 2, cy = h * 0.86, rx = w * 0.43, ry = h * 0.68
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#050709'; ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#283039'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke()
      const angleFor = (hz: number): number => Math.PI * (1.12 + 0.76 * Math.max(0, Math.min(1, Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ))))
      ctx.font = '600 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#b9c2cc'
      for (const hz of [55, 110, 220, 440, 880, 1760]) { const a = angleFor(hz); const x = cx + Math.cos(a) * rx * 0.88, y = cy + Math.sin(a) * ry * 0.88; ctx.fillText(formatPitch(hz).split(' ')[0]!, x, y) }
      const drawNeedle = (peak: Peak | undefined, color: string, width: number, radius: number): void => {
        if (!peak || peak.power <= 1e-7) return
        const a = angleFor(peak.hz); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rx * radius, cy + Math.sin(a) * ry * radius); ctx.stroke()
      }
      drawNeedle(peaksRef.current[1], 'rgba(91,183,255,.48)', 2, .9)
      drawNeedle(peaksRef.current[0], '#ff477e', 3, .98)
      ctx.fillStyle = '#ff477e'; ctx.font = '700 15px ui-monospace, monospace'; ctx.fillText(formatPitch(peaksRef.current[0]?.hz ?? 0), cx, h - 28)
      ctx.fillStyle = 'rgba(91,183,255,.7)'; ctx.font = '600 12px ui-monospace, monospace'; ctx.fillText(formatPitch(peaksRef.current[1]?.hz ?? 0), cx, h - 10)
    }
    unsubscribe = frameScheduler.subscribe(draw)
    return () => { disposed = true; unsubscribe?.() }
  }, [dataSource, frameScheduler])
  return <canvas ref={canvasRef} className="scope-canvas" aria-label="Dual pitch meter" />
}

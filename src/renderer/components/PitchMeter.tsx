import { useEffect, useRef, type JSX } from 'react'
import type { PitchSettings } from '../../types/moduleInstance'
import type { ScopeInstanceDataSource } from '../audio/scopeInstanceDataSource'
import type { FrameScheduler } from '../visualizers/frameScheduler'
import { createPitchAnalysisClient } from '../audio/pitchAnalysisService'

interface Peak { hz: number; power: number }
interface PitchTracker {
  current?: Peak
  candidate?: Peak
  candidateSince: number
  lastSeen: number
}
const MIN_HZ = 40
const MAX_HZ = 2200

function semitoneDistance(a: number, b: number): number {
  return Math.abs(12 * Math.log2(a / b))
}

function updateTracker(tracker: PitchTracker, detected: Peak | undefined, now: number): Peak | undefined {
  if (!detected || detected.power <= 1e-7) {
    if (tracker.current && now - tracker.lastSeen < 550) return tracker.current
    tracker.current = undefined
    tracker.candidate = undefined
    return undefined
  }
  tracker.lastSeen = now
  if (!tracker.current) {
    tracker.current = detected
    tracker.candidate = undefined
    return detected
  }
  const distance = semitoneDistance(detected.hz, tracker.current.hz)
  if (distance <= 2.25) {
    // Smooth in log-frequency space so the needle moves evenly in musical pitch.
    const alpha = 0.4
    tracker.current = {
      hz: tracker.current.hz * 2 ** (Math.log2(detected.hz / tracker.current.hz) * alpha),
      power: tracker.current.power * (1 - alpha) + detected.power * alpha,
    }
    tracker.candidate = undefined
    return tracker.current
  }
  if (!tracker.candidate || semitoneDistance(detected.hz, tracker.candidate.hz) > 1.5) {
    tracker.candidate = detected
    tracker.candidateSince = now
    return tracker.current
  }
  tracker.candidate = detected
  // A different note/source must remain dominant before the needle changes target.
  if (now - tracker.candidateSince >= 240) {
    tracker.current = detected
    tracker.candidate = undefined
  }
  return tracker.current
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
  const displayedPeaksRef = useRef<Array<Peak | undefined>>([])
  const lastDrawRef = useRef(0)
  const settingsRef = useRef(settings)
  const lastDetectionRef = useRef(0)
  const audioBufferRef = useRef<number[]>([])
  const trackersRef = useRef<[PitchTracker, PitchTracker]>([
    { candidateSince: 0, lastSeen: 0 },
    { candidateSince: 0, lastSeen: 0 },
  ])
  settingsRef.current = settings

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    const analysisClient = createPitchAnalysisClient((detected) => {
      if (disposed) return
      const now = performance.now()
      peaksRef.current = [
        updateTracker(trackersRef.current[0], detected[0], now),
        updateTracker(trackersRef.current[1], detected[1], now),
      ].filter((peak): peak is Peak => peak !== undefined)
    })
    const draw = (): void => {
      if (disposed) return
      const chunks = dataSource.getPendingPitchSamples()
      const now = performance.now()
      const elapsed = lastDrawRef.current > 0 ? Math.min(0.1, (now - lastDrawRef.current) / 1000) : 0
      lastDrawRef.current = now
      for (const chunk of chunks) for (let i = 0; i < Math.min(chunk.left.length, chunk.right.length); i += 1) audioBufferRef.current.push((chunk.left[i]! + chunk.right[i]!) * 0.5)
      if (audioBufferRef.current.length > 8192) audioBufferRef.current.splice(0, audioBufferRef.current.length - 8192)
      if (audioBufferRef.current.length >= 2048 && now - lastDetectionRef.current >= 500) {
        lastDetectionRef.current = now
        const analysis = Float32Array.from(audioBufferRef.current.slice(-4096))
        analysisClient.submit(analysis, dataSource.getSampleRate(), settingsRef.current)
      }
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr))
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr))
      // Changing either canvas dimension clears and reallocates its backing store.
      // Only resize when layout or DPI actually changed; doing this every frame can
      // saturate the renderer/GPU for large or multiple pitch tiles.
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const ctx = canvas.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = rect.width, h = rect.height, cx = w / 2, cy = h * 0.86, rx = w * 0.43, ry = h * 0.68
      const interpolation = 1 - Math.exp(-elapsed / 0.16)
      for (let index = 0; index < 2; index += 1) {
        const target = peaksRef.current[index]
        const displayed = displayedPeaksRef.current[index]
        if (!target) {
          displayedPeaksRef.current[index] = undefined
        } else if (!displayed || interpolation <= 0) {
          displayedPeaksRef.current[index] = target
        } else {
          displayedPeaksRef.current[index] = {
            hz: displayed.hz * 2 ** (Math.log2(target.hz / displayed.hz) * interpolation),
            power: displayed.power + (target.power - displayed.power) * interpolation,
          }
        }
      }
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#050709'; ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#283039'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke()
      const angleFor = (hz: number): number => Math.PI * (1.12 + 0.76 * Math.max(0, Math.min(1, Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ))))
      ctx.font = '600 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#b9c2cc'
      for (const hz of [55, 110, 220, 440, 880, 1760]) { const a = angleFor(hz); const x = cx + Math.cos(a) * rx * 0.88, y = cy + Math.sin(a) * ry * 0.88; ctx.fillText(formatPitch(hz).split(' ')[0]!, x, y) }
      const drawNeedle = (peak: Peak | undefined, color: string, width: number, radius: number): void => {
        if (!peak || peak.power <= 1e-7) return
        const a = angleFor(peak.hz); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rx * radius, cy + Math.sin(a) * ry * radius); ctx.stroke()
      }
      drawNeedle(displayedPeaksRef.current[1], 'rgba(91,183,255,.48)', 2, .9)
      drawNeedle(displayedPeaksRef.current[0], '#ff477e', 3, .98)
      ctx.fillStyle = '#ff477e'; ctx.font = '700 15px ui-monospace, monospace'; ctx.fillText(formatPitch(displayedPeaksRef.current[0]?.hz ?? 0), cx, h - 28)
      ctx.fillStyle = 'rgba(91,183,255,.7)'; ctx.font = '600 12px ui-monospace, monospace'; ctx.fillText(formatPitch(displayedPeaksRef.current[1]?.hz ?? 0), cx, h - 10)
    }
    unsubscribe = frameScheduler.subscribe(draw)
    return () => { disposed = true; analysisClient.dispose(); unsubscribe?.() }
  }, [dataSource, frameScheduler])
  return <canvas
    ref={canvasRef}
    className="scope-canvas"
    aria-label="Dual pitch meter"
    style={{ display: 'block', width: '100%', height: '100%' }}
  />
}

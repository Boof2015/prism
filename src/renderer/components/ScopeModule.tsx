import { useEffect, useRef, type JSX } from 'react'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import { useSettingsStore } from '../stores/settingsStore'
import { SpectrumAnalyzer, type SpectrumAnalyzerDataSource } from '../visualizers/SpectrumAnalyzer'
import { Oscilloscope, type OscilloscopeDataSource } from '../visualizers/Oscilloscope'
import { Vectorscope, type VectorscopeDataSource } from '../visualizers/Vectorscope'
import { Spectrogram, type SpectrogramDataSource } from '../visualizers/Spectrogram'
import { VUMeter, type VUMeterDataSource } from '../visualizers/VUMeter'
import { LUFSMeter, type LUFSMeterDataSource } from '../visualizers/LUFSMeter'
import { Waveform, type WaveformDataSource } from '../visualizers/Waveform'

interface ScopeModuleProps {
  scopeKind: ScopeKind
  lineColor?: string
  settings?: ScopeSettings[ScopeKind]
  dataSource?:
    | SpectrumAnalyzerDataSource
    | OscilloscopeDataSource
    | VectorscopeDataSource
    | SpectrogramDataSource
    | VUMeterDataSource
    | LUFSMeterDataSource
    | WaveformDataSource
}

interface Visualizer {
  start(): void
  stop(): void
  dispose(): void
  resize(): void
  setOptions(options: Record<string, unknown>): void
}

/** Maps settingsStore scope settings to the visualizer's setOptions format */
function scopeSettingsToOptions(kind: ScopeKind, settings: ScopeSettings[ScopeKind], lineColor: string): Record<string, unknown> {
  const base = { lineColor }
  switch (kind) {
    case 'spectrum': {
      const s = settings as ScopeSettings['spectrum']
      return {
        ...base,
        fftSize: s.fftSize,
        tiltDbPerOctave: s.tiltDbPerOctave,
        heatmapFill: s.heatmap,
        heatmapTiltDbPerOctave: s.heatmapTiltDbPerOctave,
        showGrid: s.showGrid,
        fillGradient: s.fillGradient,
        smoothing: s.smoothing,
      }
    }
    case 'oscilloscope': {
      const s = settings as ScopeSettings['oscilloscope']
      return { ...base, pitchLock: s.pitchLock, underfillEnabled: s.underfillEnabled, showGrid: s.showGrid, lineWidth: s.lineWidth }
    }
    case 'vectorscope': {
      const s = settings as ScopeSettings['vectorscope']
      return {
        ...base,
        mode: s.mode,
        multiband: s.multiband,
        showGrid: s.showGrid,
        persistence: s.persistence,
        lineWidth: s.lineWidth,
      }
    }
    case 'spectrogram': {
      const s = settings as ScopeSettings['spectrogram']
      return { ...base, fftSize: s.fftSize, scrollSpeed: s.scrollSpeed, clarityMode: s.clarityMode, scaleMode: s.scaleMode, colorScheme: s.colorScheme }
    }
    case 'vumeter': {
      const s = settings as ScopeSettings['vumeter']
      return { ...base, mode: s.mode, orientation: s.orientation }
    }
    case 'lufsmeter': {
      const s = settings as ScopeSettings['lufsmeter']
      return { ...base, mode: s.mode }
    }
    case 'waveform': {
      const s = settings as ScopeSettings['waveform']
      return { ...base, scrollSpeed: s.scrollSpeed, gainDb: s.gainDb, multiband: s.multiband }
    }
    default:
      return base
  }
}

function createVisualizer(
  scopeKind: ScopeKind,
  canvas: HTMLCanvasElement,
  mySettings: ScopeSettings[ScopeKind],
  lineColor: string,
  dataSource?: ScopeModuleProps['dataSource'],
): Visualizer | null {
  const opts = scopeSettingsToOptions(scopeKind, mySettings, lineColor)
  switch (scopeKind) {
    case 'spectrum':
      return new SpectrumAnalyzer(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as SpectrumAnalyzerDataSource } : {}),
      })
    case 'oscilloscope':
      return new Oscilloscope(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as OscilloscopeDataSource } : {}),
      })
    case 'vectorscope':
      return new Vectorscope(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as VectorscopeDataSource } : {}),
      })
    case 'spectrogram':
      return new Spectrogram(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as SpectrogramDataSource } : {}),
      })
    case 'vumeter':
      return new VUMeter(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as VUMeterDataSource } : {}),
      })
    case 'lufsmeter':
      return new LUFSMeter(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as LUFSMeterDataSource } : {}),
      })
    case 'waveform':
      return new Waveform(canvas, {
        ...opts,
        ...(dataSource ? { dataSource: dataSource as WaveformDataSource } : {}),
      })
    default:
      return null
  }
}

export default function ScopeModule({
  scopeKind,
  lineColor = '#38bdf8',
  settings,
  dataSource,
}: ScopeModuleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const visualizerRef = useRef<Visualizer | null>(null)
  const initializedRef = useRef(false)

  const storeSettings = useSettingsStore((s) => s.scopeSettings[scopeKind])
  const mySettings = settings ?? storeSettings

  // Initialize visualizer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    initializedRef.current = false
    const viz = createVisualizer(scopeKind, canvas, mySettings, lineColor, dataSource)
    if (!viz) return

    visualizerRef.current = viz
    viz.start()

    // Mark as initialized after a frame so the settings effect skips the first run
    requestAnimationFrame(() => { initializedRef.current = true })

    return () => {
      viz.dispose()
      visualizerRef.current = null
      initializedRef.current = false
    }
  }, [dataSource, scopeKind])

  // Push settings + lineColor changes to live visualizer (skip initial — constructor already handled it)
  useEffect(() => {
    if (!visualizerRef.current || !initializedRef.current) return
    const opts = { ...scopeSettingsToOptions(scopeKind, mySettings, lineColor), ...(dataSource ? { dataSource } : {}) }
    visualizerRef.current.setOptions(opts)
  }, [dataSource, lineColor, mySettings, scopeKind])

  // ResizeObserver for DPI-aware canvas sizing
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeCanvas = (): void => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      const dpr = window.devicePixelRatio || 1

      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))

      visualizerRef.current?.resize()
    }

    const observer = new ResizeObserver(resizeCanvas)
    observer.observe(container)
    resizeCanvas()

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        minWidth: 0,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  )
}

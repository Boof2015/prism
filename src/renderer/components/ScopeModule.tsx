import { useEffect, useRef, type JSX } from 'react'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import type {
  PrismResolvedTheme,
  ResolvedLUFSMeterTheme,
  ResolvedOscilloscopeTheme,
  ResolvedSpectrogramTheme,
  ResolvedSpectrumTheme,
  ResolvedVectorscopeTheme,
  ResolvedVUMeterTheme,
  ResolvedWaveformTheme,
} from '../../types/theme'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import { SpectrumAnalyzer, type SpectrumAnalyzerDataSource } from '../visualizers/SpectrumAnalyzer'
import { Oscilloscope, type OscilloscopeDataSource } from '../visualizers/Oscilloscope'
import { Vectorscope, type VectorscopeDataSource } from '../visualizers/Vectorscope'
import { Spectrogram, type SpectrogramDataSource } from '../visualizers/Spectrogram'
import { VUMeter, type VUMeterDataSource } from '../visualizers/VUMeter'
import { LUFSMeter, type LUFSMeterDataSource } from '../visualizers/LUFSMeter'
import { Waveform, type WaveformDataSource } from '../visualizers/Waveform'
import type { FrameScheduler } from '../visualizers/frameScheduler'

type ScopeModuleTheme =
  | ResolvedSpectrumTheme
  | ResolvedOscilloscopeTheme
  | ResolvedVectorscopeTheme
  | ResolvedSpectrogramTheme
  | ResolvedVUMeterTheme
  | ResolvedLUFSMeterTheme
  | ResolvedWaveformTheme

interface ScopeModuleProps {
  scopeKind: ScopeKind
  theme?: ScopeModuleTheme
  settings?: ScopeSettings[ScopeKind]
  frameScheduler?: FrameScheduler
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

function getScopeTheme(theme: PrismResolvedTheme, kind: ScopeKind): ScopeModuleTheme {
  return theme[kind] as ScopeModuleTheme
}

function scopeSettingsToOptions(
  kind: ScopeKind,
  settings: ScopeSettings[ScopeKind],
  theme: ScopeModuleTheme,
): Record<string, unknown> {
  switch (kind) {
    case 'spectrum': {
      const s = settings as ScopeSettings['spectrum']
      const t = theme as ResolvedSpectrumTheme
      return {
        lineColor: t.primary,
        gradientColors: t.fillGradient,
        heatColors: t.heatColors,
        backgroundColor: t.background,
        gridColor: t.guides,
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
      const t = theme as ResolvedOscilloscopeTheme
      return {
        lineColor: t.primary,
        backgroundColor: t.background,
        gridColor: t.guides,
        underfillColor: t.fill,
        pitchLock: s.pitchLock,
        underfillEnabled: s.underfillEnabled,
        showGrid: s.showGrid,
        lineWidth: s.lineWidth,
      }
    }
    case 'vectorscope': {
      const s = settings as ScopeSettings['vectorscope']
      const t = theme as ResolvedVectorscopeTheme
      return {
        lineColor: t.primary,
        backgroundColor: t.background,
        gridColor: t.guides,
        bandColors: {
          low: t.lowBand,
          mid: t.midBand,
          high: t.highBand,
        },
        mode: s.mode,
        multiband: s.multiband,
        showGrid: s.showGrid,
        persistence: s.persistence,
        lineWidth: s.lineWidth,
      }
    }
    case 'spectrogram': {
      const s = settings as ScopeSettings['spectrogram']
      const t = theme as ResolvedSpectrogramTheme
      return {
        lineColor: t.primary,
        heatColors: t.heatColors,
        fftSize: s.fftSize,
        scrollSpeed: s.scrollSpeed,
        clarityMode: s.clarityMode,
        scaleMode: s.scaleMode,
        colorScheme: s.colorScheme,
      }
    }
    case 'vumeter': {
      const s = settings as ScopeSettings['vumeter']
      const t = theme as ResolvedVUMeterTheme
      return {
        lineColor: t.primary,
        peakColor: t.peak,
        clipColor: t.clip,
        scaleColor: t.guides,
        labelColor: t.text,
        mode: s.mode,
        orientation: s.orientation,
      }
    }
    case 'lufsmeter': {
      const s = settings as ScopeSettings['lufsmeter']
      const t = theme as ResolvedLUFSMeterTheme
      return {
        lineColor: t.primary,
        targetColor: t.target,
        scaleColor: t.guides,
        labelColor: t.text,
        mode: s.mode,
      }
    }
    case 'waveform': {
      const s = settings as ScopeSettings['waveform']
      const t = theme as ResolvedWaveformTheme
      return {
        lineColor: t.primary,
        gridMajorColor: t.guides,
        gridMinorColor: t.guides,
        bandColors: {
          low: t.lowBand,
          mid: t.midBand,
          high: t.highBand,
        },
        scrollSpeed: s.scrollSpeed,
        gainDb: s.gainDb,
        multiband: s.multiband,
      }
    }
    default:
      return {}
  }
}

function createVisualizer(
  scopeKind: ScopeKind,
  canvas: HTMLCanvasElement,
  mySettings: ScopeSettings[ScopeKind],
  theme: ScopeModuleTheme,
  frameScheduler?: FrameScheduler,
  dataSource?: ScopeModuleProps['dataSource'],
): Visualizer | null {
  const opts = { ...scopeSettingsToOptions(scopeKind, mySettings, theme), frameScheduler }
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
  theme,
  settings,
  frameScheduler,
  dataSource,
}: ScopeModuleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const visualizerRef = useRef<Visualizer | null>(null)
  const initializedRef = useRef(false)

  const storeSettings = useSettingsStore((s) => s.scopeSettings[scopeKind])
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const mySettings = settings ?? storeSettings
  const myTheme = theme ?? getScopeTheme(activeTheme, scopeKind)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    initializedRef.current = false
    const viz = createVisualizer(scopeKind, canvas, mySettings, myTheme, frameScheduler, dataSource)
    if (!viz) return

    visualizerRef.current = viz
    viz.start()

    requestAnimationFrame(() => {
      initializedRef.current = true
    })

    return () => {
      viz.dispose()
      visualizerRef.current = null
      initializedRef.current = false
    }
  }, [dataSource, frameScheduler, myTheme, mySettings, scopeKind])

  useEffect(() => {
    if (!visualizerRef.current || !initializedRef.current) return
    const opts = {
      ...scopeSettingsToOptions(scopeKind, mySettings, myTheme),
      frameScheduler,
      ...(dataSource ? { dataSource } : {}),
    }
    visualizerRef.current.setOptions(opts)
  }, [dataSource, frameScheduler, mySettings, myTheme, scopeKind])

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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'
import type {
  PrismResolvedTheme,
  ResolvedAstraTheme,
  ResolvedLUFSMeterTheme,
  ResolvedOscilloscopeTheme,
  ResolvedSpectrogramTheme,
  ResolvedSpectrumTheme,
  ResolvedVectorscopeTheme,
  ResolvedVUMeterTheme,
  ResolvedWaveformTheme,
} from '../../types/theme'
import type { SpectrumPeakInfo } from '../../types/spectrum'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import AstraScopeModule from './AstraScopeModule'
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
  | ResolvedAstraTheme

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

interface CanvasResizeState {
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
  dpr: number
}

const SPECTRUM_PEAK_OVERLAY_MARGIN_PX = 10
const SPECTRUM_PEAK_OVERLAY_FALLBACK_WIDTH_PX = 248
const SPECTRUM_PEAK_OVERLAY_FALLBACK_HEIGHT_PX = 42

interface SizeMeasurement {
  width: number
  height: number
}

function getScopeTheme(theme: PrismResolvedTheme, kind: ScopeKind): ScopeModuleTheme {
  return theme[kind] as ScopeModuleTheme
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatSpectrumPeakDb(value: number): string {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}dB`
}

function formatSpectrumPeakFrequency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '--'
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}kHz`
  }

  return `${value.toFixed(2)}Hz`
}

function resolveFollowingPeakOverlayStyle(
  peakInfo: SpectrumPeakInfo,
  resizeState: CanvasResizeState | null,
  overlaySize: SizeMeasurement | null,
): CSSProperties {
  if (!resizeState) {
    return {
      left: `${SPECTRUM_PEAK_OVERLAY_MARGIN_PX}px`,
      top: `${SPECTRUM_PEAK_OVERLAY_MARGIN_PX}px`,
    }
  }

  const width = resizeState.cssWidth
  const height = resizeState.cssHeight
  const overlayWidth = overlaySize?.width ?? SPECTRUM_PEAK_OVERLAY_FALLBACK_WIDTH_PX
  const overlayHeight = overlaySize?.height ?? SPECTRUM_PEAK_OVERLAY_FALLBACK_HEIGHT_PX
  const peakX = peakInfo.normalizedX * width
  const peakY = peakInfo.normalizedY * height
  const maxLeft = Math.max(
    SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
    width - overlayWidth - SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
  )
  const maxTop = Math.max(
    SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
    height - overlayHeight - SPECTRUM_PEAK_OVERLAY_MARGIN_PX,
  )

  const canPlaceAbove = peakY - overlayHeight >= SPECTRUM_PEAK_OVERLAY_MARGIN_PX
  const canPlaceBelow = peakY + overlayHeight <= height - SPECTRUM_PEAK_OVERLAY_MARGIN_PX

  const left = peakX
  const top = canPlaceAbove || !canPlaceBelow
    ? peakY - overlayHeight
    : peakY

  return {
    left: `${clampNumber(left, SPECTRUM_PEAK_OVERLAY_MARGIN_PX, maxLeft)}px`,
    top: `${clampNumber(top, SPECTRUM_PEAK_OVERLAY_MARGIN_PX, maxTop)}px`,
  }
}

function measureCanvasResizeState(container: HTMLDivElement): CanvasResizeState {
  const rect = container.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.floor(rect.width))
  const cssHeight = Math.max(1, Math.floor(rect.height))
  const dpr = window.devicePixelRatio || 1

  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.floor(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * dpr)),
    dpr,
  }
}

function isSameCanvasResizeState(
  left: CanvasResizeState | null,
  right: CanvasResizeState | null,
): boolean {
  if (!left || !right) {
    return false
  }

  return left.cssWidth === right.cssWidth
    && left.cssHeight === right.cssHeight
    && left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && left.dpr === right.dpr
}

export function scopeSettingsToOptions(
  kind: ScopeKind,
  settings: ScopeSettings[ScopeKind],
  theme: ScopeModuleTheme,
): Record<string, unknown> {
  switch (kind) {
    case 'spectrum': {
      const s = settings as ScopeSettings['spectrum']
      const t = theme as ResolvedSpectrumTheme
      return {
        lineColor: t.line,
        secondaryLineColor: t.sideLine,
        gradientColors: t.fillGradient,
        heatColors: t.heatColors,
        heatBaseColor: t.heatBase,
        backgroundColor: t.background,
        gridColor: t.guides,
        labelColor: t.labels,
        fftSize: s.fftSize,
        tiltDbPerOctave: s.tiltDbPerOctave,
        heatmapFill: s.heatmap,
        heatmapTiltDbPerOctave: s.heatmapTiltDbPerOctave,
        heatmapSmoothing: s.heatmapSmoothing,
        showGrid: s.showGrid,
        fillGradient: s.fillGradient,
        smoothing: s.smoothing,
        showSideLine: s.showSideLine,
      }
    }
    case 'oscilloscope': {
      const s = settings as ScopeSettings['oscilloscope']
      const t = theme as ResolvedOscilloscopeTheme
      return {
        lineColor: t.line,
        backgroundColor: t.background,
        gridMajorColor: t.guides,
        gridMinorColor: t.guidesSecondary,
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
        lineColor: t.trace,
        backgroundColor: t.background,
        gridMajorColor: t.guides,
        gridMinorColor: t.guidesSecondary,
        labelColor: t.labels,
        bandColors: {
          low: t.bandLow,
          mid: t.bandMid,
          high: t.bandHigh,
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
        lineColor: t.mono,
        heatColors: t.heatColors,
        backgroundColor: t.background,
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
        backgroundColor: t.background,
        lineColor: t.level,
        trackColor: t.track,
        peakColor: t.peak,
        clipColor: t.clip,
        scaleColor: t.scale,
        labelColor: t.labels,
        needleLeftColor: t.needleLeft,
        needleRightColor: t.needleRight,
        needleCombinedColor: t.needleCombined,
        mode: s.mode,
        orientation: s.orientation,
        needleChannels: s.needleChannels,
      }
    }
    case 'lufsmeter': {
      const s = settings as ScopeSettings['lufsmeter']
      const t = theme as ResolvedLUFSMeterTheme
      return {
        backgroundColor: t.background,
        lineColor: t.level,
        trackColor: t.track,
        targetColor: t.target,
        scaleColor: t.scale,
        labelColor: t.labels,
        mode: s.mode,
        readout: s.readout,
      }
    }
    case 'waveform': {
      const s = settings as ScopeSettings['waveform']
      const t = theme as ResolvedWaveformTheme
      return {
        backgroundColor: t.background,
        lineColor: t.line,
        gridMajorColor: t.guides,
        gridMinorColor: t.guidesSecondary,
        bandColors: {
          low: t.bandLow,
          mid: t.bandMid,
          high: t.bandHigh,
        },
        mode: s.mode,
        scrollSpeed: s.scrollSpeed,
        multiband: s.multiband,
      }
    }
    case 'nowPlaying':
      return {}
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
  onSpectrumPeakInfo?: (peakInfo: SpectrumPeakInfo | null) => void,
  captureSpectrumPeakInfo = false,
): Visualizer | null {
  const opts = { ...scopeSettingsToOptions(scopeKind, mySettings, theme), frameScheduler }
  switch (scopeKind) {
    case 'spectrum':
      return new SpectrumAnalyzer(canvas, {
        ...opts,
        capturePeakInfo: captureSpectrumPeakInfo,
        onPeakInfo: onSpectrumPeakInfo,
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
    case 'nowPlaying':
      return null
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
  const pendingResizeRef = useRef<CanvasResizeState | null>(null)
  const appliedResizeRef = useRef<CanvasResizeState | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const peakOverlayRef = useRef<HTMLDivElement | null>(null)
  const [spectrumPeakInfo, setSpectrumPeakInfo] = useState<SpectrumPeakInfo | null>(null)
  const [peakOverlaySize, setPeakOverlaySize] = useState<SizeMeasurement | null>(null)

  const storeSettings = useSettingsStore((s) => s.scopeSettings[scopeKind])
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const mySettings = settings ?? storeSettings
  const myTheme = theme ?? getScopeTheme(activeTheme, scopeKind)
  const spectrumPeakMode = scopeKind === 'spectrum'
    ? (mySettings as ScopeSettings['spectrum']).peakInfoMode
    : 'off'
  const captureSpectrumPeakInfo = scopeKind === 'spectrum' && spectrumPeakMode !== 'off'
  const handleSpectrumPeakInfo = useCallback((nextPeakInfo: SpectrumPeakInfo | null): void => {
    setSpectrumPeakInfo(nextPeakInfo)
  }, [])

  useEffect(() => {
    if (!captureSpectrumPeakInfo) {
      setSpectrumPeakInfo(null)
    }
  }, [captureSpectrumPeakInfo])

  useLayoutEffect(() => {
    const peakOverlay = peakOverlayRef.current
    if (
      scopeKind !== 'spectrum'
      || spectrumPeakMode !== 'following'
      || !spectrumPeakInfo
      || !peakOverlay
    ) {
      setPeakOverlaySize(null)
      return
    }

    const updatePeakOverlaySize = (): void => {
      const nextWidth = peakOverlay.offsetWidth
      const nextHeight = peakOverlay.offsetHeight
      setPeakOverlaySize((previousSize) => {
        if (previousSize?.width === nextWidth && previousSize?.height === nextHeight) {
          return previousSize
        }
        return { width: nextWidth, height: nextHeight }
      })
    }

    updatePeakOverlaySize()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      updatePeakOverlaySize()
    })
    resizeObserver.observe(peakOverlay)
    return () => {
      resizeObserver.disconnect()
    }
  }, [scopeKind, spectrumPeakMode, spectrumPeakInfo])

  if (scopeKind === 'nowPlaying') {
    return (
      <AstraScopeModule
        theme={myTheme as ResolvedAstraTheme}
        settings={mySettings as ScopeSettings['nowPlaying']}
      />
    )
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    initializedRef.current = false
    const viz = createVisualizer(
      scopeKind,
      canvas,
      mySettings,
      myTheme,
      frameScheduler,
      dataSource,
      handleSpectrumPeakInfo,
      captureSpectrumPeakInfo,
    )
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
      setSpectrumPeakInfo(null)
    }
  }, [captureSpectrumPeakInfo, dataSource, frameScheduler, handleSpectrumPeakInfo, myTheme, mySettings, scopeKind])

  useEffect(() => {
    if (!visualizerRef.current || !initializedRef.current) return
    const opts = {
      ...scopeSettingsToOptions(scopeKind, mySettings, myTheme),
      frameScheduler,
      ...(scopeKind === 'spectrum'
        ? {
            capturePeakInfo: captureSpectrumPeakInfo,
            onPeakInfo: handleSpectrumPeakInfo,
          }
        : {}),
      ...(dataSource ? { dataSource } : {}),
    }
    visualizerRef.current.setOptions(opts)
  }, [captureSpectrumPeakInfo, dataSource, frameScheduler, handleSpectrumPeakInfo, mySettings, myTheme, scopeKind])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const getSnapshotCanvas = (): HTMLCanvasElement => {
      if (!snapshotCanvasRef.current) {
        snapshotCanvasRef.current = document.createElement('canvas')
      }
      return snapshotCanvasRef.current
    }

    const applyResize = (): void => {
      resizeFrameRef.current = null
      const nextResize = pendingResizeRef.current
      if (!nextResize || isSameCanvasResizeState(appliedResizeRef.current, nextResize)) {
        return
      }

      canvas.style.width = `${nextResize.cssWidth}px`
      canvas.style.height = `${nextResize.cssHeight}px`
      const previousWidth = canvas.width
      const previousHeight = canvas.height

      if (previousWidth > 0 && previousHeight > 0) {
        const snapshotCanvas = getSnapshotCanvas()
        snapshotCanvas.width = previousWidth
        snapshotCanvas.height = previousHeight
        const snapshotContext = snapshotCanvas.getContext('2d')
        snapshotContext?.clearRect(0, 0, previousWidth, previousHeight)
        snapshotContext?.drawImage(canvas, 0, 0)
      }
      canvas.width = nextResize.pixelWidth
      canvas.height = nextResize.pixelHeight

      if (previousWidth > 0 && previousHeight > 0) {
        const context = canvas.getContext('2d')
        const snapshotCanvas = getSnapshotCanvas()
        context?.drawImage(
          snapshotCanvas,
          0,
          0,
          previousWidth,
          previousHeight,
          0,
          0,
          nextResize.pixelWidth,
          nextResize.pixelHeight,
        )
      }

      appliedResizeRef.current = nextResize
      visualizerRef.current?.resize()
    }

    const scheduleResize = (): void => {
      pendingResizeRef.current = measureCanvasResizeState(container)
      if (resizeFrameRef.current !== null) {
        return
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        applyResize()
      })
    }

    pendingResizeRef.current = measureCanvasResizeState(container)
    applyResize()

    const observer = new ResizeObserver(() => {
      scheduleResize()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      pendingResizeRef.current = null
      appliedResizeRef.current = null
      snapshotCanvasRef.current = null
    }
  }, [])

  const spectrumPeakOverlayStyle = scopeKind === 'spectrum'
    && spectrumPeakMode === 'following'
    && spectrumPeakInfo
    ? resolveFollowingPeakOverlayStyle(spectrumPeakInfo, appliedResizeRef.current, peakOverlaySize)
    : undefined

  return (
    <div
      className="scope-module"
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
      {scopeKind === 'spectrum' && spectrumPeakMode !== 'off' && spectrumPeakInfo && (
        <div
          ref={spectrumPeakMode === 'following' ? peakOverlayRef : null}
          className={[
            'scope-module__peak-info',
            spectrumPeakMode === 'following' ? 'is-following' : 'is-corner',
          ].join(' ')}
          style={spectrumPeakOverlayStyle}
        >
          <span className="scope-module__peak-info-value">{formatSpectrumPeakDb(spectrumPeakInfo.db)}</span>
          <span className="scope-module__peak-info-separator">/</span>
          <span className="scope-module__peak-info-value">{formatSpectrumPeakFrequency(spectrumPeakInfo.frequencyHz)}</span>
          <span className="scope-module__peak-info-separator">/</span>
          <span className="scope-module__peak-info-value">{spectrumPeakInfo.key}</span>
        </div>
      )}
    </div>
  )
}

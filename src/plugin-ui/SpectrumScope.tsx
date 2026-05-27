import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { SpectrumAnalyzer } from '../renderer/visualizers/SpectrumAnalyzer'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedSpectrumTheme } from '../types/theme'
import type { SpectrumPeakInfo } from '../types/spectrum'
import type { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { spectrumSettingsToOptions } from './spectrumOptions'
import {
  formatSpectrumPeakDb,
  formatSpectrumPeakFrequency,
  measureCanvasResizeState,
  resolveFollowingPeakOverlayStyle,
  type CanvasResizeState,
  type SizeMeasurement,
} from './peakOverlay'

interface SpectrumScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeSpectrumAnalyzer
  settings: ScopeSettings['spectrum']
  theme: ResolvedSpectrumTheme
}

export default function SpectrumScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: SpectrumScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyzerRef = useRef<SpectrumAnalyzer | null>(null)
  const resizeStateRef = useRef<CanvasResizeState | null>(null)
  const peakOverlayRef = useRef<HTMLDivElement | null>(null)
  const [peak, setPeak] = useState<SpectrumPeakInfo | null>(null)
  const [overlaySize, setOverlaySize] = useState<SizeMeasurement | null>(null)

  const peakMode = settings.peakInfoMode

  // Create the analyzer once per data source / shim.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const analyzer = new SpectrumAnalyzer(canvas, {
      ...spectrumSettingsToOptions(settings, theme),
      capturePeakInfo: settings.peakInfoMode !== 'off',
      onPeakInfo: setPeak,
      dataSource,
      nativeAnalyzer,
    })
    analyzerRef.current = analyzer

    const applySize = (): void => {
      const state = measureCanvasResizeState(container)
      resizeStateRef.current = state
      if (canvas.width !== state.pixelWidth || canvas.height !== state.pixelHeight) {
        canvas.width = state.pixelWidth
        canvas.height = state.pixelHeight
        analyzer.resize()
      }
    }

    applySize()
    analyzer.start()
    const observer = new ResizeObserver(applySize)
    observer.observe(container)

    return () => {
      observer.disconnect()
      analyzer.dispose()
      analyzerRef.current = null
    }
    // settings/theme are applied via setOptions below, not on recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, nativeAnalyzer])

  // Apply settings/theme changes live.
  useEffect(() => {
    if (settings.peakInfoMode === 'off') setPeak(null)
    analyzerRef.current?.setOptions({
      ...spectrumSettingsToOptions(settings, theme),
      capturePeakInfo: settings.peakInfoMode !== 'off',
      onPeakInfo: setPeak,
    })
  }, [settings, theme])

  // Measure the overlay so "following" placement can avoid the screen edges.
  useLayoutEffect(() => {
    const overlay = peakOverlayRef.current
    if (peakMode !== 'following' || !peak || !overlay) {
      setOverlaySize(null)
      return
    }
    const measure = (): void => {
      const next = { width: overlay.offsetWidth, height: overlay.offsetHeight }
      setOverlaySize((prev) => (prev?.width === next.width && prev?.height === next.height ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(overlay)
    return () => observer.disconnect()
  }, [peakMode, peak])

  const showPeak = peakMode !== 'off' && peak !== null
  const overlayStyle: CSSProperties | undefined =
    peakMode === 'following' && peak
      ? resolveFollowingPeakOverlayStyle(peak, resizeStateRef.current, overlaySize)
      : undefined

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
      {showPeak && peak && (
        <div
          ref={peakMode === 'following' ? peakOverlayRef : null}
          className={['scope-module__peak-info', peakMode === 'following' ? 'is-following' : 'is-corner'].join(' ')}
          style={overlayStyle}
        >
          <span className="scope-module__peak-info-value">{formatSpectrumPeakDb(peak.db)}</span>
          <span className="scope-module__peak-info-separator">/</span>
          <span className="scope-module__peak-info-value">{formatSpectrumPeakFrequency(peak.frequencyHz)}</span>
          <span className="scope-module__peak-info-separator">/</span>
          <span className="scope-module__peak-info-value">{peak.key}</span>
        </div>
      )}
    </div>
  )
}

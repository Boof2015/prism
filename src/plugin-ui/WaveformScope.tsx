import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { Waveform } from '../renderer/visualizers/Waveform'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedWaveformTheme } from '../types/theme'
import type { BridgeWaveformAnalyzer } from './BridgeWaveformAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { waveformSettingsToOptions } from './waveformOptions'
import { resolveScrollingCanvasSize } from './scrollingCanvas'
import { getScopeCanvasTransformStyle } from '../renderer/scopeCanvasTransform'
import { applyPluginScopeCanvasLayout } from './scopeCanvasLayout'

interface WaveformScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeWaveformAnalyzer
  settings: ScopeSettings['waveform']
  theme: ResolvedWaveformTheme
}

export default function WaveformScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: WaveformScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<Waveform | null>(null)
  const rotationRef = useRef(settings.rotation)
  const applySizeRef = useRef<(() => void) | null>(null)
  rotationRef.current = settings.rotation

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new Waveform(canvas, {
      ...waveformSettingsToOptions(settings, theme),
      dataSource,
      nativeAnalyzer,
    })
    vizRef.current = viz

    const applySize = (): void => {
      const { changed } = applyPluginScopeCanvasLayout(
        container,
        canvas,
        rotationRef.current,
        resolveScrollingCanvasSize,
      )
      if (changed) {
        viz.resize()
      }
    }
    applySizeRef.current = applySize

    applySize()
    viz.start()
    const observer = new ResizeObserver(applySize)
    observer.observe(container)

    return () => {
      observer.disconnect()
      applySizeRef.current = null
      viz.dispose()
      vizRef.current = null
    }
    // settings/theme applied via setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, nativeAnalyzer])

  useEffect(() => {
    vizRef.current?.setOptions(waveformSettingsToOptions(settings, theme))
  }, [settings, theme])

  useLayoutEffect(() => {
    applySizeRef.current?.()
  }, [settings.rotation])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas
        ref={canvasRef}
        className="spectrum-scope__canvas"
        style={getScopeCanvasTransformStyle(settings.rotation, settings.mirrorHorizontal)}
      />
    </div>
  )
}

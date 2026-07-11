import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { Spectrogram } from '../renderer/visualizers/Spectrogram'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedSpectrogramTheme } from '../types/theme'
import type { BridgeSpectrogramAnalyzer } from './BridgeSpectrogramAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { spectrogramSettingsToOptions } from './spectrogramOptions'
import { resolveScrollingCanvasSize } from './scrollingCanvas'
import { getScopeCanvasTransformStyle } from '../renderer/scopeCanvasTransform'
import { applyPluginScopeCanvasLayout } from './scopeCanvasLayout'

interface SpectrogramScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeSpectrogramAnalyzer
  settings: ScopeSettings['spectrogram']
  theme: ResolvedSpectrogramTheme
}

export default function SpectrogramScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: SpectrogramScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<Spectrogram | null>(null)
  const rotationRef = useRef(settings.rotation)
  const applySizeRef = useRef<(() => void) | null>(null)
  rotationRef.current = settings.rotation

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new Spectrogram(canvas, {
      ...spectrogramSettingsToOptions(settings, theme),
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
    vizRef.current?.setOptions(spectrogramSettingsToOptions(settings, theme))
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

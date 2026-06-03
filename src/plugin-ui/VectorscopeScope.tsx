import { useEffect, useRef, type JSX } from 'react'
import { Vectorscope } from '../renderer/visualizers/Vectorscope'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedVectorscopeTheme } from '../types/theme'
import type { BridgeVectorscopeAnalyzer } from './BridgeVectorscopeAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { vectorscopeSettingsToOptions } from './vectorscopeOptions'

interface VectorscopeScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeVectorscopeAnalyzer
  settings: ScopeSettings['vectorscope']
  theme: ResolvedVectorscopeTheme
}

export default function VectorscopeScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: VectorscopeScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<Vectorscope | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new Vectorscope(canvas, {
      ...vectorscopeSettingsToOptions(settings, theme),
      dataSource,
      nativeAnalyzer,
    })
    vizRef.current = viz

    const applySize = (): void => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.max(1, Math.floor(rect.width * dpr))
      const pixelHeight = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
        viz.resize()
      }
    }

    applySize()
    viz.start()
    const observer = new ResizeObserver(applySize)
    observer.observe(container)

    return () => {
      observer.disconnect()
      viz.dispose()
      vizRef.current = null
    }
    // settings/theme applied via setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, nativeAnalyzer])

  useEffect(() => {
    vizRef.current?.setOptions(vectorscopeSettingsToOptions(settings, theme))
  }, [settings, theme])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
    </div>
  )
}

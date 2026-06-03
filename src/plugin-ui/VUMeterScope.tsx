import { useEffect, useRef, type JSX } from 'react'
import { VUMeter } from '../renderer/visualizers/VUMeter'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedVUMeterTheme } from '../types/theme'
import type { BridgeVUMeterAnalyzer } from './BridgeVUMeterAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { vumeterSettingsToOptions } from './vumeterOptions'

interface VUMeterScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeVUMeterAnalyzer
  settings: ScopeSettings['vumeter']
  theme: ResolvedVUMeterTheme
}

export default function VUMeterScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: VUMeterScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<VUMeter | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new VUMeter(canvas, {
      ...vumeterSettingsToOptions(settings, theme),
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
    vizRef.current?.setOptions(vumeterSettingsToOptions(settings, theme))
  }, [settings, theme])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
    </div>
  )
}

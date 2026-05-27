import { useEffect, useRef, type JSX } from 'react'
import { LUFSMeter } from '../renderer/visualizers/LUFSMeter'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedLUFSMeterTheme } from '../types/theme'
import type { BridgeLUFSMeterAnalyzer } from './BridgeLUFSMeterAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { lufsmeterSettingsToOptions } from './lufsmeterOptions'

interface LUFSMeterScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeLUFSMeterAnalyzer
  settings: ScopeSettings['lufsmeter']
  theme: ResolvedLUFSMeterTheme
}

export default function LUFSMeterScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: LUFSMeterScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<LUFSMeter | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new LUFSMeter(canvas, {
      ...lufsmeterSettingsToOptions(settings, theme),
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
    vizRef.current?.setOptions(lufsmeterSettingsToOptions(settings, theme))
  }, [settings, theme])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
    </div>
  )
}

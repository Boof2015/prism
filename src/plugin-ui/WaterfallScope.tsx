import { useEffect, useRef, type JSX } from 'react'
import { Waterfall } from '../renderer/visualizers/Waterfall'
import type { WaterfallSettings } from '../types/waterfall'
import type { ResolvedWaterfallTheme } from '../types/theme'
import type { BridgeWaterfallAnalyzer } from './BridgeWaterfallAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { waterfallSettingsToOptions } from './waterfallOptions'
import { applyPluginScopeCanvasLayout } from './scopeCanvasLayout'
import type { NativeFrameScheduler } from './NativeFrameScheduler'

interface Props {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeWaterfallAnalyzer
  frameScheduler: NativeFrameScheduler
  settings: WaterfallSettings
  theme: ResolvedWaterfallTheme
}

export default function WaterfallScope({ dataSource, nativeAnalyzer, frameScheduler, settings, theme }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<Waterfall | null>(null)

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current
    if (!container || !canvas) return
    const viz = new Waterfall(canvas, {
      ...waterfallSettingsToOptions(settings, theme), dataSource, nativeAnalyzer, frameScheduler,
    })
    vizRef.current = viz
    const resize = (): void => {
      if (applyPluginScopeCanvasLayout(container, canvas, 0).changed) viz.resize()
    }
    resize()
    viz.start()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    return () => {
      observer.disconnect()
      viz.dispose()
      vizRef.current = null
    }
    // Settings and theme updates use setOptions and preserve native history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, nativeAnalyzer, frameScheduler])

  useEffect(() => {
    vizRef.current?.setOptions(waterfallSettingsToOptions(settings, theme))
  }, [settings, theme])

  return <div ref={containerRef} className="spectrum-scope">
    <canvas ref={canvasRef} className="spectrum-scope__canvas" />
  </div>
}

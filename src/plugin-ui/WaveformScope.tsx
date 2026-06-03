import { useEffect, useRef, type JSX } from 'react'
import { Waveform } from '../renderer/visualizers/Waveform'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedWaveformTheme } from '../types/theme'
import type { BridgeWaveformAnalyzer } from './BridgeWaveformAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { waveformSettingsToOptions } from './waveformOptions'
import { resolveScrollingCanvasSize } from './scrollingCanvas'

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
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const { width, height } = resolveScrollingCanvasSize(rect.width, rect.height, dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
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
    vizRef.current?.setOptions(waveformSettingsToOptions(settings, theme))
  }, [settings, theme])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
    </div>
  )
}

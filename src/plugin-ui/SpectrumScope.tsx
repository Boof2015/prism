import { useEffect, useRef, useState, type JSX } from 'react'
import { SpectrumAnalyzer } from '../renderer/visualizers/SpectrumAnalyzer'
import type { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'

interface SpectrumScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeSpectrumAnalyzer
  /** Returns the cumulative count of frames received from the host (for the FPS meter). */
  getDataFrameCount?: () => number
  /** Show the render/data FPS diagnostic overlay. */
  showFpsMeter?: boolean
}

// POC visual defaults. A later phase can sync these to Prism's theme/settings
// (the same `scopeSettingsToOptions` mapping ScopeModule already uses).
const VISUAL_OPTIONS = {
  lineColor: '#22d3ee',
  lineWidth: 2,
  fillGradient: true,
  gradientColors: ['rgba(34, 211, 238, 0)', 'rgba(34, 211, 238, 0.25)', 'rgba(139, 92, 246, 0.45)'],
  backgroundColor: 'transparent',
  showGrid: true,
  gridColor: 'rgba(255, 255, 255, 0.1)',
  scaleType: 'log' as const,
  fftSize: 2048,
  minFrequency: 20,
  maxFrequency: 20000,
  minDecibels: -90,
  maxDecibels: -10,
}

export default function SpectrumScope({
  dataSource,
  nativeAnalyzer,
  getDataFrameCount,
  showFpsMeter = false,
}: SpectrumScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fps, setFps] = useState({ render: 0, data: 0 })

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const analyzer = new SpectrumAnalyzer(canvas, {
      ...VISUAL_OPTIONS,
      dataSource,
      nativeAnalyzer,
    })

    const applySize = (): void => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.max(1, Math.floor(rect.width * dpr))
      const pixelHeight = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
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
    }
  }, [dataSource, nativeAnalyzer])

  // Independent FPS meter: counts our own rAF ticks (the webview's actual render
  // rate) and the host data-frame delta over each measurement window.
  useEffect(() => {
    if (!showFpsMeter) return
    let raf = 0
    let renderCount = 0
    let lastData = getDataFrameCount?.() ?? 0
    let lastT = performance.now()

    const loop = (t: number): void => {
      renderCount += 1
      const elapsed = t - lastT
      if (elapsed >= 500) {
        const dataNow = getDataFrameCount?.() ?? 0
        const seconds = elapsed / 1000
        setFps({
          render: Math.round(renderCount / seconds),
          data: Math.round((dataNow - lastData) / seconds),
        })
        renderCount = 0
        lastData = dataNow
        lastT = t
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [showFpsMeter, getDataFrameCount])

  return (
    <div ref={containerRef} className="spectrum-scope">
      <canvas ref={canvasRef} className="spectrum-scope__canvas" />
      {showFpsMeter && (
        <div className="spectrum-scope__fps">
          render {fps.render} fps · data {fps.data} fps · dpr {window.devicePixelRatio || 1}
        </div>
      )}
    </div>
  )
}

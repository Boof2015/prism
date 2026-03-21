import { useEffect, useRef } from 'react'
import type { ScopeKind } from '../../types/scope'
import { SpectrumAnalyzer } from '../visualizers/SpectrumAnalyzer'
import { Oscilloscope } from '../visualizers/Oscilloscope'
import { Vectorscope } from '../visualizers/Vectorscope'

interface ScopeModuleProps {
  scopeKind: ScopeKind
  lineColor?: string
}

type Visualizer = SpectrumAnalyzer | Oscilloscope | Vectorscope

function createVisualizer(scopeKind: ScopeKind, canvas: HTMLCanvasElement, lineColor: string): Visualizer | null {
  switch (scopeKind) {
    case 'spectrum':
      return new SpectrumAnalyzer(canvas, { lineColor })
    case 'oscilloscope':
      return new Oscilloscope(canvas, { lineColor })
    case 'vectorscope':
      return new Vectorscope(canvas, { lineColor })
    default:
      console.warn(`Scope type "${scopeKind}" not yet implemented`)
      return null
  }
}

export default function ScopeModule({ scopeKind, lineColor = '#38bdf8' }: ScopeModuleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const visualizerRef = useRef<Visualizer | null>(null)

  // Initialize and manage visualizer lifecycle
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const viz = createVisualizer(scopeKind, canvas, lineColor)
    if (!viz) return

    visualizerRef.current = viz
    viz.start()

    return () => {
      viz.dispose()
      visualizerRef.current = null
    }
  }, [scopeKind]) // Only recreate when scope type changes

  // Update lineColor without recreating
  useEffect(() => {
    visualizerRef.current?.setOptions({ lineColor })
  }, [lineColor])

  // ResizeObserver for DPI-aware canvas sizing
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeCanvas = (): void => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      const dpr = window.devicePixelRatio || 1

      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))

      visualizerRef.current?.resize()
    }

    const observer = new ResizeObserver(resizeCanvas)
    observer.observe(container)
    resizeCanvas() // Initial size

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
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
    </div>
  )
}

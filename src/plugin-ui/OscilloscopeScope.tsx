import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { Oscilloscope } from '../renderer/visualizers/Oscilloscope'
import type { ScopeSettings } from '../types/settings'
import type { ResolvedOscilloscopeTheme } from '../types/theme'
import type { BridgeOscilloscopeAnalyzer } from './BridgeOscilloscopeAnalyzer'
import type { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { oscilloscopeSettingsToOptions } from './oscilloscopeOptions'
import { getScopeCanvasTransformStyle } from '../renderer/scopeCanvasTransform'
import { applyPluginScopeCanvasLayout } from './scopeCanvasLayout'
import {
  ScopeMeasurementOverlay,
  useScopeMeasurement,
} from '../renderer/components/ScopeMeasurementOverlay'

interface OscilloscopeScopeProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeOscilloscopeAnalyzer
  settings: ScopeSettings['oscilloscope']
  theme: ResolvedOscilloscopeTheme
}

export default function OscilloscopeScope({
  dataSource,
  nativeAnalyzer,
  settings,
  theme,
}: OscilloscopeScopeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vizRef = useRef<Oscilloscope | null>(null)
  const rotationRef = useRef(settings.rotation)
  const applySizeRef = useRef<(() => void) | null>(null)
  rotationRef.current = settings.rotation
  const measurementController = useScopeMeasurement({
    containerRef,
    enabled: true,
    rotation: settings.rotation,
    mirrorHorizontal: settings.mirrorHorizontal,
    getSource: () => vizRef.current,
  })

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const viz = new Oscilloscope(canvas, {
      ...oscilloscopeSettingsToOptions(settings, theme),
      dataSource,
      nativeAnalyzer,
    })
    vizRef.current = viz

    const applySize = (): void => {
      const { changed } = applyPluginScopeCanvasLayout(container, canvas, rotationRef.current)
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
    vizRef.current?.setOptions(oscilloscopeSettingsToOptions(settings, theme))
  }, [settings, theme])

  useLayoutEffect(() => {
    applySizeRef.current?.()
  }, [settings.rotation])

  return (
    <div
      ref={containerRef}
      className={`spectrum-scope scope-measurement-surface ${measurementController.active ? 'is-measuring' : ''}`.trim()}
      {...measurementController.pointerBindings}
    >
      <canvas
        ref={canvasRef}
        className="spectrum-scope__canvas"
        style={getScopeCanvasTransformStyle(settings.rotation, settings.mirrorHorizontal)}
      />
      <ScopeMeasurementOverlay
        containerRef={containerRef}
        measurement={measurementController.measurement}
      />
    </div>
  )
}

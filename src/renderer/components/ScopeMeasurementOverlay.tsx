import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { ScopeDisplayRotation } from '../../types/scopeTransform'
import type { LinkedAnalysisProjection } from '../../types/analysis'
import {
  resolveMeasurementReadoutPosition,
  resolveMeasurementSourcePoint,
  type ActiveScopeMeasurement,
  type ScopeMeasurementSource,
} from '../scopeMeasurement'
import { transformNormalizedScopePoint } from '../scopeCanvasTransform'

interface ScopeMeasurementControllerOptions {
  containerRef: RefObject<HTMLDivElement | null>
  getSource: () => ScopeMeasurementSource | null
  enabled: boolean
  rotation: ScopeDisplayRotation
  mirrorHorizontal: boolean
  onActiveChange?: (active: boolean) => void
  onMeasurementChange?: (change: ScopeMeasurementChange) => void
}

export interface ScopeMeasurementChange {
  interactionId: string
  measurement: ActiveScopeMeasurement | null
}

interface ScopeMeasurementPointerBindings {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export interface ScopeMeasurementController {
  active: boolean
  measurement: ActiveScopeMeasurement | null
  pointerBindings: ScopeMeasurementPointerBindings
}

export function useScopeMeasurement({
  containerRef,
  getSource,
  enabled,
  rotation,
  mirrorHorizontal,
  onActiveChange,
  onMeasurementChange,
}: ScopeMeasurementControllerOptions): ScopeMeasurementController {
  const [measurement, setMeasurement] = useState<ActiveScopeMeasurement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const getSourceRef = useRef(getSource)
  const onActiveChangeRef = useRef(onActiveChange)
  const onMeasurementChangeRef = useRef(onMeasurementChange)
  const interactionIdRef = useRef<string | null>(null)
  const transformRef = useRef({ rotation, mirrorHorizontal })
  getSourceRef.current = getSource
  onActiveChangeRef.current = onActiveChange
  onMeasurementChangeRef.current = onMeasurementChange
  transformRef.current = { rotation, mirrorHorizontal }

  const setActive = useCallback((active: boolean): void => {
    getSourceRef.current()?.setMeasurementActive?.(active)
    onActiveChangeRef.current?.(active)
  }, [])

  const endMeasurement = useCallback((): void => {
    const pointerId = activePointerIdRef.current
    if (pointerId === null) return
    activePointerIdRef.current = null
    const interactionId = interactionIdRef.current
    interactionIdRef.current = null
    const container = containerRef.current
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId)
    }
    setMeasurement(null)
    if (interactionId) {
      onMeasurementChangeRef.current?.({ interactionId, measurement: null })
    }
    setActive(false)
  }, [containerRef, setActive])

  const updateMeasurement = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    const source = getSourceRef.current()
    if (!container || !source) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const viewportPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
    const sourcePoint = resolveMeasurementSourcePoint(
      viewportPoint,
      transformRef.current.rotation,
      transformRef.current.mirrorHorizontal,
    )
    const interactionId = interactionIdRef.current
    if (!interactionId) return
    const nextMeasurement: ActiveScopeMeasurement = {
      pointerId: event.pointerId,
      viewportPoint,
      sourcePoint,
      measurement: source.getMeasurementAt(sourcePoint),
    }
    setMeasurement(nextMeasurement)
    onMeasurementChangeRef.current?.({ interactionId, measurement: nextMeasurement })
  }, [containerRef])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!enabled || event.altKey || event.button !== 0 || !event.isPrimary || activePointerIdRef.current !== null) return
    if (!getSourceRef.current()) return
    event.preventDefault()
    interactionIdRef.current = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${event.pointerId.toString(36)}-${Math.random().toString(36).slice(2)}`
    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setActive(true)
    updateMeasurement(event)
  }, [enabled, setActive, updateMeasurement])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return
    updateMeasurement(event)
  }, [updateMeasurement])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return
    endMeasurement()
  }, [endMeasurement])

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current === event.pointerId) endMeasurement()
  }, [endMeasurement])

  useEffect(() => {
    if (!enabled) endMeasurement()
  }, [enabled, endMeasurement])

  useEffect(() => {
    window.addEventListener('blur', endMeasurement)
    return () => {
      window.removeEventListener('blur', endMeasurement)
      endMeasurement()
    }
  }, [endMeasurement])

  return {
    active: measurement !== null,
    measurement,
    pointerBindings: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onLostPointerCapture: handleLostPointerCapture,
    },
  }
}

interface ScopeMeasurementOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>
  measurement: ActiveScopeMeasurement | null
}

interface Size {
  width: number
  height: number
}

export function ScopeMeasurementOverlay({
  containerRef,
  measurement,
}: ScopeMeasurementOverlayProps): JSX.Element | null {
  const readoutRef = useRef<HTMLDivElement>(null)
  const [readoutSize, setReadoutSize] = useState<Size>({ width: 260, height: 30 })
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1, height: 1 })
  const active = measurement !== null

  useLayoutEffect(() => {
    if (!active) return
    const readout = readoutRef.current
    const container = containerRef.current
    if (!readout || !container) return
    const measure = (): void => {
      const nextReadoutSize = { width: readout.offsetWidth, height: readout.offsetHeight }
      setReadoutSize((previous) => previous.width === nextReadoutSize.width
        && previous.height === nextReadoutSize.height
        ? previous
        : nextReadoutSize)
      const rect = container.getBoundingClientRect()
      const nextViewportSize = { width: rect.width, height: rect.height }
      setViewportSize((previous) => previous.width === nextViewportSize.width
        && previous.height === nextViewportSize.height
        ? previous
        : nextViewportSize)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(readout)
    observer?.observe(container)
    return () => observer?.disconnect()
  }, [active, containerRef])

  if (!measurement) return null

  const x = measurement.viewportPoint.x * viewportSize.width
  const y = measurement.viewportPoint.y * viewportSize.height
  const readoutPosition = resolveMeasurementReadoutPosition(
    { x, y },
    viewportSize,
    readoutSize,
  )
  const readoutStyle: CSSProperties = {
    left: `${readoutPosition.left}px`,
    top: `${readoutPosition.top}px`,
  }

  return (
    <div className="scope-measurement" aria-hidden="true">
      <span className="scope-measurement__line scope-measurement__line--vertical" style={{ left: `${measurement.viewportPoint.x * 100}%` }} />
      <span className="scope-measurement__line scope-measurement__line--horizontal" style={{ top: `${measurement.viewportPoint.y * 100}%` }} />
      <div ref={readoutRef} className="scope-measurement__readout" style={readoutStyle}>
        {measurement.measurement.values.map((value, index) => (
          <span key={`${index}:${value}`} className="scope-measurement__item">
            {index > 0 && <span className="scope-measurement__separator">|</span>}
            <span className="scope-measurement__value">{value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

interface ScopeLinkedAnalysisOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>
  projection: LinkedAnalysisProjection | null
  rotation: ScopeDisplayRotation
  mirrorHorizontal: boolean
}

interface ViewportGuide {
  axis: 'horizontal' | 'vertical'
  position: number
}

function transformLinkedGuide(
  guide: LinkedAnalysisProjection['guides'][number],
  rotation: ScopeDisplayRotation,
  mirrorHorizontal: boolean,
): ViewportGuide {
  const from = transformNormalizedScopePoint(guide.from, rotation, mirrorHorizontal)
  const to = transformNormalizedScopePoint(guide.to, rotation, mirrorHorizontal)
  if (Math.abs(from.x - to.x) <= Math.abs(from.y - to.y)) {
    return { axis: 'vertical', position: (from.x + to.x) / 2 }
  }
  return { axis: 'horizontal', position: (from.y + to.y) / 2 }
}

export function ScopeLinkedAnalysisOverlay({
  containerRef,
  projection,
  rotation,
  mirrorHorizontal,
}: ScopeLinkedAnalysisOverlayProps): JSX.Element | null {
  const labelRef = useRef<HTMLDivElement>(null)
  const [labelSize, setLabelSize] = useState<Size>({ width: 90, height: 26 })
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1, height: 1 })
  const active = projection !== null

  useLayoutEffect(() => {
    if (!active) return
    const label = labelRef.current
    const container = containerRef.current
    if (!label || !container) return
    const measure = (): void => {
      const nextLabelSize = { width: label.offsetWidth, height: label.offsetHeight }
      setLabelSize((previous) => previous.width === nextLabelSize.width
        && previous.height === nextLabelSize.height ? previous : nextLabelSize)
      const rect = container.getBoundingClientRect()
      const nextViewportSize = { width: rect.width, height: rect.height }
      setViewportSize((previous) => previous.width === nextViewportSize.width
        && previous.height === nextViewportSize.height ? previous : nextViewportSize)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(label)
    observer?.observe(container)
    return () => observer?.disconnect()
  }, [active, containerRef])

  if (!projection) return null
  const guides = projection.guides.map((guide) => transformLinkedGuide(
    guide,
    rotation,
    mirrorHorizontal,
  ))
  const anchor = guides.reduce((sum, guide) => {
    if (guide.axis === 'vertical') return { x: sum.x + guide.position, y: sum.y + 0.5 }
    return { x: sum.x + 0.5, y: sum.y + guide.position }
  }, { x: 0, y: 0 })
  const divisor = Math.max(1, guides.length)
  const pointer = {
    x: (anchor.x / divisor) * viewportSize.width,
    y: (anchor.y / divisor) * viewportSize.height,
  }
  const labelPosition = resolveMeasurementReadoutPosition(
    pointer,
    viewportSize,
    labelSize,
  )

  return (
    <div className="scope-linked-analysis" aria-hidden="true">
      {guides.map((guide, index) => (
        <span
          key={`${guide.axis}:${guide.position}:${index}`}
          className={`scope-linked-analysis__line scope-linked-analysis__line--${guide.axis}`}
          style={guide.axis === 'vertical'
            ? { left: `${guide.position * 100}%` }
            : { top: `${guide.position * 100}%` }}
        />
      ))}
      <div
        ref={labelRef}
        className="scope-linked-analysis__label"
        style={{ left: `${labelPosition.left}px`, top: `${labelPosition.top}px` }}
      >
        {projection.label}
      </div>
    </div>
  )
}

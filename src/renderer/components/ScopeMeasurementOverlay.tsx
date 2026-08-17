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
import {
  resolveMeasurementReadoutPosition,
  resolveMeasurementSourcePoint,
  type ActiveScopeMeasurement,
  type ScopeMeasurementSource,
} from '../scopeMeasurement'

interface ScopeMeasurementControllerOptions {
  containerRef: RefObject<HTMLDivElement | null>
  getSource: () => ScopeMeasurementSource | null
  enabled: boolean
  rotation: ScopeDisplayRotation
  mirrorHorizontal: boolean
  onActiveChange?: (active: boolean) => void
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
}: ScopeMeasurementControllerOptions): ScopeMeasurementController {
  const [measurement, setMeasurement] = useState<ActiveScopeMeasurement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const getSourceRef = useRef(getSource)
  const onActiveChangeRef = useRef(onActiveChange)
  const transformRef = useRef({ rotation, mirrorHorizontal })
  getSourceRef.current = getSource
  onActiveChangeRef.current = onActiveChange
  transformRef.current = { rotation, mirrorHorizontal }

  const setActive = useCallback((active: boolean): void => {
    getSourceRef.current()?.setMeasurementActive?.(active)
    onActiveChangeRef.current?.(active)
  }, [])

  const endMeasurement = useCallback((): void => {
    const pointerId = activePointerIdRef.current
    if (pointerId === null) return
    activePointerIdRef.current = null
    const container = containerRef.current
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId)
    }
    setMeasurement(null)
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
    setMeasurement({
      pointerId: event.pointerId,
      viewportPoint,
      sourcePoint,
      measurement: source.getMeasurementAt(sourcePoint),
    })
  }, [containerRef])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!enabled || event.altKey || event.button !== 0 || !event.isPrimary || activePointerIdRef.current !== null) return
    if (!getSourceRef.current()) return
    event.preventDefault()
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

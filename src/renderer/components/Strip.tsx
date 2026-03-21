import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import type { ScopeKind } from '../../types/scope'
import ScopeModule from './ScopeModule'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'

export default function Strip(): JSX.Element {
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const widthWeights = useSettingsStore((s) => s.widthWeights)
  const setScopeWidthWeight = useSettingsStore((s) => s.setScopeWidthWeight)
  const accent = useThemeStore((s) => s.accent)
  const stripRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scopeRefs = useRef<Partial<Record<ScopeKind, HTMLDivElement | null>>>({})
  const [handleOffsets, setHandleOffsets] = useState<number[]>([])
  const visibleScopes = scopeOrder.filter((k) => !hiddenScopes.has(k))
  const gridTemplateColumns = useMemo(() => {
    return buildAnalyzerGridTemplateColumns(visibleScopes, widthWeights)
  }, [visibleScopes, widthWeights])
  const gridStyle = useMemo(() => {
    if (!gridTemplateColumns) return undefined
    return { gridTemplateColumns } as CSSProperties
  }, [gridTemplateColumns])

  const updateHandleOffsets = useCallback((): void => {
    if (visibleScopes.length < 2) {
      setHandleOffsets([])
      return
    }

    const nextOffsets: number[] = []
    for (let index = 0; index < visibleScopes.length - 1; index += 1) {
      const leftElement = scopeRefs.current[visibleScopes[index]]
      if (!leftElement) continue
      nextOffsets.push(leftElement.offsetLeft + leftElement.offsetWidth)
    }

    setHandleOffsets(nextOffsets)
  }, [visibleScopes])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return

    const setAnalyzerHeight = (): void => {
      const nextHeight = Math.max(0, Math.ceil(strip.getBoundingClientRect().height))
      document.documentElement.style.setProperty('--analyzer-height', `${nextHeight}px`)
    }

    setAnalyzerHeight()

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => setAnalyzerHeight())

    observer?.observe(strip)
    window.addEventListener('resize', setAnalyzerHeight)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', setAnalyzerHeight)
    }
  }, [])

  useEffect(() => {
    updateHandleOffsets()

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateHandleOffsets())

    if (gridRef.current) {
      observer?.observe(gridRef.current)
    }

    for (const scope of visibleScopes) {
      const element = scopeRefs.current[scope]
      if (element) {
        observer?.observe(element)
      }
    }

    window.addEventListener('resize', updateHandleOffsets)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHandleOffsets)
    }
  }, [gridTemplateColumns, updateHandleOffsets, visibleScopes])

  const startResizeDrag = useCallback((handleIndex: number, event: React.MouseEvent<HTMLButtonElement>) => {
    const leftKind = visibleScopes[handleIndex]
    const rightKind = visibleScopes[handleIndex + 1]
    if (!leftKind || !rightKind) return

    const leftElement = scopeRefs.current[leftKind]
    const rightElement = scopeRefs.current[rightKind]
    if (!leftElement || !rightElement) return

    event.preventDefault()

    const startX = event.clientX
    const leftWidth = leftElement.getBoundingClientRect().width
    const rightWidth = rightElement.getBoundingClientRect().width
    const pairWidth = Math.max(1, leftWidth + rightWidth)
    const { widthWeights: currentWeights } = useSettingsStore.getState()
    const startLeftWeight = currentWeights[leftKind] ?? 1
    const startRightWeight = currentWeights[rightKind] ?? 1
    const totalWeight = startLeftWeight + startRightWeight
    const minWeight = 0.15

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const weightDelta = (delta / pairWidth) * totalWeight
      let newLeft = startLeftWeight + weightDelta
      let newRight = startRightWeight - weightDelta

      if (newLeft < minWeight) {
        newRight -= minWeight - newLeft
        newLeft = minWeight
      }

      if (newRight < minWeight) {
        newLeft -= minWeight - newRight
        newRight = minWeight
      }

      setScopeWidthWeight(leftKind, newLeft)
      setScopeWidthWeight(rightKind, newRight)
    }

    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [setScopeWidthWeight, visibleScopes])

  return (
    <div ref={stripRef} className="scope-strip">
      <div ref={gridRef} className="scope-strip__grid" style={gridStyle}>
        {visibleScopes.map((kind) => (
          <div
            key={kind}
            ref={(element) => {
              scopeRefs.current[kind] = element
            }}
            className="scope-strip__cell"
          >
            <ScopeModule
              scopeKind={kind}
              lineColor={accent}
            />
          </div>
        ))}
      </div>

      {visibleScopes.length > 1 && handleOffsets.map((offset, index) => (
        <button
          key={`${visibleScopes[index]}:${visibleScopes[index + 1]}`}
          type="button"
          className="scope-strip__resize-handle"
          style={{ left: `${offset}px` }}
          onMouseDown={(event) => startResizeDrag(index, event)}
          aria-label={`Resize between ${visibleScopes[index]} and ${visibleScopes[index + 1]}`}
        >
          <span className="scope-strip__resize-handle-grip" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { SCOPE_LABELS, isAudioScopeKind, type ScopeKind } from '../../types/scope'
import type { WindowBounds } from '../../types/popout'
import ScopeModule from './ScopeModule'
import { buildAnalyzerGridTemplateColumns } from '../analyzerLayout'
import { audioRouter } from '../audio/AudioRouter'
import { usePerformanceStore } from '../stores/performanceStore'
import { FrameScheduler } from '../visualizers/frameScheduler'

export default function Strip(): JSX.Element {
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopePopouts = useSettingsStore((s) => s.scopePopouts)
  const widthWeights = useSettingsStore((s) => s.widthWeights)
  const moveDockedScope = useSettingsStore((s) => s.moveDockedScope)
  const setScopeWidthWeight = useSettingsStore((s) => s.setScopeWidthWeight)
  const popOutScope = useSettingsStore((s) => s.popOutScope)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const setDockedRenderFps = usePerformanceStore((s) => s.setDockedRenderFps)
  const frameScheduler = useMemo(() => new FrameScheduler({ frameTarget }), [])
  const stripRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scopeRefs = useRef<Partial<Record<ScopeKind, HTMLDivElement | null>>>({})
  const [handleOffsets, setHandleOffsets] = useState<number[]>([])
  const dockedScopes = useMemo(
    () => scopeOrder.filter((k) => !hiddenScopes.has(k) && !scopePopouts[k]?.poppedOut),
    [hiddenScopes, scopeOrder, scopePopouts],
  )
  const visibleScopeKey = useMemo(() => dockedScopes.join('|'), [dockedScopes])
  const gridTemplateColumns = useMemo(() => {
    return buildAnalyzerGridTemplateColumns(dockedScopes, widthWeights)
  }, [dockedScopes, widthWeights])
  const gridStyle = useMemo(() => {
    if (!gridTemplateColumns) return undefined
    return { gridTemplateColumns } as CSSProperties
  }, [gridTemplateColumns])

  useEffect(() => {
    frameScheduler.setFrameTarget(frameTarget)
  }, [frameScheduler, frameTarget])

  useEffect(() => {
    const unsubscribe = frameScheduler.subscribeToActualFps((fps) => {
      setDockedRenderFps(fps)
    })

    return () => {
      unsubscribe()
      setDockedRenderFps(0)
    }
  }, [frameScheduler, setDockedRenderFps])

  const updateHandleOffsets = useCallback((): void => {
    if (dockedScopes.length < 2) {
      setHandleOffsets([])
      return
    }

    const nextOffsets: number[] = []
    for (let index = 0; index < dockedScopes.length - 1; index += 1) {
      const leftElement = scopeRefs.current[dockedScopes[index]]
      if (!leftElement) continue
      nextOffsets.push(leftElement.offsetLeft + leftElement.offsetWidth)
    }

    setHandleOffsets(nextOffsets)
  }, [dockedScopes])

  useEffect(() => {
    const visibleAudioScopeSet = new Set(dockedScopes.filter(isAudioScopeKind))
    audioRouter.setVisualizerConsumerDemand('docked-strip', {
      spectrum: visibleAudioScopeSet.has('spectrum'),
      oscilloscope: visibleAudioScopeSet.has('oscilloscope'),
      vectorscope: visibleAudioScopeSet.has('vectorscope'),
      spectrogram: visibleAudioScopeSet.has('spectrogram'),
      vumeter: visibleAudioScopeSet.has('vumeter'),
      lufsmeter: visibleAudioScopeSet.has('lufsmeter'),
      waveform: visibleAudioScopeSet.has('waveform'),
    })

    return () => {
      audioRouter.clearVisualizerConsumerDemand('docked-strip')
    }
  }, [visibleScopeKey, dockedScopes])

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

    for (const scope of dockedScopes) {
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
  }, [dockedScopes, gridTemplateColumns, updateHandleOffsets])

  const startResizeDrag = useCallback((handleIndex: number, event: React.MouseEvent<HTMLButtonElement>) => {
    const leftKind = dockedScopes[handleIndex]
    const rightKind = dockedScopes[handleIndex + 1]
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
  }, [dockedScopes, setScopeWidthWeight])

  const handlePopoutScope = useCallback(async (kind: ScopeKind): Promise<void> => {
    const element = scopeRefs.current[kind]
    const rect = element?.getBoundingClientRect()
    const windowBounds = await window.electronAPI.getWindowBounds()

    let nextBounds: WindowBounds | undefined
    if (rect && windowBounds) {
      nextBounds = {
        x: Math.round(windowBounds.x + rect.left),
        y: Math.round(windowBounds.y + rect.top),
        width: Math.max(220, Math.round(rect.width)),
        height: Math.max(160, Math.round(rect.height)),
      }
    }

    popOutScope(kind, nextBounds)
  }, [popOutScope])

  return (
    <div ref={stripRef} className="scope-strip">
      <div ref={gridRef} className="scope-strip__grid" style={gridStyle}>
        {dockedScopes.map((kind, index) => (
          <div
            key={kind}
            ref={(element) => {
              scopeRefs.current[kind] = element
            }}
            className="scope-strip__cell"
          >
            {dockedScopes.length > 1 && (
              <div className="scope-strip__reorder-controls">
                <button
                  type="button"
                  className="scope-strip__reorder-button"
                  onClick={() => moveDockedScope(kind, 'left')}
                  aria-label={`Move ${SCOPE_LABELS[kind]} left`}
                  title={`Move ${SCOPE_LABELS[kind]} left`}
                  disabled={index === 0}
                >
                  <span className="scope-strip__reorder-icon" aria-hidden="true">
                    &#8592;
                  </span>
                </button>
                <button
                  type="button"
                  className="scope-strip__reorder-button"
                  onClick={() => moveDockedScope(kind, 'right')}
                  aria-label={`Move ${SCOPE_LABELS[kind]} right`}
                  title={`Move ${SCOPE_LABELS[kind]} right`}
                  disabled={index === dockedScopes.length - 1}
                >
                  <span className="scope-strip__reorder-icon" aria-hidden="true">
                    &#8594;
                  </span>
                </button>
              </div>
            )}
            <button
              type="button"
              className="scope-strip__popout-button"
              onClick={() => {
                void handlePopoutScope(kind)
              }}
              aria-label={`Pop out ${SCOPE_LABELS[kind]}`}
              title={`Pop out ${SCOPE_LABELS[kind]}`}
            >
              <span className="scope-strip__popout-icon" aria-hidden="true">
                &#8599;
              </span>
            </button>
            <ScopeModule
              scopeKind={kind}
              frameScheduler={frameScheduler}
            />
          </div>
        ))}
      </div>

      {dockedScopes.length > 1 && handleOffsets.map((offset, index) => (
        <button
          key={`${dockedScopes[index]}:${dockedScopes[index + 1]}`}
          type="button"
          className="scope-strip__resize-handle"
          style={{ left: `${offset}px` }}
          onMouseDown={(event) => startResizeDrag(index, event)}
          aria-label={`Resize between ${dockedScopes[index]} and ${dockedScopes[index + 1]}`}
        >
          <span className="scope-strip__resize-handle-grip" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

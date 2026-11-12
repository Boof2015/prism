import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { SCOPE_LABELS, isAudioScopeKind, type ScopeKind } from '../../types/scope'
import type { WindowBounds } from '../../types/popout'
import ScopeModule from './ScopeModule'
import { audioRouter } from '../audio/AudioRouter'
import { usePerformanceStore } from '../stores/performanceStore'
import { FrameScheduler } from '../visualizers/frameScheduler'
import { getRendererWindowCapabilities } from '../windowCapabilities'
import { getScopePopoutMinWidth } from '../../shared/scopeSizing'
import type { LinkedAnalysisMessage, LinkedAnalysisProbe } from '../../types/analysis'
import { useModuleInstanceStore, type ModuleInstance } from '../stores/moduleInstanceStore'
import { createScopeInstanceDataSource } from '../audio/scopeInstanceDataSource'
import PitchMeter from './PitchMeter'
import type { PitchSettings } from '../../types/moduleInstance'
import { useScopeChannelStore } from '../stores/scopeChannelStore'

function DuplicateScope({ instance, frameScheduler }: { instance: ModuleInstance; frameScheduler: FrameScheduler }): JSX.Element {
  const dataSource = useMemo(
    () => createScopeInstanceDataSource(instance.kind, instance.channelPairLeft),
    [instance.id, instance.kind],
  )
  useEffect(() => () => dataSource.dispose(), [dataSource])
  useEffect(() => dataSource.setChannelPair(instance.channelPairLeft ?? null), [dataSource, instance.channelPairLeft])
  if (instance.kind === 'pitch') return <PitchMeter settings={instance.settings as PitchSettings} frameScheduler={frameScheduler} dataSource={dataSource} />
  return <ScopeModule scopeKind={instance.kind} settings={instance.settings as never} frameScheduler={frameScheduler} dataSource={dataSource} />
}

function PrimaryPitch({ settings, frameScheduler, channelPairLeft }: { settings: PitchSettings; frameScheduler: FrameScheduler; channelPairLeft?: number }): JSX.Element {
  const dataSource = useMemo(() => createScopeInstanceDataSource('pitch', channelPairLeft), [])
  useEffect(() => () => dataSource.dispose(), [dataSource])
  useEffect(() => dataSource.setChannelPair(channelPairLeft ?? null), [channelPairLeft, dataSource])
  return <PitchMeter settings={settings} frameScheduler={frameScheduler} dataSource={dataSource} />
}

interface StripProps {
  onMeasurementActiveChange?: (active: boolean) => void
  linkedAnalysisEnabled?: boolean
  linkedAnalysisProbe?: LinkedAnalysisProbe | null
  onLinkedAnalysisMessage?: (message: LinkedAnalysisMessage) => void
}

export default function Strip({
  onMeasurementActiveChange,
  linkedAnalysisEnabled = false,
  linkedAnalysisProbe = null,
  onLinkedAnalysisMessage,
}: StripProps): JSX.Element {
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopePopouts = useSettingsStore((s) => s.scopePopouts)
  const moduleInstances = useModuleInstanceStore((s) => s.instances)
  const removeModuleInstance = useModuleInstanceStore((s) => s.removeInstance)
  const workspaceOrder = useSettingsStore((s) => s.workspaceOrder)
  const setWorkspaceOrder = useSettingsStore((s) => s.setWorkspaceOrder)
  const workspaceSpans = useSettingsStore((s) => s.workspaceSpans)
  const setWorkspaceSpan = useSettingsStore((s) => s.setWorkspaceSpan)
  const scopeSettings = useSettingsStore((s) => s.scopeSettings)
  const pitchChannelPair = useScopeChannelStore((s) => s.pairs.pitch)
  const moveDockedScope = useSettingsStore((s) => s.moveDockedScope)
  const setScopeWidthWeight = useSettingsStore((s) => s.setScopeWidthWeight)
  const popOutScope = useSettingsStore((s) => s.popOutScope)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)
  const setDockedRenderFps = usePerformanceStore((s) => s.setDockedRenderFps)
  const frameScheduler = useMemo(() => new FrameScheduler({ frameTarget }), [])
  const stripRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scopeRefs = useRef<Partial<Record<ScopeKind, HTMLDivElement | null>>>({})
  const activeMeasurementScopesRef = useRef(new Set<ScopeKind>())
  const [handleOffsets, setHandleOffsets] = useState<number[]>([])
  const supportsGeometryPersistence = getRendererWindowCapabilities().supportsGeometryPersistence
  const dockedScopes = useMemo(
    () => scopeOrder.filter((k) => !hiddenScopes.has(k) && !scopePopouts[k]?.poppedOut),
    [hiddenScopes, scopeOrder, scopePopouts],
  )
  const visibleScopeKey = useMemo(() => dockedScopes.join('|'), [dockedScopes])
  const workspaceKeys = useMemo(() => {
    const available = [...dockedScopes.map((kind) => `scope:${kind}`), ...moduleInstances.map((item) => `instance:${item.id}`)]
    return [...workspaceOrder.filter((key) => available.includes(key)), ...available.filter((key) => !workspaceOrder.includes(key))]
  }, [dockedScopes, moduleInstances, workspaceOrder])
  const workspacePosition = useMemo(() => new Map(workspaceKeys.map((key, index) => [key, index])), [workspaceKeys])
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const moveWorkspaceTile = useCallback((targetKey: string) => {
    if (!draggingKey || draggingKey === targetKey) return
    const next = workspaceKeys.filter((key) => key !== draggingKey)
    next.splice(Math.max(0, next.indexOf(targetKey)), 0, draggingKey)
    if (next.every((key, index) => key === workspaceKeys[index])) return
    setWorkspaceOrder(next)
  }, [draggingKey, setWorkspaceOrder, workspaceKeys])

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
    const visibleAudioScopeSet = new Set([...dockedScopes.filter(isAudioScopeKind), ...moduleInstances.map((item) => item.kind)])
    audioRouter.setVisualizerConsumerDemand('docked-strip', {
      waterfall: visibleAudioScopeSet.has('waterfall'),
      spectrum: visibleAudioScopeSet.has('spectrum'),
      oscilloscope: visibleAudioScopeSet.has('oscilloscope'),
      vectorscope: visibleAudioScopeSet.has('vectorscope'),
      spectrogram: visibleAudioScopeSet.has('spectrogram'),
      vumeter: visibleAudioScopeSet.has('vumeter'),
      pitch: false,
      lufsmeter: visibleAudioScopeSet.has('lufsmeter'),
      waveform: visibleAudioScopeSet.has('waveform'),
    })

    return () => {
      audioRouter.clearVisualizerConsumerDemand('docked-strip')
    }
  }, [visibleScopeKey, dockedScopes, moduleInstances])

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
  }, [dockedScopes, updateHandleOffsets])

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
    if (!supportsGeometryPersistence) {
      popOutScope(kind)
      return
    }

    const element = scopeRefs.current[kind]
    const rect = element?.getBoundingClientRect()
    const windowBounds = await window.electronAPI.getWindowBounds()

    let nextBounds: WindowBounds | undefined
    if (rect && windowBounds) {
      nextBounds = {
        x: Math.round(windowBounds.x + rect.left),
        y: Math.round(windowBounds.y + rect.top),
        width: Math.max(getScopePopoutMinWidth(kind), Math.round(rect.width)),
        height: Math.max(160, Math.round(rect.height)),
      }
    }

    popOutScope(kind, nextBounds)
  }, [popOutScope, supportsGeometryPersistence])

  const handleScopeMeasurementActiveChange = useCallback((kind: ScopeKind, active: boolean): void => {
    if (active) {
      activeMeasurementScopesRef.current.add(kind)
    } else {
      activeMeasurementScopesRef.current.delete(kind)
    }
    onMeasurementActiveChange?.(activeMeasurementScopesRef.current.size > 0)
  }, [onMeasurementActiveChange])

  return (
    <div ref={stripRef} className="scope-strip">
      <div ref={gridRef} className="scope-strip__grid">
        {dockedScopes.map((kind, index) => (
          <div
            key={kind}
            ref={(element) => {
              scopeRefs.current[kind] = element
            }}
            className="scope-strip__cell"
            style={{ order: workspacePosition.get(`scope:${kind}`) ?? index, gridColumn: `span ${workspaceSpans[`scope:${kind}`]?.columns ?? 1}`, gridRow: `span ${workspaceSpans[`scope:${kind}`]?.rows ?? 1}` }}
            onDragOver={(event) => { event.preventDefault(); moveWorkspaceTile(`scope:${kind}`) }}
          >
            <button type="button" draggable className="scope-strip__drag-button" title="Drag module" onDragStart={() => setDraggingKey(`scope:${kind}`)} onDragEnd={() => setDraggingKey(null)}>⠿</button>
            <button type="button" className="scope-strip__span-button scope-strip__span-button--width" title="Cycle width" onClick={() => { const span = workspaceSpans[`scope:${kind}`] ?? { columns: 1, rows: 1 }; setWorkspaceSpan(`scope:${kind}`, span.columns % 3 + 1, span.rows) }}>W{workspaceSpans[`scope:${kind}`]?.columns ?? 1}</button>
            <button type="button" className="scope-strip__span-button scope-strip__span-button--height" title="Cycle height" onClick={() => { const span = workspaceSpans[`scope:${kind}`] ?? { columns: 1, rows: 1 }; setWorkspaceSpan(`scope:${kind}`, span.columns, span.rows % 3 + 1) }}>H{workspaceSpans[`scope:${kind}`]?.rows ?? 1}</button>
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
            {kind !== 'pitch' && <button
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
            </button>}
            {kind === 'pitch' ? <PrimaryPitch settings={scopeSettings.pitch} frameScheduler={frameScheduler} channelPairLeft={pitchChannelPair} /> : <ScopeModule
              scopeKind={kind}
              frameScheduler={frameScheduler}
              onMeasurementActiveChange={(active) => handleScopeMeasurementActiveChange(kind, active)}
              linkedAnalysisEnabled={linkedAnalysisEnabled}
              linkedAnalysisProbe={linkedAnalysisProbe}
              onLinkedAnalysisMessage={onLinkedAnalysisMessage}
            />}
          </div>
        ))}
        {moduleInstances.map((instance, index) => (
          <div key={instance.id} className="scope-strip__cell" style={{ order: workspacePosition.get(`instance:${instance.id}`) ?? dockedScopes.length + index, gridColumn: `span ${workspaceSpans[`instance:${instance.id}`]?.columns ?? 1}`, gridRow: `span ${workspaceSpans[`instance:${instance.id}`]?.rows ?? 1}` }} onDragOver={(event) => { event.preventDefault(); moveWorkspaceTile(`instance:${instance.id}`) }}>
            <button type="button" draggable className="scope-strip__drag-button" title="Drag module" onDragStart={() => setDraggingKey(`instance:${instance.id}`)} onDragEnd={() => setDraggingKey(null)}>⠿</button>
            <button type="button" className="scope-strip__span-button scope-strip__span-button--width" title="Cycle width" onClick={() => { const key = `instance:${instance.id}`; const span = workspaceSpans[key] ?? { columns: 1, rows: 1 }; setWorkspaceSpan(key, span.columns % 3 + 1, span.rows) }}>W{workspaceSpans[`instance:${instance.id}`]?.columns ?? 1}</button>
            <button type="button" className="scope-strip__span-button scope-strip__span-button--height" title="Cycle height" onClick={() => { const key = `instance:${instance.id}`; const span = workspaceSpans[key] ?? { columns: 1, rows: 1 }; setWorkspaceSpan(key, span.columns, span.rows % 3 + 1) }}>H{workspaceSpans[`instance:${instance.id}`]?.rows ?? 1}</button>
            <button
              type="button"
              className="scope-strip__popout-button"
              onClick={() => removeModuleInstance(instance.id)}
              aria-label={`Remove ${instance.kind === 'pitch' ? 'Pitch' : SCOPE_LABELS[instance.kind]} ${index + 2}`}
              title="Remove module"
            >
              <span className="scope-strip__popout-icon" aria-hidden="true">×</span>
            </button>
            <DuplicateScope instance={instance} frameScheduler={frameScheduler} />
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

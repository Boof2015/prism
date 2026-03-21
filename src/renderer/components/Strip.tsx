import { Fragment, useCallback, useRef, type JSX } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import type { ScopeKind } from '../../types/scope'
import ScopeModule from './ScopeModule'

function ResizeHandle({ leftKind, rightKind }: { leftKind: ScopeKind; rightKind: ScopeKind }): JSX.Element {
  const setScopeWidthWeight = useSettingsStore((s) => s.setScopeWidthWeight)
  const handleRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const container = handleRef.current?.parentElement
    if (!container) return

    const totalWidth = container.getBoundingClientRect().width
    const { widthWeights } = useSettingsStore.getState()
    const startLeftWeight = widthWeights[leftKind] ?? 1
    const startRightWeight = widthWeights[rightKind] ?? 1
    const totalWeight = startLeftWeight + startRightWeight

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const ratio = delta / totalWidth * totalWeight * 2
      const newLeft = Math.max(0.15, startLeftWeight + ratio)
      const newRight = Math.max(0.15, startRightWeight - ratio)
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
  }, [leftKind, rightKind, setScopeWidthWeight])

  return (
    <div ref={handleRef} onMouseDown={onMouseDown} className="scope-strip__handle">
      <div className="scope-strip__handle-line" />
    </div>
  )
}

export default function Strip(): JSX.Element {
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const widthWeights = useSettingsStore((s) => s.widthWeights)
  const accent = useThemeStore((s) => s.accent)

  const visibleScopes = scopeOrder.filter((k) => !hiddenScopes.has(k))

  return (
    <div className="scope-strip">
      {visibleScopes.map((kind, i) => (
        <Fragment key={kind}>
          {i > 0 && (
            <ResizeHandle leftKind={visibleScopes[i - 1]} rightKind={kind} />
          )}
          <ScopeModule
            scopeKind={kind}
            lineColor={accent}
            widthWeight={widthWeights[kind] ?? 1}
          />
        </Fragment>
      ))}
    </div>
  )
}

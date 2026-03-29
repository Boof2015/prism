import { useCallback, useEffect, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { RESIZE_DIRECTIONS, type ResizeDirection } from '../../types/windowResize'

const RESIZE_HANDLE_CLASSNAMES: Record<ResizeDirection, string> = {
  n: 'window-resize-overlay__handle window-resize-overlay__handle--n',
  s: 'window-resize-overlay__handle window-resize-overlay__handle--s',
  e: 'window-resize-overlay__handle window-resize-overlay__handle--e',
  w: 'window-resize-overlay__handle window-resize-overlay__handle--w',
  ne: 'window-resize-overlay__handle window-resize-overlay__handle--ne',
  nw: 'window-resize-overlay__handle window-resize-overlay__handle--nw',
  se: 'window-resize-overlay__handle window-resize-overlay__handle--se',
  sw: 'window-resize-overlay__handle window-resize-overlay__handle--sw',
}

export default function WindowResizeOverlay(): JSX.Element | null {
  const isWindows = window.electronAPI.platform === 'win32'

  const stopResize = useCallback(() => {
    window.electronAPI.stopWindowResize()
  }, [])

  useEffect(() => {
    if (!isWindows) return

    window.addEventListener('blur', stopResize)
    return () => {
      window.removeEventListener('blur', stopResize)
      stopResize()
    }
  }, [isWindows, stopResize])

  const handlePointerDown = useCallback((direction: ResizeDirection) => {
    return (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      window.electronAPI.startWindowResize(direction)
    }
  }, [])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    stopResize()
  }, [stopResize])

  if (!isWindows) return null

  return (
    <div className="window-resize-overlay" aria-hidden="true">
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={RESIZE_HANDLE_CLASSNAMES[direction]}
          onPointerDown={handlePointerDown(direction)}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
        />
      ))}
    </div>
  )
}

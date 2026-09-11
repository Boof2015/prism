import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUiStore } from '../stores/uiStore'

/** The parent owns these controls and stores; the child is only a DOM surface. */
export default function DockedSettingsPortal({ children }: { children: ReactNode }): ReactNode {
  const childRef = useRef<Window | null>(null)
  const lifetime = useRef(0)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const generation = ++lifetime.current
    let child = childRef.current
    if (!child || child.closed) {
      child = window.open('about:blank', 'prism-docked-settings')
      childRef.current = child
    }
    if (!child) {
      useUiStore.getState().setSettingsOpen(false)
      useUiStore.getState().showBanner({ tone: 'error', message: 'Prism could not open docked settings.', actions: [] })
      return
    }
    const panelWindow = child
    const panelDocument = child.document
    panelDocument.title = 'Prism settings'
    let root = panelDocument.getElementById('docked-settings')
    if (!root) {
      const base = panelDocument.createElement('base')
      base.href = document.baseURI
      panelDocument.head.appendChild(base)
      root = panelDocument.createElement('div')
      root.id = 'docked-settings'
      root.className = 'docked-settings'
      panelDocument.body.appendChild(root)
    }
    const copyStyles = (): void => {
      panelDocument.querySelectorAll('[data-prism-copied-style]').forEach(node => node.remove())
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
        const copy = node.cloneNode(true) as HTMLElement
        copy.setAttribute('data-prism-copied-style', '')
        panelDocument.head.appendChild(copy)
      })
    }
    const copyTheme = (): void => {
      panelDocument.documentElement.style.cssText = document.documentElement.style.cssText
      panelDocument.documentElement.dataset.windowBg = 'solid'
    }
    copyStyles()
    copyTheme()
    const styles = new MutationObserver(copyStyles)
    styles.observe(document.head, { childList: true, subtree: true, characterData: true })
    const theme = new MutationObserver(copyTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    let disposed = false
    let frame = 0
    const fail = (): void => {
      if (disposed) return
      useUiStore.getState().setSettingsOpen(false)
      useUiStore.getState().showBanner({ tone: 'error', message: 'Prism could not show docked settings.', actions: [] })
    }
    const resize = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!disposed && !panelWindow.closed && root) {
          // Measure natural content, not the clamped/scrolled viewport.
          const content = root.firstElementChild as HTMLElement | null
          const height = content?.scrollHeight ?? root.scrollHeight
          void window.electronAPI.docking.showSettings(height).then(shown => { if (!shown) fail() }).catch(fail)
        }
      })
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(root)
    const contentObserver = new MutationObserver(resize)
    contentObserver.observe(root, { subtree: true, childList: true, attributes: true })
    setContainer(root)
    void panelDocument.fonts.ready.then(resize)
    resize()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      styles.disconnect()
      theme.disconnect()
      resizeObserver.disconnect()
      contentObserver.disconnect()
      // React StrictMode immediately remounts effects. Reuse its child window.
      queueMicrotask(() => {
        if (lifetime.current === generation && !panelWindow.closed) panelWindow.close()
      })
    }
  }, [])

  return container ? createPortal(<div className="docked-settings__content">{children}</div>, container) : null
}

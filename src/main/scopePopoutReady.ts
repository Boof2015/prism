interface ReadyPopoutWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  show(): void
}

/** Renderer readiness does not depend on a hidden Wayland window being painted. */
export function showReadyScopePopout(window: ReadyPopoutWindow, appHiddenToTray: boolean): boolean {
  if (window.isDestroyed() || appHiddenToTray || window.isVisible()) return false
  window.show()
  return true
}

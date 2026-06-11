import { normalizeWindowBackgroundState } from '../shared/windowState'
import type { WindowBackgroundState } from '../types/windowState'

export function windowBackgroundAlpha(state: WindowBackgroundState): number {
  if (state.mode === 'solid') return 1
  return 1 - state.transparency / 100
}

export function applyWindowBackgroundToDocument(state: WindowBackgroundState): void {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.windowBg = state.mode
  document.documentElement.style.setProperty(
    '--window-bg-alpha',
    String(windowBackgroundAlpha(state)),
  )
}

// The main process appends the effective background to the renderer URL so the
// very first paint matches the window's compositing mode (no flash of opaque
// black on a transparent window or vice versa).
export function readWindowBackgroundFromQuery(search: string): WindowBackgroundState | null {
  const params = new URLSearchParams(search)
  const mode = params.get('bg')
  if (!mode) return null

  return normalizeWindowBackgroundState({
    mode,
    transparency: Number(params.get('bgt')),
  })
}

export function bootstrapWindowBackgroundFromQuery(): void {
  const state = readWindowBackgroundFromQuery(window.location.search)
  if (state) {
    applyWindowBackgroundToDocument(state)
  }
}

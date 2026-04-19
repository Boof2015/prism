import { DEFAULT_WINDOW_CAPABILITIES, resolveWindowCapabilities } from '../shared/windowCapabilities'
import type { WindowCapabilities } from '../types/windowCapabilities'

export function getRendererWindowCapabilities(): WindowCapabilities {
  if (typeof window === 'undefined' || typeof window.electronAPI === 'undefined') {
    return { ...DEFAULT_WINDOW_CAPABILITIES }
  }

  if (window.electronAPI.windowCapabilities) {
    return window.electronAPI.windowCapabilities
  }

  return resolveWindowCapabilities({ platform: window.electronAPI.platform })
}

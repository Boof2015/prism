import { create } from 'zustand'
import { createDefaultWindowBackgroundState } from '../../shared/windowState'
import type { WindowBackgroundState } from '../../types/windowState'
import {
  applyWindowBackgroundToDocument,
  readWindowBackgroundFromQuery,
  windowBackgroundAlpha,
} from '../windowBackground'

interface WindowBackgroundStoreState {
  /** The user's stored choice (shown in the settings UI). */
  stored: WindowBackgroundState
  /** What the window is actually compositing with after capability downgrades. */
  effective: WindowBackgroundState
  initialize: () => Promise<void>
  /** Apply locally without persisting — used while dragging the slider. */
  previewBackground: (state: WindowBackgroundState) => void
  setBackground: (state: WindowBackgroundState) => Promise<void>
}

function canUseElectronAPI(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function initialEffectiveState(): WindowBackgroundState {
  if (typeof window !== 'undefined') {
    const fromQuery = readWindowBackgroundFromQuery(window.location.search)
    if (fromQuery) return fromQuery
  }
  return createDefaultWindowBackgroundState()
}

let subscribed = false

export const useWindowBackgroundStore = create<WindowBackgroundStoreState>((set, get) => ({
  stored: initialEffectiveState(),
  effective: initialEffectiveState(),

  initialize: async () => {
    if (!canUseElectronAPI()) return

    if (!subscribed) {
      subscribed = true
      window.electronAPI.onWindowBackgroundChanged((snapshot) => {
        applyWindowBackgroundToDocument(snapshot.effective)
        set({ stored: snapshot.stored, effective: snapshot.effective })
      })
    }

    const snapshot = await window.electronAPI.getWindowBackground()
    applyWindowBackgroundToDocument(snapshot.effective)
    set({ stored: snapshot.stored, effective: snapshot.effective })
  },

  previewBackground: (next: WindowBackgroundState) => {
    // Only preview when the compositing mode is unchanged — mode switches are
    // driven by the main process (runtime material swap or window recreation).
    if (next.mode === get().effective.mode) {
      applyWindowBackgroundToDocument(next)
    }
    set({ stored: next })
  },

  setBackground: async (next: WindowBackgroundState) => {
    if (!canUseElectronAPI()) return

    get().previewBackground(next)

    try {
      const snapshot = await window.electronAPI.setWindowBackground(next)
      applyWindowBackgroundToDocument(snapshot.effective)
      set({ stored: snapshot.stored, effective: snapshot.effective })
    } catch {
      // Entering/leaving clear mode recreates this window, which can reject
      // the invoke mid-flight — the fresh window reads the new state itself.
    }
  },
}))

export function useWindowBackgroundAlpha(): number {
  return useWindowBackgroundStore((state) => windowBackgroundAlpha(state.effective))
}

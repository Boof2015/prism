import { create } from 'zustand'
import { normalizeWindowDocking } from '../../shared/windowDocking'
import type { WindowDockingSnapshot } from '../../types/windowDocking'

export const useWindowDockingStore = create<WindowDockingSnapshot>(() => ({
  ...normalizeWindowDocking(undefined), supported: false, active: false, error: null,
}))

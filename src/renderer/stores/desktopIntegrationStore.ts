import { create } from 'zustand'
import type {
  DesktopIntegrationSnapshot,
  LoginLaunchMode,
} from '../../types/desktopIntegration'

const DEFAULT_SNAPSHOT: DesktopIntegrationSnapshot = {
  closeToTray: false,
  openAtLogin: false,
  loginLaunchMode: 'show',
  loginItemStatus: 'unavailable',
  loginItemError: null,
}

interface DesktopIntegrationState {
  snapshot: DesktopIntegrationSnapshot
  initialized: boolean
  busy: boolean
  error: string | null
  initialize: () => Promise<void>
  applySnapshot: (snapshot: DesktopIntegrationSnapshot) => void
  setCloseToTray: (enabled: boolean) => Promise<void>
  setOpenAtLogin: (enabled: boolean) => Promise<void>
  setLoginLaunchMode: (mode: LoginLaunchMode) => Promise<void>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Could not update desktop integration settings.'
}

export const useDesktopIntegrationStore = create<DesktopIntegrationState>((set) => {
  const applyResult = (snapshot: DesktopIntegrationSnapshot): void => {
    set({
      snapshot,
      initialized: true,
      busy: false,
      error: snapshot.loginItemError,
    })
  }

  const runMutation = async (
    operation: () => Promise<DesktopIntegrationSnapshot>,
  ): Promise<void> => {
    set({ busy: true, error: null })
    try {
      applyResult(await operation())
    } catch (error) {
      set({ busy: false, error: getErrorMessage(error) })
    }
  }

  return {
    snapshot: DEFAULT_SNAPSHOT,
    initialized: false,
    busy: false,
    error: null,

    initialize: async () => {
      try {
        applyResult(await window.electronAPI.desktopIntegration.get())
      } catch (error) {
        set({ initialized: true, error: getErrorMessage(error) })
      }
    },

    applySnapshot: (snapshot) => {
      applyResult(snapshot)
    },

    setCloseToTray: async (enabled) => {
      await runMutation(() => window.electronAPI.desktopIntegration.setCloseToTray(enabled))
    },

    setOpenAtLogin: async (enabled) => {
      await runMutation(() => window.electronAPI.desktopIntegration.setOpenAtLogin(enabled))
    },

    setLoginLaunchMode: async (mode) => {
      await runMutation(() => window.electronAPI.desktopIntegration.setLoginLaunchMode(mode))
    },
  }
})

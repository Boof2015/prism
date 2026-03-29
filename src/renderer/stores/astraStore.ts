import { create } from 'zustand'
import {
  DEFAULT_ASTRA_BASE_URL,
  type AstraControlCommand,
  type AstraIntegrationConfig,
  type AstraIntegrationState,
} from '../../types/astra'

interface AstraStoreState {
  initialized: boolean
  integrationState: AstraIntegrationState
  isSendingControl: boolean
  initialize: () => Promise<void>
  saveConfig: (config: AstraIntegrationConfig) => Promise<void>
  setScopeActive: (active: boolean) => Promise<void>
  sendControl: (command: AstraControlCommand) => Promise<void>
  applyExternalState: (state: AstraIntegrationState) => void
}

function createDefaultIntegrationState(): AstraIntegrationState {
  return {
    config: {
      baseUrl: DEFAULT_ASTRA_BASE_URL,
      token: '',
    },
    connectionState: 'disabled',
    lastError: null,
    lastControlError: null,
    snapshot: null,
  }
}

let initializePromise: Promise<void> | null = null
let syncBound = false

export const useAstraStore = create<AstraStoreState>((set) => ({
  initialized: false,
  integrationState: createDefaultIntegrationState(),
  isSendingControl: false,

  initialize: async () => {
    if (initializePromise) {
      await initializePromise
      return
    }

    initializePromise = (async () => {
      if (typeof window === 'undefined' || typeof window.electronAPI === 'undefined') {
        set({ initialized: true })
        return
      }

      const state = await window.electronAPI.getAstraState()
      set({
        initialized: true,
        integrationState: state,
      })
    })()

    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  },

  saveConfig: async (config) => {
    const savedConfig = await window.electronAPI.saveAstraConfig(config)
    const nextState = await window.electronAPI.getAstraState()
    set({
      integrationState: {
        ...nextState,
        config: savedConfig,
      },
    })
  },

  setScopeActive: async (active) => {
    const nextState = await window.electronAPI.setAstraActive(active)
    set({
      integrationState: nextState,
    })
  },

  sendControl: async (command) => {
    set({ isSendingControl: true })
    try {
      const nextState = await window.electronAPI.sendAstraControl(command)
      set({
        integrationState: nextState,
      })
    } finally {
      set({ isSendingControl: false })
    }
  },

  applyExternalState: (state) => {
    set({
      initialized: true,
      integrationState: state,
    })
  },
}))

function bindAstraStateSync(): void {
  if (syncBound || typeof window === 'undefined' || typeof window.electronAPI === 'undefined') {
    return
  }

  syncBound = true
  window.electronAPI.onAstraStateChanged((state) => {
    useAstraStore.getState().applyExternalState(state)
  })
}

bindAstraStateSync()

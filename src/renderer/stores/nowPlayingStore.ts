import { create } from 'zustand'
import {
  NOW_PLAYING_PROVIDER_DEFINITIONS,
  NOW_PLAYING_PROVIDER_IDS,
  type NowPlayingControlCommand,
  type NowPlayingProviderConfigMutationMap,
  type NowPlayingProviderId,
  type NowPlayingProviderStateMap,
  type NowPlayingState,
} from '../../types/nowPlaying'

interface NowPlayingStoreState {
  initialized: boolean
  nowPlayingState: NowPlayingState
  isSendingControl: boolean
  initialize: () => Promise<void>
  setConsumerActive: (active: boolean) => Promise<void>
  saveProviderConfig: <K extends NowPlayingProviderId>(providerId: K, config: NowPlayingProviderConfigMutationMap[K]) => Promise<void>
  setProviderPriority: (providerPriority: NowPlayingProviderId[]) => Promise<void>
  retryProvider: (providerId: NowPlayingProviderId) => Promise<void>
  sendControl: (command: NowPlayingControlCommand) => Promise<void>
  openConfigWindow: () => Promise<void>
  applyExternalState: (state: NowPlayingState) => void
}

function createDefaultProviderStates(): NowPlayingProviderStateMap {
  return NOW_PLAYING_PROVIDER_IDS.reduce((acc, providerId) => {
    const definition = NOW_PLAYING_PROVIDER_DEFINITIONS[providerId]
    acc[providerId] = {
      providerId,
      connectionState: definition.available ? 'disabled' : 'unavailable',
      lastError: null,
      lastControlError: null,
      snapshot: null,
      isConfigured: false,
      available: definition.available,
      supportsTransportControls: definition.supportsTransportControls,
    }
    return acc
  }, {} as NowPlayingProviderStateMap)
}

function createDefaultNowPlayingState(): NowPlayingState {
  return {
    definitions: NOW_PLAYING_PROVIDER_DEFINITIONS,
    configs: {
      astra: {
        baseUrl: 'http://127.0.0.1:38401',
        hasToken: false,
      },
      spotify: {},
      tidal: {},
    },
    providers: createDefaultProviderStates(),
    providerPriority: [...NOW_PLAYING_PROVIDER_IDS],
    activeProviderId: null,
    hasConfiguredProvider: false,
    onboardingRequired: true,
  }
}

let initializePromise: Promise<void> | null = null
let syncBound = false

export const useNowPlayingStore = create<NowPlayingStoreState>((set) => ({
  initialized: false,
  nowPlayingState: createDefaultNowPlayingState(),
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

      const state = await window.electronAPI.getNowPlayingState()
      set({
        initialized: true,
        nowPlayingState: state,
      })
    })()

    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  },

  setConsumerActive: async (active) => {
    const state = await window.electronAPI.setNowPlayingConsumerActive(active)
    set({
      initialized: true,
      nowPlayingState: state,
    })
  },

  saveProviderConfig: async (providerId, config) => {
    const state = await window.electronAPI.saveNowPlayingProviderConfig(providerId, config)
    set({
      initialized: true,
      nowPlayingState: state,
    })
  },

  setProviderPriority: async (providerPriority) => {
    const state = await window.electronAPI.setNowPlayingProviderPriority(providerPriority)
    set({
      initialized: true,
      nowPlayingState: state,
    })
  },

  retryProvider: async (providerId) => {
    const state = await window.electronAPI.retryNowPlayingProvider(providerId)
    set({
      initialized: true,
      nowPlayingState: state,
    })
  },

  sendControl: async (command) => {
    set({ isSendingControl: true })
    try {
      const state = await window.electronAPI.sendNowPlayingControl(command)
      set({
        initialized: true,
        nowPlayingState: state,
      })
    } finally {
      set({ isSendingControl: false })
    }
  },

  openConfigWindow: async () => {
    await window.electronAPI.openNowPlayingConfigWindow()
  },

  applyExternalState: (state) => {
    set({
      initialized: true,
      nowPlayingState: state,
    })
  },
}))

function bindNowPlayingStateSync(): void {
  if (syncBound || typeof window === 'undefined' || typeof window.electronAPI === 'undefined') {
    return
  }

  syncBound = true
  window.electronAPI.onNowPlayingStateChanged((state) => {
    useNowPlayingStore.getState().applyExternalState(state)
  })
}

bindNowPlayingStateSync()

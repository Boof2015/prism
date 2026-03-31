import { create } from 'zustand'

export type UiBannerTone = 'info' | 'error'

export interface UiBannerAction {
  label: string
  onSelect?: () => void | Promise<void>
  dismissOnSelect?: boolean
}

export interface UiBanner {
  id: number
  tone: UiBannerTone
  message: string
  actions: UiBannerAction[]
}

interface UiStoreState {
  settingsOpen: boolean
  banner: UiBanner | null
  setSettingsOpen: (open: boolean) => void
  toggleSettings: () => void
  showBanner: (banner: Omit<UiBanner, 'id'>) => void
  dismissBanner: (bannerId?: number) => void
}

let nextBannerId = 1

export const useUiStore = create<UiStoreState>((set) => ({
  settingsOpen: false,
  banner: null,

  setSettingsOpen: (open) => {
    set({ settingsOpen: open })
  },

  toggleSettings: () => {
    set((state) => ({ settingsOpen: !state.settingsOpen }))
  },

  showBanner: (banner) => {
    set({
      banner: {
        ...banner,
        id: nextBannerId++,
      },
    })
  },

  dismissBanner: (bannerId) => {
    set((state) => {
      if (bannerId && state.banner?.id !== bannerId) {
        return state
      }

      return { banner: null }
    })
  },
}))

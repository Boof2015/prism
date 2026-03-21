/// <reference types="vite/client" />

import type { VisualizerDSP } from './audio/native/visualizer-dsp'

declare global {
  interface Window {
    visualizerAPI: VisualizerDSP | null
    electronAPI: {
      platform: string
      minimize: () => void
      close: () => void
      toggleAlwaysOnTop: () => void
      isAlwaysOnTop: () => Promise<boolean>
      getDesktopSources: () => Promise<{ id: string; name: string }[]>
      expandSettings: (panelHeight: number) => void
      collapseSettings: (panelHeight: number) => void
      onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => () => void
    }
  }
}

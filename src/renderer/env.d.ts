/// <reference types="vite/client" />

import type { VisualizerDSP } from './audio/native/visualizer-dsp'
import type { CaptureBackendSupport } from '../types/capture'

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
      getCaptureBackendSupport: () => Promise<CaptureBackendSupport>
      expandSettings: (panelHeight: number) => void
      collapseSettings: (panelHeight: number) => void
      setSettingsHeight: (panelHeight: number) => void
      onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => () => void
      onToggleScope: (callback: (index: number) => void) => () => void
      onToggleCapture: (callback: () => void) => () => void
      onToggleSettings: (callback: () => void) => () => void
    }
  }
}

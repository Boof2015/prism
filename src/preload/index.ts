import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureBackendSupport, CaptureBackendSupportEntry } from '../types/capture'
import type { NativeCaptureAPI } from '../types/nativeCapture'
import type { VisualizerDSP } from '../renderer/audio/native/visualizer-dsp'

type NativeAddonModule = VisualizerDSP & NativeCaptureAPI

// Expose Electron API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  startWindowMove: () => ipcRenderer.send('window:start-move'),
  stopWindowMove: () => ipcRenderer.send('window:stop-move'),
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('window:set-bounds', bounds),
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds') as Promise<{ x: number; y: number; width: number; height: number } | null>,
  repositionWindow: (position: 'top' | 'bottom') => ipcRenderer.send('window:reposition', position),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
  getDesktopSources: () => ipcRenderer.invoke('audio:get-desktop-sources') as Promise<{ id: string; name: string }[]>,
  getCaptureBackendSupport: async () => {
    const support = await ipcRenderer.invoke('capture:get-backend-support') as CaptureBackendSupport
    return {
      ...support,
      nativeBackend: resolveNativeCaptureSupport(support.nativeBackend),
    } satisfies CaptureBackendSupport
  },
  expandSettings: (panelHeight: number) => ipcRenderer.send('window:expand-settings', panelHeight),
  collapseSettings: (panelHeight: number) => ipcRenderer.send('window:collapse-settings', panelHeight),
  setSettingsHeight: (panelHeight: number) => ipcRenderer.send('window:set-settings-height', panelHeight),
  onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isOnTop: boolean): void => callback(isOnTop)
    ipcRenderer.on('window:always-on-top-changed', handler)
    return () => ipcRenderer.removeListener('window:always-on-top-changed', handler)
  },
  onToggleScope: (callback: (index: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, index: number): void => callback(index)
    ipcRenderer.on('shortcut:toggle-scope', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-scope', handler)
  },
  onToggleCapture: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('shortcut:toggle-capture', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-capture', handler)
  },
  onToggleSettings: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('shortcut:toggle-settings', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-settings', handler)
  },
})

// Native DSP module — load if available, gracefully degrade if not
let nativeAddonModule: NativeAddonModule | null = null
try {
  const isDev = process.env.NODE_ENV === 'development'
  const modulePath = isDev
    ? require('path').join(__dirname, '../../native/build/Release/visualizer_dsp.node')
    : require('path').join(process.resourcesPath!, 'native/visualizer_dsp.node')
  nativeAddonModule = require(modulePath) as NativeAddonModule
} catch {
  console.warn('Native DSP module not available — using JS fallback')
}

function resolveNativeCaptureSupport(
  fallbackEntry: CaptureBackendSupportEntry,
): CaptureBackendSupportEntry {
  if (process.platform === 'darwin') {
    const macosCapture = nativeAddonModule?.macosCapture
    if (!macosCapture) {
      return {
        kind: 'native-macos',
        available: false,
        reason: 'Native capture module is not available in this build.',
      }
    }

    const support = macosCapture.getSupport()
    return {
      kind: 'native-macos',
      available: support.available,
      reason: support.reason,
    }
  }

  if (process.platform === 'win32') {
    const windowsCapture = nativeAddonModule?.windowsCapture
    if (!windowsCapture) {
      return {
        kind: 'native-windows',
        available: false,
        reason: 'Native capture module is not available in this build.',
      }
    }

    const support = windowsCapture.getSupport()
    return {
      kind: 'native-windows',
      available: support.available,
      reason: support.reason,
    }
  }

  return fallbackEntry
}

const visualizerAPI = nativeAddonModule
  ? {
      oscilloscope: nativeAddonModule.oscilloscope,
      spectrum: nativeAddonModule.spectrum,
      vectorscope: nativeAddonModule.vectorscope,
    }
  : null

const nativeCaptureAPI = nativeAddonModule
  ? {
      macosCapture: nativeAddonModule.macosCapture,
      windowsCapture: nativeAddonModule.windowsCapture,
    }
  : null

contextBridge.exposeInMainWorld('visualizerAPI', visualizerAPI)
contextBridge.exposeInMainWorld('nativeCaptureAPI', nativeCaptureAPI)

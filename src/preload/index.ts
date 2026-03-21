import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureBackendSupport } from '../types/capture'

// Expose Electron API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
  getDesktopSources: () => ipcRenderer.invoke('audio:get-desktop-sources') as Promise<{ id: string; name: string }[]>,
  getCaptureBackendSupport: () => ipcRenderer.invoke('capture:get-backend-support') as Promise<CaptureBackendSupport>,
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
let visualizerDSP: unknown = null
try {
  const isDev = process.env.NODE_ENV === 'development'
  const modulePath = isDev
    ? require('path').join(__dirname, '../../native/build/Release/visualizer_dsp.node')
    : require('path').join(process.resourcesPath!, 'native/visualizer_dsp.node')
  visualizerDSP = require(modulePath)
} catch {
  console.warn('Native DSP module not available — using JS fallback')
}

contextBridge.exposeInMainWorld('visualizerAPI', visualizerDSP)

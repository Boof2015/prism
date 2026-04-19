import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureBackendSupport } from '../types/capture'
import type { NativeCaptureAPI } from '../types/nativeCapture'
import type {
  NowPlayingControlCommand,
  NowPlayingProviderConfigMutationMap,
  NowPlayingProviderId,
  NowPlayingState,
} from '../types/nowPlaying'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
  WindowBounds,
} from '../types/popout'
import type { ProfileMenuRequest } from '../types/profileMenu'
import type {
  LegacyProfileMigrationPayload,
  LegacyProfileMigrationResult,
  Profile,
  ProfileLibrarySnapshot,
} from '../types/profile'
import type { ScopeKind } from '../types/scope'
import type {
  LegacyThemeMigrationPayload,
  LegacyThemeMigrationResult,
  ThemeLibrarySnapshot,
} from '../types/theme'
import type { DialogOptions, DialogResult } from '../types/dialog'
import type { WindowCapabilities } from '../types/windowCapabilities'
import type { ResizeDirection } from '../types/windowResize'
import type { VisualizerDSP } from '../renderer/audio/native/visualizer-dsp'
import { resolveWindowCapabilities } from '../shared/windowCapabilities'
import { getCaptureBackendSupport } from './captureSupport'

type NativeAddonModule = VisualizerDSP & NativeCaptureAPI
const windowCapabilities: WindowCapabilities = resolveWindowCapabilities({
  platform: process.platform,
  argv: process.argv,
  env: process.env,
})

// Expose Electron API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  windowCapabilities,
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  startWindowMove: () => ipcRenderer.send('window:start-move'),
  stopWindowMove: () => ipcRenderer.send('window:stop-move'),
  startWindowResize: (edge: ResizeDirection) => ipcRenderer.send('window:start-resize', edge),
  stopWindowResize: () => ipcRenderer.send('window:stop-resize'),
  setWindowBounds: (bounds: WindowBounds) => ipcRenderer.send('window:set-bounds', bounds),
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds') as Promise<WindowBounds | null>,
  repositionWindow: (position: 'top' | 'bottom') => ipcRenderer.send('window:reposition', position),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
  getCaptureBackendSupport: async () => getCaptureBackendSupport(process.platform, nativeCaptureAPI) as CaptureBackendSupport,
  getNowPlayingState: () => ipcRenderer.invoke('now-playing:get-state') as Promise<NowPlayingState>,
  setNowPlayingConsumerActive: (active: boolean) => ipcRenderer.invoke('now-playing:set-active', active) as Promise<NowPlayingState>,
  saveNowPlayingProviderConfig: <K extends NowPlayingProviderId>(providerId: K, config: NowPlayingProviderConfigMutationMap[K]) => {
    return ipcRenderer.invoke('now-playing:save-provider-config', providerId, config) as Promise<NowPlayingState>
  },
  setNowPlayingProviderPriority: (providerPriority: NowPlayingProviderId[]) => {
    return ipcRenderer.invoke('now-playing:set-provider-priority', providerPriority) as Promise<NowPlayingState>
  },
  retryNowPlayingProvider: (providerId: NowPlayingProviderId) => {
    return ipcRenderer.invoke('now-playing:retry-provider', providerId) as Promise<NowPlayingState>
  },
  sendNowPlayingControl: (command: NowPlayingControlCommand) => {
    return ipcRenderer.invoke('now-playing:send-control', command) as Promise<NowPlayingState>
  },
  openNowPlayingConfigWindow: () => ipcRenderer.invoke('now-playing:open-config-window') as Promise<void>,
  getProfileSnapshot: () => ipcRenderer.invoke('profiles:get-snapshot') as Promise<ProfileLibrarySnapshot>,
  saveNewProfile: (name: string, profile: Profile) => ipcRenderer.invoke('profiles:save-new', name, profile) as Promise<ProfileLibrarySnapshot>,
  overwriteProfile: (id: string, profile: Profile) => ipcRenderer.invoke('profiles:overwrite', id, profile) as Promise<ProfileLibrarySnapshot>,
  loadProfile: (id: string) => ipcRenderer.invoke('profiles:load', id) as Promise<ProfileLibrarySnapshot>,
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id) as Promise<ProfileLibrarySnapshot>,
  renameProfile: (id: string, name: string) => ipcRenderer.invoke('profiles:rename', id, name) as Promise<ProfileLibrarySnapshot>,
  importProfileDialog: () => ipcRenderer.invoke('profiles:import-dialog') as Promise<ProfileLibrarySnapshot | null>,
  importProfileFromPath: (path: string) => ipcRenderer.invoke('profiles:import-path', path) as Promise<ProfileLibrarySnapshot>,
  promptUnsavedProfileChanges: (profileName: string | null) => {
    return ipcRenderer.invoke('profiles:prompt-unsaved', profileName) as Promise<'save' | 'discard' | 'cancel'>
  },
  revealProfilesFolder: () => ipcRenderer.invoke('profiles:reveal-folder') as Promise<void>,
  migrateLegacyProfiles: (payload: LegacyProfileMigrationPayload) => ipcRenderer.invoke('profiles:migrate-legacy', payload) as Promise<LegacyProfileMigrationResult>,
  getThemeSnapshot: () => ipcRenderer.invoke('themes:get-snapshot') as Promise<ThemeLibrarySnapshot>,
  loadTheme: (id: string) => ipcRenderer.invoke('themes:load', id) as Promise<ThemeLibrarySnapshot>,
  renameTheme: (id: string, name: string) => ipcRenderer.invoke('themes:rename', id, name) as Promise<ThemeLibrarySnapshot>,
  deleteTheme: (id: string) => ipcRenderer.invoke('themes:delete', id) as Promise<ThemeLibrarySnapshot>,
  reloadThemes: () => ipcRenderer.invoke('themes:reload') as Promise<ThemeLibrarySnapshot>,
  importThemeDialog: () => ipcRenderer.invoke('themes:import-dialog') as Promise<ThemeLibrarySnapshot | null>,
  revealThemesFolder: () => ipcRenderer.invoke('themes:reveal-folder') as Promise<void>,
  migrateLegacyTheme: (payload: LegacyThemeMigrationPayload) => ipcRenderer.invoke('themes:migrate-legacy', payload) as Promise<LegacyThemeMigrationResult>,
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  expandSettings: (panelHeight: number) => ipcRenderer.send('window:expand-settings', panelHeight),
  collapseSettings: (panelHeight: number) => ipcRenderer.send('window:collapse-settings', panelHeight),
  setSettingsHeight: (panelHeight: number) => ipcRenderer.send('window:set-settings-height', panelHeight),
  notifyRendererReady: () => ipcRenderer.send('renderer:ready'),
  respondToCloseRequest: (shouldClose: boolean) => ipcRenderer.send('window:close-response', shouldClose),
  openProfileMenu: (request: ProfileMenuRequest) => ipcRenderer.send('profile-menu:open', request),
  syncScopePopouts: (state: ScopePopoutSyncStateMap) => ipcRenderer.send('scope-popout:sync', state),
  sendScopePopoutSnapshot: (snapshot: ScopePopoutSnapshot) => ipcRenderer.send('scope-popout:snapshot', snapshot),
  sendScopePopoutAudio: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => ipcRenderer.send('scope-popout:audio', kind, batch),
  sendScopePopoutSession: (kind: ScopeKind, session: ScopePopoutSessionState) => ipcRenderer.send('scope-popout:session', kind, session),
  notifyScopePopoutReady: (kind: ScopeKind) => ipcRenderer.send('scope-popout:ready', kind),
  requestScopePopIn: (kind: ScopeKind) => ipcRenderer.send('scope-popout:request-pop-in', kind),
  sendScopePopoutSettingsUpdate: (kind: ScopeKind, partial: unknown) => ipcRenderer.send('scope-popout:settings-update', kind, partial),
  onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isOnTop: boolean): void => callback(isOnTop)
    ipcRenderer.on('window:always-on-top-changed', handler)
    return () => ipcRenderer.removeListener('window:always-on-top-changed', handler)
  },
  onMainWindowBoundsChanged: (callback: (bounds: WindowBounds) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bounds: WindowBounds): void => callback(bounds)
    ipcRenderer.on('window:bounds-changed', handler)
    return () => ipcRenderer.removeListener('window:bounds-changed', handler)
  },
  onNowPlayingStateChanged: (callback: (state: NowPlayingState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: NowPlayingState): void => callback(state)
    ipcRenderer.on('now-playing:state-changed', handler)
    return () => ipcRenderer.removeListener('now-playing:state-changed', handler)
  },
  onMainCloseRequested: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('window:close-requested', handler)
    return () => ipcRenderer.removeListener('window:close-requested', handler)
  },
  onProfileMenuClosed: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('profile-menu:closed', handler)
    return () => ipcRenderer.removeListener('profile-menu:closed', handler)
  },
  onProfileMenuLoad: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('profile-menu:load', handler)
    return () => ipcRenderer.removeListener('profile-menu:load', handler)
  },
  onProfileMenuSaveNew: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('profile-menu:save-new', handler)
    return () => ipcRenderer.removeListener('profile-menu:save-new', handler)
  },
  onProfileMenuSaveOverwrite: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('profile-menu:save-overwrite', handler)
    return () => ipcRenderer.removeListener('profile-menu:save-overwrite', handler)
  },
  onProfileMenuRenameActive: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('profile-menu:rename-active', handler)
    return () => ipcRenderer.removeListener('profile-menu:rename-active', handler)
  },
  onProfileMenuDeleteActive: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('profile-menu:delete-active', handler)
    return () => ipcRenderer.removeListener('profile-menu:delete-active', handler)
  },
  onProfileMenuImport: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('profile-menu:import', handler)
    return () => ipcRenderer.removeListener('profile-menu:import', handler)
  },
  onProfileMenuShowFolder: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('profile-menu:show-folder', handler)
    return () => ipcRenderer.removeListener('profile-menu:show-folder', handler)
  },
  onExternalProfileOpenRequested: (callback: (path: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('profiles:open-requested', handler)
    return () => ipcRenderer.removeListener('profiles:open-requested', handler)
  },
  onExternalProfileActivated: (callback: (snapshot: ProfileLibrarySnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ProfileLibrarySnapshot): void => callback(snapshot)
    ipcRenderer.on('profiles:external-activated', handler)
    return () => ipcRenderer.removeListener('profiles:external-activated', handler)
  },
  onScopePopoutReady: (callback: (kind: ScopeKind) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind): void => callback(kind)
    ipcRenderer.on('scope-popout:ready', handler)
    return () => ipcRenderer.removeListener('scope-popout:ready', handler)
  },
  onScopePopoutCloseRequested: (callback: (kind: ScopeKind) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind): void => callback(kind)
    ipcRenderer.on('scope-popout:close-requested', handler)
    return () => ipcRenderer.removeListener('scope-popout:close-requested', handler)
  },
  onScopePopoutBoundsChanged: (callback: (kind: ScopeKind, bounds: WindowBounds) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind, bounds: WindowBounds): void => callback(kind, bounds)
    ipcRenderer.on('scope-popout:bounds-changed', handler)
    return () => ipcRenderer.removeListener('scope-popout:bounds-changed', handler)
  },
  onScopePopoutSettingsUpdate: (callback: (kind: ScopeKind, partial: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind, partial: unknown): void => callback(kind, partial)
    ipcRenderer.on('scope-popout:settings-update', handler)
    return () => ipcRenderer.removeListener('scope-popout:settings-update', handler)
  },
  onScopePopoutSnapshot: (callback: (snapshot: ScopePopoutSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ScopePopoutSnapshot): void => callback(snapshot)
    ipcRenderer.on('scope-popout:snapshot', handler)
    return () => ipcRenderer.removeListener('scope-popout:snapshot', handler)
  },
  onScopePopoutAudio: (callback: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind, batch: ScopePopoutAudioBatch): void => callback(kind, batch)
    ipcRenderer.on('scope-popout:audio', handler)
    return () => ipcRenderer.removeListener('scope-popout:audio', handler)
  },
  onScopePopoutSession: (callback: (kind: ScopeKind, session: ScopePopoutSessionState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: ScopeKind, session: ScopePopoutSessionState): void => callback(kind, session)
    ipcRenderer.on('scope-popout:session', handler)
    return () => ipcRenderer.removeListener('scope-popout:session', handler)
  },
  showDialog: (options: DialogOptions) => ipcRenderer.invoke('dialog:show', options) as Promise<DialogResult>,
  onDialogConfig: (callback: (options: DialogOptions) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, options: DialogOptions): void => callback(options)
    ipcRenderer.on('dialog:config', handler)
    return () => ipcRenderer.removeListener('dialog:config', handler)
  },
  sendDialogResult: (result: DialogResult) => ipcRenderer.send('dialog:result', result),
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
      linuxCapture: nativeAddonModule.linuxCapture,
    }
  : null

contextBridge.exposeInMainWorld('visualizerAPI', visualizerAPI)
contextBridge.exposeInMainWorld('nativeCaptureAPI', nativeCaptureAPI)

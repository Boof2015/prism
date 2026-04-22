/// <reference types="vite/client" />

import type { VisualizerDSP } from './audio/native/visualizer-dsp'
import type { AppBuildInfo } from '../types/appBuildInfo'
import type { CaptureBackendSupport } from '../types/capture'
import type { NativeCaptureAPI } from '../types/nativeCapture'
import type {
  NowPlayingControlCommand,
  NowPlayingProviderConfigMap,
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
import type { UpdateCheckResult } from '../types/updates'
import type { WindowCapabilities } from '../types/windowCapabilities'
import type { ResizeDirection } from '../types/windowResize'

declare global {
  interface Window {
    visualizerAPI: VisualizerDSP | null
    nativeCaptureAPI: NativeCaptureAPI | null
    electronAPI: {
      platform: string
      windowCapabilities: WindowCapabilities
      getAppBuildInfo: () => Promise<AppBuildInfo>
      minimize: () => void
      close: () => void
      startWindowMove: () => void
      stopWindowMove: () => void
      startWindowResize: (edge: ResizeDirection) => void
      stopWindowResize: () => void
      setWindowBounds: (bounds: WindowBounds) => void
      getWindowBounds: () => Promise<WindowBounds | null>
      repositionWindow: (position: 'top' | 'bottom') => void
      toggleAlwaysOnTop: () => void
      isAlwaysOnTop: () => Promise<boolean>
      isCursorInsideWindow: () => Promise<boolean>
      getCaptureBackendSupport: () => Promise<CaptureBackendSupport>
      getNowPlayingState: () => Promise<NowPlayingState>
      setNowPlayingConsumerActive: (active: boolean) => Promise<NowPlayingState>
      saveNowPlayingProviderConfig: <K extends NowPlayingProviderId>(providerId: K, config: NowPlayingProviderConfigMutationMap[K]) => Promise<NowPlayingState>
      setNowPlayingProviderPriority: (providerPriority: NowPlayingProviderId[]) => Promise<NowPlayingState>
      retryNowPlayingProvider: (providerId: NowPlayingProviderId) => Promise<NowPlayingState>
      sendNowPlayingControl: (command: NowPlayingControlCommand) => Promise<NowPlayingState>
      openNowPlayingConfigWindow: () => Promise<void>
      getProfileSnapshot: () => Promise<ProfileLibrarySnapshot>
      saveNewProfile: (name: string, profile: Profile) => Promise<ProfileLibrarySnapshot>
      overwriteProfile: (id: string, profile: Profile) => Promise<ProfileLibrarySnapshot>
      loadProfile: (id: string) => Promise<ProfileLibrarySnapshot>
      deleteProfile: (id: string) => Promise<ProfileLibrarySnapshot>
      renameProfile: (id: string, name: string) => Promise<ProfileLibrarySnapshot>
      importProfileDialog: () => Promise<ProfileLibrarySnapshot | null>
      importProfileFromPath: (path: string) => Promise<ProfileLibrarySnapshot>
      promptUnsavedProfileChanges: (profileName: string | null) => Promise<'save' | 'discard' | 'cancel'>
      revealProfilesFolder: () => Promise<void>
      migrateLegacyProfiles: (payload: LegacyProfileMigrationPayload) => Promise<LegacyProfileMigrationResult>
      getThemeSnapshot: () => Promise<ThemeLibrarySnapshot>
      loadTheme: (id: string) => Promise<ThemeLibrarySnapshot>
      renameTheme: (id: string, name: string) => Promise<ThemeLibrarySnapshot>
      deleteTheme: (id: string) => Promise<ThemeLibrarySnapshot>
      reloadThemes: () => Promise<ThemeLibrarySnapshot>
      importThemeDialog: () => Promise<ThemeLibrarySnapshot | null>
      revealThemesFolder: () => Promise<void>
      migrateLegacyTheme: (payload: LegacyThemeMigrationPayload) => Promise<LegacyThemeMigrationResult>
      openExternalUrl: (url: string) => Promise<void>
      updates: {
        checkForUpdates: () => Promise<UpdateCheckResult>
        openReleasesPage: (releaseUrl?: string) => Promise<void>
      }
      expandSettings: (panelHeight: number) => void
      collapseSettings: (panelHeight: number) => void
      setSettingsHeight: (panelHeight: number) => void
      notifyRendererReady: () => void
      respondToCloseRequest: (shouldClose: boolean) => void
      openProfileMenu: (request: ProfileMenuRequest) => void
      syncScopePopouts: (state: ScopePopoutSyncStateMap) => void
      sendScopePopoutSnapshot: (snapshot: ScopePopoutSnapshot) => void
      sendScopePopoutAudio: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => void
      sendScopePopoutSession: (kind: ScopeKind, session: ScopePopoutSessionState) => void
      notifyScopePopoutReady: (kind: ScopeKind) => void
      requestScopePopIn: (kind: ScopeKind) => void
      sendScopePopoutSettingsUpdate: (kind: ScopeKind, partial: unknown) => void
      onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => () => void
      onMainWindowBoundsChanged: (callback: (bounds: WindowBounds) => void) => () => void
      onNowPlayingStateChanged: (callback: (state: NowPlayingState) => void) => () => void
      onMainCloseRequested: (callback: () => void) => () => void
      onProfileMenuClosed: (callback: () => void) => () => void
      onProfileMenuLoad: (callback: (id: string) => void) => () => void
      onProfileMenuSaveNew: (callback: () => void) => () => void
      onProfileMenuSaveOverwrite: (callback: () => void) => () => void
      onProfileMenuRenameActive: (callback: (id: string) => void) => () => void
      onProfileMenuDeleteActive: (callback: (id: string) => void) => () => void
      onProfileMenuImport: (callback: () => void) => () => void
      onProfileMenuShowFolder: (callback: () => void) => () => void
      onExternalProfileOpenRequested: (callback: (path: string) => void) => () => void
      onExternalProfileActivated: (callback: (snapshot: ProfileLibrarySnapshot) => void) => () => void
      onScopePopoutReady: (callback: (kind: ScopeKind) => void) => () => void
      onScopePopoutCloseRequested: (callback: (kind: ScopeKind) => void) => () => void
      onScopePopoutBoundsChanged: (callback: (kind: ScopeKind, bounds: WindowBounds) => void) => () => void
      onScopePopoutSettingsUpdate: (callback: (kind: ScopeKind, partial: unknown) => void) => () => void
      onScopePopoutSnapshot: (callback: (snapshot: ScopePopoutSnapshot) => void) => () => void
      onScopePopoutAudio: (callback: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => void) => () => void
      onScopePopoutSession: (callback: (kind: ScopeKind, session: ScopePopoutSessionState) => void) => () => void
      showDialog: (options: DialogOptions) => Promise<DialogResult>
      onDialogConfig: (callback: (options: DialogOptions) => void) => () => void
      sendDialogResult: (result: DialogResult) => void
    }
  }
}

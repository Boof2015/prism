/// <reference types="vite/client" />

import type { VisualizerDSP } from './audio/native/visualizer-dsp'
import type { CaptureBackendSupport } from '../types/capture'
import type { NativeCaptureAPI } from '../types/nativeCapture'
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

declare global {
  interface Window {
    visualizerAPI: VisualizerDSP | null
    nativeCaptureAPI: NativeCaptureAPI | null
    electronAPI: {
      platform: string
      minimize: () => void
      close: () => void
      startWindowMove: () => void
      stopWindowMove: () => void
      setWindowBounds: (bounds: WindowBounds) => void
      getWindowBounds: () => Promise<WindowBounds | null>
      repositionWindow: (position: 'top' | 'bottom') => void
      toggleAlwaysOnTop: () => void
      isAlwaysOnTop: () => Promise<boolean>
      getDesktopSources: () => Promise<{ id: string; name: string }[]>
      getCaptureBackendSupport: () => Promise<CaptureBackendSupport>
      getProfileSnapshot: () => Promise<ProfileLibrarySnapshot>
      saveNewProfile: (name: string, profile: Profile) => Promise<ProfileLibrarySnapshot>
      overwriteProfile: (id: string, profile: Profile) => Promise<ProfileLibrarySnapshot>
      loadProfile: (id: string) => Promise<ProfileLibrarySnapshot>
      deleteProfile: (id: string) => Promise<ProfileLibrarySnapshot>
      renameProfile: (id: string, name: string) => Promise<ProfileLibrarySnapshot>
      importProfileDialog: () => Promise<ProfileLibrarySnapshot | null>
      revealProfilesFolder: () => Promise<void>
      migrateLegacyProfiles: (payload: LegacyProfileMigrationPayload) => Promise<LegacyProfileMigrationResult>
      expandSettings: (panelHeight: number) => void
      collapseSettings: (panelHeight: number) => void
      setSettingsHeight: (panelHeight: number) => void
      openProfileMenu: (request: ProfileMenuRequest) => void
      syncScopePopouts: (state: ScopePopoutSyncStateMap) => void
      sendScopePopoutSnapshot: (snapshot: ScopePopoutSnapshot) => void
      sendScopePopoutAudio: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => void
      sendScopePopoutSession: (kind: ScopeKind, session: ScopePopoutSessionState) => void
      notifyScopePopoutReady: (kind: ScopeKind) => void
      requestScopePopIn: (kind: ScopeKind) => void
      sendScopePopoutSettingsUpdate: (kind: ScopeKind, partial: unknown) => void
      onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => () => void
      onToggleScope: (callback: (index: number) => void) => () => void
      onToggleCapture: (callback: () => void) => () => void
      onToggleSettings: (callback: () => void) => () => void
      onProfileMenuClosed: (callback: () => void) => () => void
      onProfileMenuLoad: (callback: (id: string) => void) => () => void
      onProfileMenuSaveNew: (callback: () => void) => () => void
      onProfileMenuSaveOverwrite: (callback: () => void) => () => void
      onProfileMenuRenameActive: (callback: (id: string) => void) => () => void
      onProfileMenuDeleteActive: (callback: (id: string) => void) => () => void
      onProfileMenuImport: (callback: () => void) => () => void
      onProfileMenuShowFolder: (callback: () => void) => () => void
      onExternalProfileActivated: (callback: (snapshot: ProfileLibrarySnapshot) => void) => () => void
      onScopePopoutReady: (callback: (kind: ScopeKind) => void) => () => void
      onScopePopoutCloseRequested: (callback: (kind: ScopeKind) => void) => () => void
      onScopePopoutBoundsChanged: (callback: (kind: ScopeKind, bounds: WindowBounds) => void) => () => void
      onScopePopoutSettingsUpdate: (callback: (kind: ScopeKind, partial: unknown) => void) => () => void
      onScopePopoutSnapshot: (callback: (snapshot: ScopePopoutSnapshot) => void) => () => void
      onScopePopoutAudio: (callback: (kind: ScopeKind, batch: ScopePopoutAudioBatch) => void) => () => void
      onScopePopoutSession: (callback: (kind: ScopeKind, session: ScopePopoutSessionState) => void) => () => void
    }
  }
}

import type { RollingCaptureDurationSeconds } from './audioClip'

export type LoginLaunchMode = 'show' | 'tray'

export type LoginItemStatus =
  | 'unavailable'
  | 'disabled'
  | 'enabled'
  | 'requires-approval'
  | 'blocked'
  | 'error'

export interface DesktopIntegrationPreferences {
  closeToTray: boolean
  loginLaunchMode: LoginLaunchMode
}

export interface DesktopIntegrationSnapshot extends DesktopIntegrationPreferences {
  openAtLogin: boolean
  loginItemStatus: LoginItemStatus
  loginItemError: string | null
}

export interface TrayProfileOption {
  id: string
  name: string
}

export interface TrayAudioSourceOption {
  id: string
  label: string
  isDefault?: boolean
}

export interface TrayRendererState {
  profiles: TrayProfileOption[]
  activeProfileId: string | null
  hasUnsavedProfileChanges: boolean
  captureStatus: 'idle' | 'connecting' | 'capturing' | 'error'
  activeSourceLabel: string | null
  captureMode: 'system' | 'device'
  selectedSystemSourceId: string | null
  selectedDeviceId: string | null
  rollingCaptureSeconds: RollingCaptureDurationSeconds | null
  systemSources: TrayAudioSourceOption[]
  inputSources: TrayAudioSourceOption[]
}

export type TrayRendererCommand =
  | { type: 'load-profile'; profileId: string }
  | { type: 'select-system-source'; sourceId: string }
  | { type: 'select-input-source'; deviceId: string | null }
  | { type: 'set-rolling-capture'; durationSeconds: RollingCaptureDurationSeconds | null }
  | { type: 'set-capture-running'; running: boolean }
  | { type: 'open-settings' }

export const DEFAULT_DESKTOP_INTEGRATION_PREFERENCES: DesktopIntegrationPreferences = {
  closeToTray: false,
  loginLaunchMode: 'show',
}

export const DEFAULT_TRAY_RENDERER_STATE: TrayRendererState = {
  profiles: [],
  activeProfileId: null,
  hasUnsavedProfileChanges: false,
  captureStatus: 'idle',
  activeSourceLabel: null,
  captureMode: 'system',
  selectedSystemSourceId: null,
  selectedDeviceId: null,
  rollingCaptureSeconds: null,
  systemSources: [],
  inputSources: [],
}

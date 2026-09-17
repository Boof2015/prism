import {
  DEFAULT_TRAY_RENDERER_STATE,
  type DesktopIntegrationSnapshot,
  type TrayAudioSourceOption,
  type TrayProfileOption,
  type TrayRendererState,
} from '../../types/desktopIntegration'
import { isRollingCaptureDuration } from '../../types/audioClip'

const MAX_TRAY_ITEMS = 64
const MAX_LABEL_LENGTH = 96

export interface TrayMenuState {
  mainWindowVisible: boolean
  rendererReady: boolean
  rendererState: TrayRendererState
  desktopIntegration: DesktopIntegrationSnapshot
  alwaysOnTop: boolean
  supportsReposition: boolean
}

export interface TrayMenuModel extends TrayMenuState {
  statusLabel: string
  tooltip: string
  mainWindowActionLabel: 'Show Prism' | 'Hide Prism'
  captureActionLabel: 'Start Capture' | 'Stop Capture'
  captureActionEnabled: boolean
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, MAX_LABEL_LENGTH)
}

function normalizeProfiles(value: unknown): TrayProfileOption[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_TRAY_ITEMS).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const candidate = raw as Partial<TrayProfileOption>
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) return []
    return [{
      id: candidate.id,
      name: normalizeText(candidate.name, 'Profile'),
    }]
  })
}

function normalizeSources(value: unknown): TrayAudioSourceOption[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_TRAY_ITEMS).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const candidate = raw as Partial<TrayAudioSourceOption>
    if (typeof candidate.id !== 'string') return []
    return [{
      id: candidate.id,
      label: normalizeText(candidate.label, 'Audio Source'),
      isDefault: candidate.isDefault === true,
    }]
  })
}

export function normalizeTrayRendererState(value: unknown): TrayRendererState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_TRAY_RENDERER_STATE }
  }

  const candidate = value as Partial<TrayRendererState>
  const captureStatus = candidate.captureStatus === 'connecting'
    || candidate.captureStatus === 'waiting'
    || candidate.captureStatus === 'capturing'
    || candidate.captureStatus === 'error'
    ? candidate.captureStatus
    : 'idle'

  return {
    profiles: normalizeProfiles(candidate.profiles),
    activeProfileId: typeof candidate.activeProfileId === 'string' ? candidate.activeProfileId : null,
    hasUnsavedProfileChanges: candidate.hasUnsavedProfileChanges === true,
    captureStatus,
    activeSourceLabel: typeof candidate.activeSourceLabel === 'string'
      ? normalizeText(candidate.activeSourceLabel, 'Audio Source')
      : null,
    captureMode: candidate.captureMode === 'device' || candidate.captureMode === 'daw'
      ? candidate.captureMode
      : 'system',
    selectedSystemSourceId: typeof candidate.selectedSystemSourceId === 'string'
      ? candidate.selectedSystemSourceId
      : null,
    selectedDeviceId: typeof candidate.selectedDeviceId === 'string'
      ? candidate.selectedDeviceId
      : null,
    selectedDawSourceId: typeof candidate.selectedDawSourceId === 'string'
      ? candidate.selectedDawSourceId
      : null,
    rollingCaptureSeconds: isRollingCaptureDuration(candidate.rollingCaptureSeconds)
      ? candidate.rollingCaptureSeconds
      : null,
    systemSources: normalizeSources(candidate.systemSources),
    inputSources: normalizeSources(candidate.inputSources),
    dawSources: normalizeSources(candidate.dawSources),
  }
}

export function buildTrayMenuModel(state: TrayMenuState): TrayMenuModel {
  const sourceLabel = state.rendererState.activeSourceLabel
  const statusText = state.rendererState.captureStatus === 'capturing'
    ? sourceLabel ? `Capturing · ${sourceLabel}` : 'Capturing'
    : state.rendererState.captureStatus === 'connecting'
      ? 'Connecting to audio…'
      : state.rendererState.captureStatus === 'waiting'
        ? 'Waiting for DAW bridge…'
      : state.rendererState.captureStatus === 'error'
        ? 'Audio capture error'
        : 'Capture stopped'

  return {
    ...state,
    statusLabel: `Prism — ${statusText}`,
    tooltip: sourceLabel && state.rendererState.captureStatus === 'capturing'
      ? `Prism — ${sourceLabel}`
      : 'Prism',
    mainWindowActionLabel: state.mainWindowVisible ? 'Hide Prism' : 'Show Prism',
    captureActionLabel: state.rendererState.captureStatus === 'capturing'
      || state.rendererState.captureStatus === 'connecting'
      || state.rendererState.captureStatus === 'waiting'
      ? 'Stop Capture'
      : 'Start Capture',
    captureActionEnabled: state.rendererReady,
  }
}

export function createTrayMenuStateKey(model: TrayMenuModel): string {
  return JSON.stringify(model)
}

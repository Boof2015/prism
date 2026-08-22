import { useEffect, type JSX } from 'react'
import type { TrayRendererCommand, TrayRendererState } from '../../types/desktopIntegration'
import { useAudioStore } from '../stores/audioStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'

interface TrayControlBridgeProps {
  ready: boolean
}

const DEFAULT_SYSTEM_SOURCE_ID = '__default_system_output__'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function handleTrayCommand(command: TrayRendererCommand): Promise<void> {
  if (command.type === 'open-settings') {
    useUiStore.getState().setSettingsOpen(true)
    return
  }

  if (command.type === 'load-profile') {
    const settings = useSettingsStore.getState()
    try {
      await settings.guardProfileTransition(async () => {
        await useSettingsStore.getState().loadProfile(command.profileId)
      })
    } catch (error) {
      useUiStore.getState().showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not load the profile.'),
        actions: [],
      })
    }
    return
  }

  const audio = useAudioStore.getState()
  if (command.type === 'select-system-source') {
    await audio.selectSystemSource(command.sourceId)
    await useAudioStore.getState().startCapture()
    return
  }
  if (command.type === 'select-input-source') {
    await audio.selectDevice(command.deviceId)
    await useAudioStore.getState().startCapture()
    return
  }
  if (command.type === 'select-daw-source') {
    await audio.selectDawSource(command.sourceId)
    await useAudioStore.getState().startCapture()
    return
  }
  if (command.type === 'set-rolling-capture') {
    audio.setRollingCaptureSeconds(command.durationSeconds)
    return
  }
  if (command.type === 'set-capture-running') {
    if (command.running) {
      await audio.startCapture()
    } else {
      audio.stopCapture()
    }
  }
}

export default function TrayControlBridge({ ready }: TrayControlBridgeProps): JSX.Element | null {
  const profiles = useSettingsStore((state) => state.profiles)
  const activeProfileId = useSettingsStore((state) => state.activeProfileId)
  const hasUnsavedProfileChanges = useSettingsStore((state) => state.hasUnsavedProfileChanges)
  const captureStatus = useAudioStore((state) => state.captureStatus)
  const activeSourceLabel = useAudioStore((state) => state.activeSourceLabel)
  const activeSourceId = useAudioStore((state) => state.activeSourceId)
  const captureMode = useAudioStore((state) => state.captureMode)
  const selectedSystemSourceId = useAudioStore((state) => state.selectedSystemSourceId)
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId)
  const selectedDawSourceId = useAudioStore((state) => state.selectedDawSourceId)
  const rollingCaptureSeconds = useAudioStore((state) => state.rollingCaptureSeconds)
  const systemSources = useAudioStore((state) => state.systemSources)
  const devices = useAudioStore((state) => state.devices)
  const dawSources = useAudioStore((state) => state.dawSources)

  useEffect(() => {
    const unsubscribe = window.electronAPI.trayControls.onCommand((command) => {
      void handleTrayCommand(command).catch((error) => {
        useUiStore.getState().showBanner({
          tone: 'error',
          message: getErrorMessage(error, 'The tray action could not be completed.'),
          actions: [],
        })
      })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!ready) {
      window.electronAPI.trayControls.markNotReady()
      return
    }
    window.electronAPI.trayControls.markReady()
    return () => window.electronAPI.trayControls.markNotReady()
  }, [ready])

  useEffect(() => {
    const visibleSystemSources = systemSources.length > 0
      ? systemSources
      : [{ id: DEFAULT_SYSTEM_SOURCE_ID, label: 'Default Output', isDefault: true }]
    const matchingDawSources = dawSources.filter((source) => (
      source.id === selectedDawSourceId || source.persistentId === selectedDawSourceId
    ))
    const selectedDawLiveSourceId = captureMode === 'daw'
      && activeSourceId
      && dawSources.some((source) => source.id === activeSourceId)
      ? activeSourceId
      : matchingDawSources.length === 1
        ? matchingDawSources[0]!.id
        : null
    const state: TrayRendererState = {
      profiles: Object.entries(profiles).map(([id, profile]) => ({ id, name: profile.name })),
      activeProfileId,
      hasUnsavedProfileChanges,
      captureStatus,
      activeSourceLabel,
      captureMode,
      selectedSystemSourceId,
      selectedDeviceId,
      selectedDawSourceId: selectedDawLiveSourceId,
      rollingCaptureSeconds,
      systemSources: visibleSystemSources.map((source) => ({
        id: source.id,
        label: source.label,
        isDefault: source.isDefault,
      })),
      inputSources: [
        { id: '', label: 'Default Input', isDefault: true },
        ...devices
          .filter((device) => device.deviceId !== 'default')
          .map((device) => ({
            id: device.deviceId,
            label: device.label || `Input ${device.deviceId.slice(0, 8)}`,
          })),
      ],
      dawSources: dawSources.map((source) => ({
        id: source.id,
        label: source.label,
      })),
    }
    window.electronAPI.trayControls.publishState(state)
  }, [
    activeProfileId,
    activeSourceId,
    activeSourceLabel,
    captureMode,
    captureStatus,
    devices,
    hasUnsavedProfileChanges,
    profiles,
    rollingCaptureSeconds,
    selectedDeviceId,
    selectedDawSourceId,
    selectedSystemSourceId,
    systemSources,
    dawSources,
  ])

  return null
}

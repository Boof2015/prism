import { useState, useRef, useCallback, useEffect, useLayoutEffect, type JSX } from 'react'
import Strip from './components/Strip'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import BottomBar from './components/BottomBar'
import ScopePopoutBridge from './components/ScopePopoutBridge'
import WindowResizeOverlay from './components/WindowResizeOverlay'
import AppBanner from './components/AppBanner'
import { resolveMainWindowSettingsHeight } from './mainWindowSettings'
import { useSettingsStore } from './stores/settingsStore'
import { useAudioStore } from './stores/audioStore'
import { useNowPlayingStore } from './stores/nowPlayingStore'
import { useThemeStore } from './stores/themeStore'
import { useUiStore } from './stores/uiStore'

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(0)
  const [bottomBarHeight, setBottomBarHeight] = useState(0)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const externalProfileOpenQueueRef = useRef(Promise.resolve())

  const initializeProfiles = useSettingsStore((s) => s.initializeProfiles)
  const applyExternalProfileSnapshot = useSettingsStore((s) => s.applyExternalProfileSnapshot)
  const guardProfileTransition = useSettingsStore((s) => s.guardProfileTransition)
  const importProfileFromPath = useSettingsStore((s) => s.importProfileFromPath)
  const showProfilesFolder = useSettingsStore((s) => s.showProfilesFolder)
  const updateMainWindowBounds = useSettingsStore((s) => s.updateMainWindowBounds)
  const initializeThemes = useThemeStore((s) => s.initializeThemes)
  const applyExternalThemeSnapshot = useThemeStore((s) => s.applyExternalThemeSnapshot)
  const initializeNowPlaying = useNowPlayingStore((s) => s.initialize)
  const setNowPlayingConsumerActive = useNowPlayingStore((s) => s.setConsumerActive)
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopePopouts = useSettingsStore((s) => s.scopePopouts)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const toggleSettings = useUiStore((s) => s.toggleSettings)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const showBanner = useUiStore((s) => s.showBanner)

  const isNowPlayingVisible = !hiddenScopes.has('nowPlaying')
    && (scopeOrder.includes('nowPlaying') || scopePopouts.nowPlaying?.poppedOut === true)

  // Auto-capture on launch
  useEffect(() => {
    const { isCapturing, captureStatus, startCapture } = useAudioStore.getState()
    if (!isCapturing && captureStatus !== 'connecting') {
      void startCapture()
    }
  }, [])

  useEffect(() => {
    let isDisposed = false

    void (async () => {
      await initializeThemes()
      await initializeProfiles()
      await initializeNowPlaying()
      if (!isDisposed) {
        window.electronAPI.notifyRendererReady()
      }
    })()

    const unsubscribeProfile = window.electronAPI.onExternalProfileActivated((snapshot) => {
      applyExternalProfileSnapshot(snapshot)
    })
    const unsubscribeTheme = window.electronAPI.onExternalThemeActivated((snapshot) => {
      applyExternalThemeSnapshot(snapshot)
    })
    const unsubscribeBounds = window.electronAPI.onMainWindowBoundsChanged((bounds) => {
      updateMainWindowBounds(bounds)
    })
    const unsubscribeExternalOpenRequested = window.electronAPI.onExternalProfileOpenRequested((path) => {
      externalProfileOpenQueueRef.current = externalProfileOpenQueueRef.current
        .then(async () => {
          const didComplete = await guardProfileTransition(async () => {
            await importProfileFromPath(path)
          })
          if (!didComplete) {
            return
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error && error.message
            ? error.message
            : `Prism could not open ${path}.`

          showBanner({
            tone: 'error',
            message,
            actions: [
              {
                label: 'Open Folder',
                onSelect: async () => {
                  try {
                    await showProfilesFolder()
                  } catch (folderError) {
                    showBanner({
                      tone: 'error',
                      message: folderError instanceof Error && folderError.message
                        ? folderError.message
                        : 'Could not open the profiles folder.',
                      actions: [],
                    })
                  }
                },
              },
            ],
          })
        })
    })
    const unsubscribeCloseRequested = window.electronAPI.onMainCloseRequested(() => {
      void window.electronAPI.getWindowBounds()
        .then((bounds) => {
          if (bounds) {
            updateMainWindowBounds(bounds)
          }
        })
        .finally(() => {
          window.electronAPI.respondToCloseRequest(true)
        })
    })

    return () => {
      isDisposed = true
      unsubscribeProfile()
      unsubscribeTheme()
      unsubscribeBounds()
      unsubscribeExternalOpenRequested()
      unsubscribeCloseRequested()
    }
  }, [
    applyExternalProfileSnapshot,
    applyExternalThemeSnapshot,
    guardProfileTransition,
    importProfileFromPath,
    initializeProfiles,
    initializeThemes,
    initializeNowPlaying,
    showBanner,
    showProfilesFolder,
    updateMainWindowBounds,
  ])

  useEffect(() => {
    void initializeNowPlaying()
      .then(() => setNowPlayingConsumerActive(isNowPlayingVisible))

    return () => {
      void setNowPlayingConsumerActive(false)
    }
  }, [initializeNowPlaying, isNowPlayingVisible, setNowPlayingConsumerActive])

  const settingsHeight = resolveMainWindowSettingsHeight(
    settingsOpen,
    settingsPanelHeight,
    bottomBarHeight,
  )
  const settingsVisible = settingsOpen && settingsHeight > 0

  useLayoutEffect(() => {
    window.electronAPI.setSettingsHeight(settingsHeight)
  }, [settingsHeight])

  const showToolbar = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    setToolbarVisible(true)
  }, [])

  const scheduleHide = useCallback(() => {
    if (settingsOpen) return
    hideTimeoutRef.current = setTimeout(() => {
      setToolbarVisible(false)
    }, 400)
  }, [settingsOpen])

  const handleToggleSettings = useCallback(() => {
    toggleSettings()
  }, [toggleSettings])

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [setSettingsOpen])

  const handleAltDragStart = useCallback((event: React.MouseEvent) => {
    if (event.altKey && event.button === 0) {
      event.preventDefault()
      window.electronAPI.startWindowMove()
    }
  }, [])

  const handleAltDragEnd = useCallback(() => {
    window.electronAPI.stopWindowMove()
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
      window.electronAPI.stopWindowMove()
    }
  }, [])

  return (
    <div
      className="prism-app"
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleHide}
      onMouseDown={handleAltDragStart}
      onMouseUp={handleAltDragEnd}
    >
      <div
        className={`prism-toolbar-layer ${toolbarVisible ? 'is-visible' : ''}`.trim()}
      >
        <Toolbar onOpenSettings={handleToggleSettings} settingsOpen={settingsOpen} />
      </div>

      <div className="prism-strip-region">
        <Strip />
      </div>

      <ScopePopoutBridge />

      <AppBanner />

      <div
        className={`prism-settings-region ${settingsVisible ? '' : 'is-hidden'}`.trim()}
        style={{ height: settingsHeight }}
        aria-hidden={!settingsVisible}
      >
        <SettingsPanel onHeightChange={setSettingsPanelHeight} />
        <BottomBar onClose={handleCloseSettings} onHeightChange={setBottomBarHeight} />
      </div>

      <WindowResizeOverlay />
    </div>
  )
}

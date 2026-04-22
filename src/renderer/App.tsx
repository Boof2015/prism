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
import { startAudioDeviceWatcher, useAudioStore } from './stores/audioStore'
import { useNowPlayingStore } from './stores/nowPlayingStore'
import { useThemeStore } from './stores/themeStore'
import { useUiStore } from './stores/uiStore'
import { useUpdateStore } from './stores/updateStore'
import { getRendererWindowCapabilities } from './windowCapabilities'

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(0)
  const [bottomBarHeight, setBottomBarHeight] = useState(0)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsOpenRef = useRef(false)
  const externalProfileOpenQueueRef = useRef(Promise.resolve())

  const initializeProfiles = useSettingsStore((s) => s.initializeProfiles)
  const applyExternalProfileSnapshot = useSettingsStore((s) => s.applyExternalProfileSnapshot)
  const guardProfileTransition = useSettingsStore((s) => s.guardProfileTransition)
  const importProfileFromPath = useSettingsStore((s) => s.importProfileFromPath)
  const showProfilesFolder = useSettingsStore((s) => s.showProfilesFolder)
  const updateMainWindowBounds = useSettingsStore((s) => s.updateMainWindowBounds)
  const initializeThemes = useThemeStore((s) => s.initializeThemes)
  const initializeNowPlaying = useNowPlayingStore((s) => s.initialize)
  const setNowPlayingConsumerActive = useNowPlayingStore((s) => s.setConsumerActive)
  const scopeOrder = useSettingsStore((s) => s.scopeOrder)
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopePopouts = useSettingsStore((s) => s.scopePopouts)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const toggleSettings = useUiStore((s) => s.toggleSettings)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const showBanner = useUiStore((s) => s.showBanner)
  const useNativeDragRegions = getRendererWindowCapabilities().useNativeDragRegions

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
    return startAudioDeviceWatcher()
  }, [])

  useEffect(() => {
    void useUpdateStore.getState().checkForUpdates()
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
      unsubscribeBounds()
      unsubscribeExternalOpenRequested()
      unsubscribeCloseRequested()
    }
  }, [
    applyExternalProfileSnapshot,
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

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
    if (settingsOpen) {
      showToolbar()
    }
  }, [settingsOpen, showToolbar])

  const scheduleHide = useCallback(() => {
    if (settingsOpenRef.current || hideTimeoutRef.current) return

    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null
      if (settingsOpenRef.current) return
      setToolbarVisible(false)
    }, 400)
  }, [])

  const handleToolbarHoverLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const isPointerInside = event.clientX > bounds.left
      && event.clientX < bounds.right
      && event.clientY > bounds.top
      && event.clientY < bounds.bottom

    if (isPointerInside) {
      showToolbar()
      return
    }

    scheduleHide()
  }, [scheduleHide, showToolbar])

  useEffect(() => {
    if (!toolbarVisible || settingsOpen) return

    let isDisposed = false
    const checkCursorInsideWindow = (): void => {
      void window.electronAPI.isCursorInsideWindow()
        .then((isInside) => {
          if (!isDisposed && !isInside) {
            scheduleHide()
          }
        })
        .catch(() => {
          // Renderer leave events still handle auto-hide if the cursor query is unavailable.
        })
    }

    checkCursorInsideWindow()
    const interval = setInterval(checkCursorInsideWindow, 120)

    return () => {
      isDisposed = true
      clearInterval(interval)
    }
  }, [scheduleHide, settingsOpen, toolbarVisible])

  const handleToggleSettings = useCallback(() => {
    toggleSettings()
  }, [toggleSettings])

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [setSettingsOpen])

  const handleAltDragStart = useCallback((event: React.MouseEvent) => {
    if (useNativeDragRegions) {
      return
    }

    if (event.altKey && event.button === 0) {
      event.preventDefault()
      window.electronAPI.startWindowMove()
    }
  }, [useNativeDragRegions])

  const handleAltDragEnd = useCallback(() => {
    if (useNativeDragRegions) {
      return
    }

    window.electronAPI.stopWindowMove()
  }, [useNativeDragRegions])

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
      onMouseMove={showToolbar}
      onMouseLeave={handleToolbarHoverLeave}
      onMouseDown={useNativeDragRegions ? undefined : handleAltDragStart}
      onMouseUp={useNativeDragRegions ? undefined : handleAltDragEnd}
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

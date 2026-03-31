import { useState, useRef, useCallback, useEffect, useLayoutEffect, type JSX } from 'react'
import Strip from './components/Strip'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import BottomBar from './components/BottomBar'
import ScopePopoutBridge from './components/ScopePopoutBridge'
import WindowResizeOverlay from './components/WindowResizeOverlay'
import { useSettingsStore } from './stores/settingsStore'
import { useAstraStore } from './stores/astraStore'
import { useAudioStore } from './stores/audioStore'
import { useThemeStore } from './stores/themeStore'
import { SCOPE_KINDS } from '../types/scope'

const DEFAULT_SETTINGS_HEIGHT = 400

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(0)
  const [bottomBarHeight, setBottomBarHeight] = useState(0)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const externalProfileOpenQueueRef = useRef(Promise.resolve())

  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const initializeProfiles = useSettingsStore((s) => s.initializeProfiles)
  const applyExternalProfileSnapshot = useSettingsStore((s) => s.applyExternalProfileSnapshot)
  const guardProfileTransition = useSettingsStore((s) => s.guardProfileTransition)
  const importProfileFromPath = useSettingsStore((s) => s.importProfileFromPath)
  const updateMainWindowBounds = useSettingsStore((s) => s.updateMainWindowBounds)
  const initializeThemes = useThemeStore((s) => s.initializeThemes)
  const applyExternalThemeSnapshot = useThemeStore((s) => s.applyExternalThemeSnapshot)
  const initializeAstra = useAstraStore((s) => s.initialize)

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
      await initializeAstra()
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
          window.alert(error instanceof Error && error.message
            ? error.message
            : `Prism could not open ${path}.`)
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
    initializeAstra,
    updateMainWindowBounds,
  ])

  const measuredSettingsHeight = settingsPanelHeight > 0 && bottomBarHeight > 0
    ? settingsPanelHeight + bottomBarHeight
    : DEFAULT_SETTINGS_HEIGHT

  const settingsHeight = settingsOpen ? measuredSettingsHeight : 0

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
    setSettingsOpen((prev) => !prev)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [])

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

  // Keyboard shortcuts from main process
  useEffect(() => {
    const unsubs = [
      window.electronAPI.onToggleScope((index) => {
        if (index >= 0 && index < SCOPE_KINDS.length) {
          toggleScope(SCOPE_KINDS[index])
        }
      }),
      window.electronAPI.onToggleCapture(() => {
        const { isCapturing, startCapture, stopCapture } = useAudioStore.getState()
        if (isCapturing) {
          stopCapture()
        } else {
          startCapture()
        }
      }),
      window.electronAPI.onToggleSettings(() => {
        setSettingsOpen((prev) => !prev)
      }),
    ]
    return () => unsubs.forEach((unsub) => unsub())
  }, [toggleScope])

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

      {settingsOpen && (
        <div className="prism-settings-region" style={{ height: settingsHeight }}>
          <SettingsPanel onHeightChange={setSettingsPanelHeight} />
          <BottomBar onClose={handleCloseSettings} onHeightChange={setBottomBarHeight} />
        </div>
      )}

      <WindowResizeOverlay />
    </div>
  )
}

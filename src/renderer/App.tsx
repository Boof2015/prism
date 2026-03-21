import { useState, useRef, useCallback, useEffect, type JSX } from 'react'
import Strip from './components/Strip'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import { useSettingsStore } from './stores/settingsStore'
import { useAudioStore } from './stores/audioStore'
import { SCOPE_KINDS } from '../types/scope'

const DEFAULT_SETTINGS_PANEL_HEIGHT = 280

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(DEFAULT_SETTINGS_PANEL_HEIGHT)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedSettingsHeightRef = useRef(0)

  const toggleScope = useSettingsStore((s) => s.toggleScope)

  // Auto-capture on launch
  useEffect(() => {
    const { isCapturing, captureStatus, startCapture } = useAudioStore.getState()
    if (!isCapturing && captureStatus !== 'connecting') {
      void startCapture()
    }
  }, [])

  useEffect(() => {
    const nextHeight = settingsOpen ? settingsPanelHeight : 0
    if (appliedSettingsHeightRef.current !== nextHeight) {
      window.electronAPI.setSettingsHeight(nextHeight)
      appliedSettingsHeightRef.current = nextHeight
    }
  }, [settingsOpen, settingsPanelHeight])

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
    >
      <div
        className={`prism-toolbar-layer ${toolbarVisible ? 'is-visible' : ''}`.trim()}
      >
        <Toolbar onOpenSettings={handleToggleSettings} settingsOpen={settingsOpen} />
      </div>

      <div className="prism-strip-region">
        <Strip />
      </div>

      {settingsOpen && (
        <SettingsPanel
          onClose={handleCloseSettings}
          onHeightChange={setSettingsPanelHeight}
        />
      )}
    </div>
  )
}

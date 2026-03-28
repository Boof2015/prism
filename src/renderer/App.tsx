import { useState, useRef, useCallback, useEffect, useLayoutEffect, type JSX } from 'react'
import Strip from './components/Strip'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import BottomBar from './components/BottomBar'
import ScopePopoutBridge from './components/ScopePopoutBridge'
import { useSettingsStore } from './stores/settingsStore'
import { useAudioStore } from './stores/audioStore'
import { SCOPE_KINDS } from '../types/scope'

const SETTINGS_EXPAND_HEIGHT = 280

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevSettingsOpenRef = useRef(false)
  const startupBoundsAppliedRef = useRef(false)

  const toggleScope = useSettingsStore((s) => s.toggleScope)
  const profiles = useSettingsStore((s) => s.profiles)
  const activeProfileId = useSettingsStore((s) => s.activeProfileId)

  useLayoutEffect(() => {
    if (startupBoundsAppliedRef.current) return

    const profile = activeProfileId ? profiles[activeProfileId] : null
    startupBoundsAppliedRef.current = true

    if (profile?.windowBounds) {
      window.electronAPI.setWindowBounds(profile.windowBounds)
    }
  }, [activeProfileId, profiles])

  // Auto-capture on launch
  useEffect(() => {
    const { isCapturing, captureStatus, startCapture } = useAudioStore.getState()
    if (!isCapturing && captureStatus !== 'connecting') {
      void startCapture()
    }
  }, [])

  // Expand/collapse window by a fixed amount when settings toggle — no dynamic tracking
  useEffect(() => {
    if (settingsOpen && !prevSettingsOpenRef.current) {
      window.electronAPI.expandSettings(SETTINGS_EXPAND_HEIGHT)
    } else if (!settingsOpen && prevSettingsOpenRef.current) {
      window.electronAPI.collapseSettings(SETTINGS_EXPAND_HEIGHT)
    }
    prevSettingsOpenRef.current = settingsOpen
  }, [settingsOpen])

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
        <div className="prism-settings-region" style={{ height: SETTINGS_EXPAND_HEIGHT }}>
          <SettingsPanel />
          <BottomBar onClose={handleCloseSettings} />
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useCallback, useEffect } from 'react'
import Strip from './components/Strip'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import { useSettingsStore } from './stores/settingsStore'
import { useAudioStore } from './stores/audioStore'
import { SCOPE_KINDS } from '../types/scope'

const SETTINGS_PANEL_HEIGHT = 200

export default function App(): JSX.Element {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsExpandedRef = useRef(false)

  const toggleScope = useSettingsStore((s) => s.toggleScope)

  // Auto-capture on launch
  useEffect(() => {
    useAudioStore.getState().startCapture()
  }, [])

  // Settings panel window resize — single stable effect, no double-fire
  useEffect(() => {
    if (settingsOpen && !settingsExpandedRef.current) {
      settingsExpandedRef.current = true
      window.electronAPI.expandSettings(SETTINGS_PANEL_HEIGHT)
    } else if (!settingsOpen && settingsExpandedRef.current) {
      settingsExpandedRef.current = false
      window.electronAPI.collapseSettings(SETTINGS_PANEL_HEIGHT)
    }
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
      style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleHide}
    >
      {/* Toolbar overlay — fades in on hover */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          opacity: toolbarVisible ? 1 : 0,
          transition: 'opacity 150ms ease',
          pointerEvents: toolbarVisible ? 'auto' : 'none',
        }}
      >
        <Toolbar onOpenSettings={handleToggleSettings} settingsOpen={settingsOpen} />
      </div>

      {/* Scope strip — fills all available space */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Strip />
      </div>

      {/* Settings panel — expands below strip */}
      {settingsOpen && <SettingsPanel onClose={handleCloseSettings} />}
    </div>
  )
}

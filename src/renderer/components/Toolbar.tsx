import { useState, useEffect, useCallback, useRef, type CSSProperties, type JSX } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.7v2M8 12.3v2M14.3 8h-2M3.7 8h-2M12.4 3.6l-1.4 1.4M5 11l-1.4 1.4M12.4 12.4 11 11M5 5 3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function PinIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.9 2.5 13 4.6 10.8 7v2.2l-1 1L8 8.4 4.8 11.6 4 10.8l3.2-3.2-1.8-1.8 1-1H8.6z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function GripIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5.5" cy="4" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="4" r="1.2" fill="currentColor" />
      <circle cx="5.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="12" r="1.2" fill="currentColor" />
    </svg>
  )
}

function MinimizeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function RepositionIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4-3 4 3M4 10l4 3 4-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 10, height: 10 }}>
      <path d="M5 6l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface ToolbarProps {
  onOpenSettings: () => void
  settingsOpen: boolean
}

const DEFAULT_PROFILE_ID = 'profile_default'

export default function Toolbar({ onOpenSettings, settingsOpen }: ToolbarProps): JSX.Element {
  const profiles = useSettingsStore((s) => s.profiles)
  const activeProfileId = useSettingsStore((s) => s.activeProfileId)
  const saveProfile = useSettingsStore((s) => s.saveProfile)
  const loadProfile = useSettingsStore((s) => s.loadProfile)
  const deleteProfile = useSettingsStore((s) => s.deleteProfile)
  const renameProfile = useSettingsStore((s) => s.renameProfile)
  const updateActiveProfile = useSettingsStore((s) => s.updateActiveProfile)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true)
  const [showReposition, setShowReposition] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  const handleSaveNew = useCallback(() => {
    const count = Object.keys(useSettingsStore.getState().profiles).length
    saveProfile(`Profile ${count}`)
    setIsProfileMenuOpen(false)
  }, [saveProfile])

  const handleSaveOverwrite = useCallback(() => {
    updateActiveProfile()
    setIsProfileMenuOpen(false)
  }, [updateActiveProfile])

  const handleRenameActive = useCallback((id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    const nextName = window.prompt('Rename preset', profile.name)?.trim()
    if (nextName) {
      renameProfile(id, nextName)
    }
    setIsProfileMenuOpen(false)
  }, [renameProfile])

  const handleDeleteActive = useCallback((id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    if (!window.confirm(`Delete "${profile.name}"?`)) {
      setIsProfileMenuOpen(false)
      return
    }

    deleteProfile(id)
    setIsProfileMenuOpen(false)
  }, [deleteProfile])

  useEffect(() => {
    const offClosed = window.electronAPI.onProfileMenuClosed(() => {
      setIsProfileMenuOpen(false)
    })
    const offLoad = window.electronAPI.onProfileMenuLoad((id) => {
      loadProfile(id)
      setIsProfileMenuOpen(false)
    })
    const offSaveNew = window.electronAPI.onProfileMenuSaveNew(handleSaveNew)
    const offSaveOverwrite = window.electronAPI.onProfileMenuSaveOverwrite(handleSaveOverwrite)
    const offRename = window.electronAPI.onProfileMenuRenameActive(handleRenameActive)
    const offDelete = window.electronAPI.onProfileMenuDeleteActive(handleDeleteActive)

    return () => {
      offClosed()
      offLoad()
      offSaveNew()
      offSaveOverwrite()
      offRename()
      offDelete()
    }
  }, [handleDeleteActive, handleRenameActive, handleSaveNew, handleSaveOverwrite, loadProfile])

  const handlePin = useCallback(() => {
    window.electronAPI.toggleAlwaysOnTop()
  }, [])

  const handleReposition = useCallback((position: 'top' | 'bottom') => {
    window.electronAPI.repositionWindow(position)
    setShowReposition(false)
  }, [])

  const handleOpenProfileMenu = useCallback(() => {
    const buttonRect = profileButtonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setShowReposition(false)
    setIsProfileMenuOpen(true)
    window.electronAPI.openProfileMenu({
      x: Math.round(buttonRect.left),
      y: Math.round(buttonRect.bottom + 4),
      activeProfileId,
      profiles: Object.entries(profiles).map(([id, profile]) => ({
        id,
        name: profile.name,
        isDefault: id === DEFAULT_PROFILE_ID,
      })),
    })
  }, [activeProfileId, profiles])

  const activeProfile = activeProfileId ? profiles[activeProfileId] : null

  return (
    <div className="toolbar">
      <div
        className="toolbar__grab"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        title="Drag to move window"
      >
        <GripIcon />
      </div>

      <div
        className="toolbar__brand"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <span className="toolbar__brand-mark" />
        <span className="toolbar__brand-text">Prism</span>
      </div>

      <div className="toolbar__profile">
        <button
          ref={profileButtonRef}
          type="button"
          className={`toolbar__profile-button ${isProfileMenuOpen ? 'is-active' : ''}`.trim()}
          onClick={handleOpenProfileMenu}
          title="Presets"
        >
          <span className="toolbar__profile-name">
            {activeProfile?.name ?? 'Presets'}
          </span>
          <ChevronIcon />
        </button>
      </div>

      <div
        className="toolbar__spacer"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />

      <div className="toolbar__actions">
        <div className="toolbar__reposition-wrap">
          <button
            type="button"
            className={`toolbar__icon-button ${showReposition ? 'is-active' : ''}`.trim()}
            onClick={() => setShowReposition((prev) => !prev)}
            title="Reposition window"
            aria-label="Reposition window"
          >
            <RepositionIcon />
          </button>
          {showReposition && (
            <div className="toolbar__reposition-menu">
              <button
                type="button"
                className="toolbar__reposition-option"
                onClick={() => handleReposition('top')}
              >
                Top
              </button>
              <button
                type="button"
                className="toolbar__reposition-option"
                onClick={() => handleReposition('bottom')}
              >
                Bottom
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`toolbar__icon-button ${settingsOpen ? 'is-active' : ''}`.trim()}
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>

        <button
          type="button"
          className={`toolbar__icon-button ${isAlwaysOnTop ? 'is-active' : ''}`.trim()}
          onClick={handlePin}
          title={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
          aria-label={isAlwaysOnTop ? 'Unpin from top' : 'Pin to top'}
        >
          <PinIcon />
        </button>

        <button
          type="button"
          className="toolbar__icon-button"
          onClick={() => window.electronAPI.minimize()}
          title="Minimize"
          aria-label="Minimize"
        >
          <MinimizeIcon />
        </button>

        <button
          type="button"
          className="toolbar__icon-button toolbar__icon-button--danger"
          onClick={() => window.electronAPI.close()}
          title="Close"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

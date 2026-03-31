import { useState, useEffect, useCallback, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <g fill="currentColor">
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(60 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(120 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(180 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(240 8 8)" />
        <rect x="7.15" y="1.15" width="1.7" height="2.7" rx="0.45" transform="rotate(300 8 8)" />
      </g>
      <circle cx="8" cy="8" r="3.45" fill="none" stroke="currentColor" strokeWidth="1.85" />
      <circle cx="8" cy="8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.05" />
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

function isToolbarInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button, .toolbar__reposition-menu') !== null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

export default function Toolbar({ onOpenSettings, settingsOpen }: ToolbarProps): JSX.Element {
  const profiles = useSettingsStore((s) => s.profiles)
  const activeProfileId = useSettingsStore((s) => s.activeProfileId)
  const hasUnsavedProfileChanges = useSettingsStore((s) => s.hasUnsavedProfileChanges)
  const guardProfileTransition = useSettingsStore((s) => s.guardProfileTransition)
  const saveProfile = useSettingsStore((s) => s.saveProfile)
  const loadProfile = useSettingsStore((s) => s.loadProfile)
  const deleteProfile = useSettingsStore((s) => s.deleteProfile)
  const renameProfile = useSettingsStore((s) => s.renameProfile)
  const updateActiveProfile = useSettingsStore((s) => s.updateActiveProfile)
  const importProfileFromDialog = useSettingsStore((s) => s.importProfileFromDialog)
  const showProfilesFolder = useSettingsStore((s) => s.showProfilesFolder)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [showReposition, setShowReposition] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  const handleSaveNew = useCallback(async () => {
    const count = Object.keys(useSettingsStore.getState().profiles).length
    try {
      await saveProfile(`Profile ${count}`)
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not save the profile.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [saveProfile])

  const handleSaveOverwrite = useCallback(async () => {
    try {
      await updateActiveProfile()
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not update the active profile.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [updateActiveProfile])

  const handleRenameActive = useCallback(async (id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    const nextName = window.prompt('Rename profile', profile.name)?.trim()
    if (!nextName) {
      setIsProfileMenuOpen(false)
      return
    }

    try {
      await renameProfile(id, nextName)
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not rename the profile.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [renameProfile])

  const handleDeleteActive = useCallback(async (id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    if (!window.confirm(`Delete "${profile.name}"?`)) {
      setIsProfileMenuOpen(false)
      return
    }

    try {
      await deleteProfile(id)
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not delete the profile.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [deleteProfile])

  const handleLoadProfile = useCallback(async (id: string) => {
    try {
      await guardProfileTransition(async () => {
        await loadProfile(id)
      })
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not load the profile.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [guardProfileTransition, loadProfile])

  const handleImportProfile = useCallback(async () => {
    try {
      await guardProfileTransition(async () => {
        await importProfileFromDialog()
      })
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not import the profile file.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [guardProfileTransition, importProfileFromDialog])

  const handleShowProfilesFolder = useCallback(async () => {
    try {
      await showProfilesFolder()
    } catch (error) {
      window.alert(getErrorMessage(error, 'Could not open the profiles folder.'))
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [showProfilesFolder])

  useEffect(() => {
    const offClosed = window.electronAPI.onProfileMenuClosed(() => {
      setIsProfileMenuOpen(false)
    })
    const offLoad = window.electronAPI.onProfileMenuLoad((id) => {
      void handleLoadProfile(id)
    })
    const offSaveNew = window.electronAPI.onProfileMenuSaveNew(() => {
      void handleSaveNew()
    })
    const offSaveOverwrite = window.electronAPI.onProfileMenuSaveOverwrite(() => {
      void handleSaveOverwrite()
    })
    const offRename = window.electronAPI.onProfileMenuRenameActive((id) => {
      void handleRenameActive(id)
    })
    const offDelete = window.electronAPI.onProfileMenuDeleteActive((id) => {
      void handleDeleteActive(id)
    })
    const offImport = window.electronAPI.onProfileMenuImport(() => {
      void handleImportProfile()
    })
    const offShowFolder = window.electronAPI.onProfileMenuShowFolder(() => {
      void handleShowProfilesFolder()
    })

    return () => {
      offClosed()
      offLoad()
      offSaveNew()
      offSaveOverwrite()
      offRename()
      offDelete()
      offImport()
      offShowFolder()
    }
  }, [
    handleDeleteActive,
    handleImportProfile,
    handleLoadProfile,
    handleRenameActive,
    handleSaveNew,
    handleSaveOverwrite,
    handleShowProfilesFolder,
  ])

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

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [])

  const handleDragEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [])

  const handleToolbarDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (isToolbarInteractiveTarget(event.target) || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [])

  const handleToolbarDragEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [])

  const activeProfile = activeProfileId ? profiles[activeProfileId] : null

  return (
    <div
      className="toolbar"
      onPointerDown={handleToolbarDragStart}
      onPointerUp={handleToolbarDragEnd}
      onPointerCancel={handleToolbarDragEnd}
      onLostPointerCapture={handleToolbarDragEnd}
    >
      <button
        type="button"
        className="toolbar__grab"
        onPointerDown={handleDragStart}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onLostPointerCapture={handleDragEnd}
        title="Drag window"
        aria-label="Drag window"
      >
        <GripIcon />
      </button>

      <div
        className="toolbar__brand"
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
          title="Profiles"
        >
          <span className="toolbar__profile-name">
            {activeProfile?.name ?? 'Profiles'}
          </span>
          {hasUnsavedProfileChanges ? <span className="toolbar__profile-dirty-dot" aria-hidden="true" /> : null}
          <ChevronIcon />
        </button>
      </div>

      <div className="toolbar__spacer" />

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

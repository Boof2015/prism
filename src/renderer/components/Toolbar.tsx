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
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  // Close profile menu on outside click
  useEffect(() => {
    if (!showProfileMenu) return
    const handleClick = (e: MouseEvent): void => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showProfileMenu])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const handlePin = useCallback(() => {
    window.electronAPI.toggleAlwaysOnTop()
  }, [])

  const handleReposition = useCallback((position: 'top' | 'bottom') => {
    window.electronAPI.repositionWindow(position)
    setShowReposition(false)
  }, [])

  const handleSaveNew = useCallback(() => {
    const count = Object.keys(profiles).length
    saveProfile(`Profile ${count}`)
    setShowProfileMenu(false)
  }, [profiles, saveProfile])

  const handleSaveOverwrite = useCallback(() => {
    updateActiveProfile()
    setShowProfileMenu(false)
  }, [updateActiveProfile])

  const handleStartRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }, [])

  const handleFinishRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameProfile(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }, [renamingId, renameValue, renameProfile])

  const profileIds = Object.keys(profiles)
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

      <div className="toolbar__profile" ref={profileMenuRef}>
        <button
          type="button"
          className={`toolbar__profile-button ${showProfileMenu ? 'is-active' : ''}`.trim()}
          onClick={() => setShowProfileMenu((prev) => !prev)}
          title="Presets"
        >
          <span className="toolbar__profile-name">
            {activeProfile?.name ?? 'Presets'}
          </span>
          <ChevronIcon />
        </button>

        {showProfileMenu && (
          <div className="toolbar__profile-menu">
            <div className="toolbar__profile-menu-section">
              <div className="toolbar__profile-menu-label">Presets</div>
              {profileIds.map((id) => {
                const profile = profiles[id]
                const isActive = id === activeProfileId
                const isDefault = id === 'profile_default'

                if (renamingId === id) {
                  return (
                    <div key={id} className="toolbar__profile-menu-item">
                      <input
                        ref={renameInputRef}
                        className="toolbar__profile-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRename()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                      />
                    </div>
                  )
                }

                return (
                  <div
                    key={id}
                    className={`toolbar__profile-menu-item ${isActive ? 'is-active' : ''}`.trim()}
                  >
                    <button
                      type="button"
                      className="toolbar__profile-menu-item-name"
                      onClick={() => {
                        loadProfile(id)
                        setShowProfileMenu(false)
                      }}
                    >
                      {isActive && <span className="toolbar__profile-check">&#10003;</span>}
                      {profile.name}
                    </button>
                    {!isDefault && (
                      <div className="toolbar__profile-menu-item-actions">
                        <button
                          type="button"
                          className="toolbar__profile-menu-action"
                          onClick={() => handleStartRename(id, profile.name)}
                          title="Rename"
                        >
                          &#9998;
                        </button>
                        <button
                          type="button"
                          className="toolbar__profile-menu-action toolbar__profile-menu-action--danger"
                          onClick={() => deleteProfile(id)}
                          title="Delete"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="toolbar__profile-menu-divider" />

            <button
              type="button"
              className="toolbar__profile-menu-action-row"
              onClick={handleSaveNew}
            >
              Save as New Preset
            </button>
            {activeProfileId && (
              <button
                type="button"
                className="toolbar__profile-menu-action-row"
                onClick={handleSaveOverwrite}
              >
                Save to "{activeProfile?.name}"
              </button>
            )}
          </div>
        )}
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

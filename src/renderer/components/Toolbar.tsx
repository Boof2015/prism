import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AppBuildInfo } from '../../types/appBuildInfo'
import { useSettingsStore } from '../stores/settingsStore'
import { useUpdateStore } from '../stores/updateStore'
import { useUiStore } from '../stores/uiStore'
import { useAudioStore } from '../stores/audioStore'
import { getRendererWindowCapabilities } from '../windowCapabilities'
import PrismLogo from './PrismLogo'

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 118 118" aria-hidden="true">
      <path d="M104.811 35.1118L102.384 30.9002C100.549 27.7151 99.6313 26.1225 98.0697 25.4874C96.5082 24.8524 94.7421 25.3535 91.2105 26.3557L85.2112 28.0456C82.9564 28.5655 80.5905 28.2706 78.5319 27.2127L76.8755 26.2571C75.1099 25.1263 73.7519 23.4591 73.0002 21.4993L71.3585 16.5955C70.2788 13.3504 69.7389 11.7279 68.4537 10.7998C67.169 9.87175 65.4619 9.87175 62.0478 9.87175H56.5667C53.1531 9.87175 51.446 9.87175 50.1608 10.7998C48.8758 11.7279 48.336 13.3504 47.2564 16.5955L45.6145 21.4993C44.8628 23.4591 43.5048 25.1263 41.7394 26.2571L40.083 27.2127C38.0242 28.2706 35.6585 28.5655 33.4037 28.0456L27.4042 26.3557C23.8724 25.3535 22.1065 24.8524 20.5451 25.4874C18.9836 26.1225 18.066 27.7151 16.2306 30.9002L13.8038 35.1118C12.0834 38.0975 11.2232 39.5903 11.3902 41.1795C11.5571 42.7687 12.7087 44.0493 15.0118 46.6106L20.0811 52.2779C21.3201 53.8464 22.1997 56.58 22.1997 59.0379C22.1997 61.4967 21.3204 64.2294 20.0812 65.7983L15.0118 71.4657C12.7087 74.0273 11.5572 75.3076 11.3902 76.8972C11.2232 78.4862 12.0834 79.9789 13.8038 82.9643L16.2306 87.1759C18.0659 90.361 18.9836 91.954 20.5451 92.5887C22.1065 93.2239 23.8724 92.7229 27.4043 91.7204L33.4035 90.0306C35.6587 89.5104 38.0248 89.8059 40.0839 90.8639L41.74 91.8197C43.5051 92.9506 44.8628 94.6173 45.6143 96.5771L47.2564 101.481C48.336 104.726 48.8758 106.349 50.1608 107.277C51.446 108.205 53.1531 108.205 56.5667 108.205H62.0478C65.4619 108.205 67.169 108.205 68.4537 107.277C69.7389 106.349 70.2788 104.726 71.3585 101.481L73.0007 96.5771C73.7519 94.6173 75.1094 92.9506 76.875 91.8197L78.5309 90.8639C80.59 89.8059 82.9559 89.5104 85.2112 90.0306L91.2105 91.7204C94.7421 92.7229 96.5082 93.2239 98.0697 92.5887C99.6313 91.954 100.549 90.361 102.384 87.1759L104.811 82.9643C106.531 79.9789 107.391 78.4862 107.225 76.8972C107.057 75.3076 105.906 74.0273 103.603 71.4657L98.5334 65.7983C97.2944 64.2294 96.4148 61.4967 96.4148 59.0379C96.4148 56.58 97.2949 53.8464 98.5334 52.2779L103.603 46.6106C105.906 44.0493 107.057 42.7687 107.225 41.1795C107.391 39.5903 106.531 38.0975 104.811 35.1118Z" fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
      <path d="M76.3042 59C76.3042 68.5039 68.5998 76.2083 59.0959 76.2083C49.592 76.2083 41.8877 68.5039 41.8877 59C41.8877 49.4961 49.592 41.7917 59.0959 41.7917C68.5998 41.7917 76.3042 49.4961 76.3042 59Z" fill="none" stroke="currentColor" strokeWidth="8.5" />
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
const PRISM_SUPPORT_URL = 'https://ko-fi.com/boof2015'
const WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE = 'Top/bottom repositioning is unavailable on native Wayland.'

function isToolbarInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button, .toolbar__reposition-menu') !== null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

interface AppVersionBlockProps {
  buildInfo: AppBuildInfo | null
  updateAvailable: boolean
  latestTag: string | null
  releaseName: string | null
  onOpenUpdate: () => void
}

function AppVersionBlock({
  buildInfo,
  updateAvailable,
  latestTag,
  releaseName,
  onOpenUpdate,
}: AppVersionBlockProps): JSX.Element | null {
  if (!buildInfo?.version) {
    return null
  }

  const versionLabel = `v${buildInfo.version}`
  const commitLabel = buildInfo.shortCommitHash
    ? `${buildInfo.shortCommitHash}${buildInfo.isDirty ? '*' : ''}`
    : ''
  const releaseLabel = latestTag
    ? `${latestTag}${releaseName ? ` (${releaseName})` : ''}`
    : 'the latest release'
  const buildTooltip = buildInfo.commitHash
    ? `Prism ${versionLabel}\nCommit: ${buildInfo.commitHash}${buildInfo.isDirty ? '\nWorking tree was dirty when this build started.' : ''}`
    : `Prism ${versionLabel}`
  const title = updateAvailable
    ? `Update available: ${releaseLabel}. Open release.`
    : buildTooltip
  const content = (
    <>
      {updateAvailable ? <span className="toolbar__version-update-dot" aria-hidden="true" /> : null}
      <span className="toolbar__version-number">{versionLabel}</span>
      {commitLabel ? (
        <>
          <span className="toolbar__version-separator" aria-hidden="true">·</span>
          <span className="toolbar__version-commit">{commitLabel}</span>
        </>
      ) : null}
    </>
  )

  if (updateAvailable) {
    return (
      <button
        type="button"
        className="toolbar__version is-update-available"
        onClick={onOpenUpdate}
        title={title}
        aria-label={`Update available: ${releaseLabel}. Open release.`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="toolbar__version" title={title} aria-label={buildTooltip}>
      {content}
    </div>
  )
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
  const showBanner = useUiStore((s) => s.showBanner)
  const updateAvailable = useUpdateStore((s) => s.updateAvailable)
  const latestTag = useUpdateStore((s) => s.latestTag)
  const releaseName = useUpdateStore((s) => s.releaseName)
  const openReleasesPage = useUpdateStore((s) => s.openReleasesPage)
  const rollingCaptureSeconds = useAudioStore((s) => s.rollingCaptureSeconds)
  const rollingCaptureStatus = useAudioStore((s) => s.rollingCaptureStatus)
  const startRollingClipDrag = useAudioStore((s) => s.startRollingClipDrag)
  const [appBuildInfo, setAppBuildInfo] = useState<AppBuildInfo | null>(null)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [showReposition, setShowReposition] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const { useNativeDragRegions, supportsProgrammaticReposition } = getRendererWindowCapabilities()

  const showProfileErrorBanner = useCallback((error: unknown, fallback: string, includeOpenFolder = false) => {
    const actions = includeOpenFolder
      ? [{
          label: 'Open Folder',
          onSelect: async () => {
            try {
              await showProfilesFolder()
            } catch (folderError) {
              showBanner({
                tone: 'error',
                message: getErrorMessage(folderError, 'Could not open the profiles folder.'),
                actions: [],
              })
            }
          },
        }]
      : []

    showBanner({
      tone: 'error',
      message: getErrorMessage(error, fallback),
      actions,
    })
  }, [showBanner, showProfilesFolder])

  useEffect(() => {
    void window.electronAPI.isAlwaysOnTop().then(setIsAlwaysOnTop)
    const unsubscribe = window.electronAPI.onAlwaysOnTopChanged(setIsAlwaysOnTop)
    return unsubscribe
  }, [])

  useEffect(() => {
    let isMounted = true

    void window.electronAPI.getAppBuildInfo()
      .then((buildInfo) => {
        if (isMounted) {
          setAppBuildInfo(buildInfo)
        }
      })
      .catch(() => {
        // Keep the toolbar usable if build metadata is unavailable.
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!supportsProgrammaticReposition && showReposition) {
      setShowReposition(false)
    }
  }, [showReposition, supportsProgrammaticReposition])

  const handleSaveNew = useCallback(async () => {
    setIsProfileMenuOpen(false)
    const result = await window.electronAPI.showDialog({
      type: 'prompt',
      title: 'Save as New Profile',
      message: 'Enter a name for the new profile.',
      buttons: ['Save', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      defaultValue: '',
      placeholder: 'Profile name',
    })
    if (result.buttonIndex !== 0 || !result.value?.trim()) return
    try {
      await saveProfile(result.value.trim())
    } catch (error) {
      showProfileErrorBanner(error, 'Could not save the profile.')
    }
  }, [saveProfile, showProfileErrorBanner])

  const handleSaveOverwrite = useCallback(async () => {
    try {
      await updateActiveProfile()
    } catch (error) {
      showProfileErrorBanner(error, 'Could not update the active profile.')
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [showProfileErrorBanner, updateActiveProfile])

  const handleRenameActive = useCallback(async (id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    setIsProfileMenuOpen(false)
    const result = await window.electronAPI.showDialog({
      type: 'prompt',
      title: 'Rename Profile',
      message: `New name for "${profile.name}"`,
      buttons: ['Rename', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      defaultValue: profile.name,
    })
    if (result.buttonIndex !== 0 || !result.value?.trim()) return

    try {
      await renameProfile(id, result.value.trim())
    } catch (error) {
      showProfileErrorBanner(error, 'Could not rename the profile.')
    }
  }, [renameProfile, showProfileErrorBanner])

  const handleDeleteActive = useCallback(async (id: string) => {
    const profile = useSettingsStore.getState().profiles[id]
    if (!profile || id === DEFAULT_PROFILE_ID) {
      setIsProfileMenuOpen(false)
      return
    }

    setIsProfileMenuOpen(false)
    const result = await window.electronAPI.showDialog({
      type: 'confirm',
      title: 'Delete Profile',
      message: `Delete "${profile.name}"?`,
      detail: 'This cannot be undone.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
    if (result.buttonIndex !== 0) return

    try {
      await deleteProfile(id)
    } catch (error) {
      showProfileErrorBanner(error, 'Could not delete the profile.')
    }
  }, [deleteProfile, showProfileErrorBanner])

  const handleLoadProfile = useCallback(async (id: string) => {
    try {
      await guardProfileTransition(async () => {
        await loadProfile(id)
      })
    } catch (error) {
      showProfileErrorBanner(error, 'Could not load the profile.', true)
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [guardProfileTransition, loadProfile, showProfileErrorBanner])

  const handleImportProfile = useCallback(async () => {
    try {
      await guardProfileTransition(async () => {
        await importProfileFromDialog()
      })
    } catch (error) {
      showProfileErrorBanner(error, 'Could not import the profile file.', true)
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [guardProfileTransition, importProfileFromDialog, showProfileErrorBanner])

  const handleShowProfilesFolder = useCallback(async () => {
    try {
      await showProfilesFolder()
    } catch (error) {
      showProfileErrorBanner(error, 'Could not open the profiles folder.')
    } finally {
      setIsProfileMenuOpen(false)
    }
  }, [showProfileErrorBanner, showProfilesFolder])

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

  const handleOpenUpdate = useCallback(() => {
    void openReleasesPage()
  }, [openReleasesPage])

  const handleOpenSupport = useCallback(() => {
    void window.electronAPI.openExternalUrl(PRISM_SUPPORT_URL).catch((error) => {
      showBanner({
        tone: 'error',
        message: getErrorMessage(error, 'Could not open Ko-fi.'),
        actions: [],
      })
    })
  }, [showBanner])

  const handleReposition = useCallback((position: 'top' | 'bottom') => {
    if (!supportsProgrammaticReposition) {
      return
    }

    window.electronAPI.repositionWindow(position)
    setShowReposition(false)
  }, [supportsProgrammaticReposition])

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

  const handleAudioClipDragStart = useCallback((event: ReactDragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    startRollingClipDrag()
  }, [startRollingClipDrag])

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (useNativeDragRegions || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [useNativeDragRegions])

  const handleDragEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (useNativeDragRegions) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [useNativeDragRegions])

  const handleToolbarDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (useNativeDragRegions || isToolbarInteractiveTarget(event.target) || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.electronAPI.startWindowMove()
  }, [useNativeDragRegions])

  const handleToolbarDragEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (useNativeDragRegions) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.electronAPI.stopWindowMove()
  }, [useNativeDragRegions])

  const activeProfile = activeProfileId ? profiles[activeProfileId] : null

  return (
    <div
      className={`toolbar ${useNativeDragRegions ? 'is-native-drag' : ''}`.trim()}
      onPointerDown={useNativeDragRegions ? undefined : handleToolbarDragStart}
      onPointerUp={useNativeDragRegions ? undefined : handleToolbarDragEnd}
      onPointerCancel={useNativeDragRegions ? undefined : handleToolbarDragEnd}
      onLostPointerCapture={useNativeDragRegions ? undefined : handleToolbarDragEnd}
    >
      <button
        type="button"
        className={`toolbar__grab ${useNativeDragRegions ? 'is-native-drag' : ''}`.trim()}
        onPointerDown={useNativeDragRegions ? undefined : handleDragStart}
        onPointerUp={useNativeDragRegions ? undefined : handleDragEnd}
        onPointerCancel={useNativeDragRegions ? undefined : handleDragEnd}
        onLostPointerCapture={useNativeDragRegions ? undefined : handleDragEnd}
        title="Drag window"
        aria-label="Drag window"
      >
        <GripIcon />
      </button>

      <button
        type="button"
        className="toolbar__brand"
        onClick={handleOpenSupport}
        title="Support Prism on Ko-fi"
        aria-label="Support Prism on Ko-fi"
      >
        <span className="toolbar__brand-logo">
          <PrismLogo />
        </span>
        <span className="toolbar__brand-heart" aria-hidden="true" />
      </button>

      <AppVersionBlock
        buildInfo={appBuildInfo}
        updateAvailable={updateAvailable}
        latestTag={latestTag}
        releaseName={releaseName}
        onOpenUpdate={handleOpenUpdate}
      />

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

      {rollingCaptureSeconds !== null ? (
        <button
          type="button"
          className={`toolbar__clip-chip ${rollingCaptureStatus.ready ? 'is-ready' : 'is-filling'}`.trim()}
          draggable={rollingCaptureStatus.hasAudio}
          disabled={!rollingCaptureStatus.hasAudio}
          onDragStart={handleAudioClipDragStart}
          title={rollingCaptureStatus.ready
            ? `Drag the latest ${rollingCaptureSeconds} seconds as a WAV file`
            : rollingCaptureStatus.hasAudio
              ? `Buffer filling; drag the audio captured so far (up to ${rollingCaptureSeconds} seconds)`
              : 'Waiting for captured audio'}
          aria-label={`Drag the latest ${rollingCaptureSeconds} seconds as a WAV file`}
        >
          <span className="toolbar__clip-dot" aria-hidden="true" />
          <span className="toolbar__clip-prefix">Clip </span>{rollingCaptureSeconds}s
        </button>
      ) : null}

      <div className="toolbar__spacer" />

      <div className="toolbar__actions">
        <div
          className="toolbar__reposition-wrap"
          title={!supportsProgrammaticReposition ? WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE : undefined}
        >
          <button
            type="button"
            className={`toolbar__icon-button ${showReposition ? 'is-active' : ''}`.trim()}
            onClick={() => setShowReposition((prev) => !prev)}
            title={supportsProgrammaticReposition ? 'Reposition window' : WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE}
            aria-label={supportsProgrammaticReposition ? 'Reposition window' : WAYLAND_REPOSITION_UNAVAILABLE_MESSAGE}
            disabled={!supportsProgrammaticReposition}
          >
            <RepositionIcon />
          </button>
          {showReposition && supportsProgrammaticReposition && (
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

import { create } from 'zustand'

export type UpdateCheckState = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'

interface UpdateStore {
  checkState: UpdateCheckState
  statusMessage: string
  updateAvailable: boolean
  currentVersion: string | null
  latestTag: string | null
  latestVersion: string | null
  releaseName: string | null
  releaseUrl: string | null
  lastCheckedAt: number | null
  checkForUpdates: () => Promise<void>
  openReleasesPage: (releaseUrl?: string | null) => Promise<void>
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  checkState: 'idle',
  statusMessage: 'Update check has not run.',
  updateAvailable: false,
  currentVersion: null,
  latestTag: null,
  latestVersion: null,
  releaseName: null,
  releaseUrl: null,
  lastCheckedAt: null,

  checkForUpdates: async () => {
    if (get().checkState === 'checking') return

    set({
      checkState: 'checking',
      statusMessage: 'Checking for updates...',
    })

    try {
      const result = await window.electronAPI.updates.checkForUpdates()
      const releaseUrl = result.releaseUrl?.trim() || null

      set({
        checkState: result.status,
        statusMessage: result.message,
        updateAvailable: result.updateAvailable,
        currentVersion: result.currentVersion,
        latestTag: result.latestTag,
        latestVersion: result.latestVersion,
        releaseName: result.releaseName,
        releaseUrl,
        lastCheckedAt: result.checkedAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      set({
        checkState: 'error',
        statusMessage: `Failed to check for updates: ${message}`,
        updateAvailable: false,
        lastCheckedAt: Date.now(),
      })
    }
  },

  openReleasesPage: async (releaseUrl?: string | null) => {
    try {
      const targetReleaseUrl = typeof releaseUrl === 'string' && releaseUrl.trim().length > 0
        ? releaseUrl
        : get().releaseUrl
      await window.electronAPI.updates.openReleasesPage(targetReleaseUrl ?? undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      set({
        checkState: 'error',
        statusMessage: `Failed to open releases page: ${message}`,
      })
    }
  },
}))

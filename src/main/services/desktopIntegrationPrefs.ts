import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_DESKTOP_INTEGRATION_PREFERENCES,
  type DesktopIntegrationPreferences,
} from '../../types/desktopIntegration'

export function normalizeDesktopIntegrationPreferences(value: unknown): DesktopIntegrationPreferences {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_DESKTOP_INTEGRATION_PREFERENCES }
  }

  const candidate = value as Partial<DesktopIntegrationPreferences>
  return {
    closeToTray: candidate.closeToTray === true,
    loginLaunchMode: candidate.loginLaunchMode === 'tray' ? 'tray' : 'show',
  }
}

export async function loadDesktopIntegrationPreferences(
  filePath: string,
): Promise<DesktopIntegrationPreferences> {
  try {
    return normalizeDesktopIntegrationPreferences(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return { ...DEFAULT_DESKTOP_INTEGRATION_PREFERENCES }
  }
}

export async function saveDesktopIntegrationPreferences(
  filePath: string,
  preferences: DesktopIntegrationPreferences,
): Promise<DesktopIntegrationPreferences> {
  const normalized = normalizeDesktopIntegrationPreferences(preferences)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

export type MainWindowCloseDisposition = 'hide-to-tray' | 'close'

export function resolveMainWindowCloseDisposition(options: {
  closeToTray: boolean
  isAppQuitting: boolean
  trayAvailable: boolean
  windowRecreationPending: boolean
}): MainWindowCloseDisposition {
  return options.closeToTray
    && !options.isAppQuitting
    && !options.windowRecreationPending
    && options.trayAvailable
    ? 'hide-to-tray'
    : 'close'
}

export function resolveStartHiddenAtLogin(options: {
  isLoginLaunch: boolean
  loginLaunchMode: DesktopIntegrationPreferences['loginLaunchMode']
  hasPendingFileOpen: boolean
}): boolean {
  return options.isLoginLaunch
    && options.loginLaunchMode === 'tray'
    && !options.hasPendingFileOpen
}

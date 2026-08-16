import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  DesktopIntegrationPreferences,
  DesktopIntegrationSnapshot,
  LoginItemStatus,
} from '../../types/desktopIntegration'

export const LOGIN_LAUNCH_ARG = '--prism-login-launch'
const LINUX_AUTOSTART_FILENAME = 'com.astra.prism.desktop'

interface NativeLoginItemSettings {
  openAtLogin?: boolean
  wasOpenedAtLogin?: boolean
  status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'
  executableWillLaunchAtLogin?: boolean
}

interface LoginItemServiceOptions {
  platform: NodeJS.Platform
  isPackaged: boolean
  executablePath: string
  appImagePath?: string
  configHome?: string
  homePath: string
  getNativeSettings?: (options?: { path?: string; args?: string[] }) => NativeLoginItemSettings
  setNativeSettings?: (settings: {
    openAtLogin: boolean
    path?: string
    args?: string[]
    type?: 'mainAppService'
  }) => void
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Login item operation failed.'
}

export function resolveLinuxAutostartPath(configHome: string | undefined, homePath: string): string {
  const resolvedConfigHome = configHome && isAbsolute(configHome)
    ? configHome
    : join(homePath, '.config')
  return join(resolvedConfigHome, 'autostart', LINUX_AUTOSTART_FILENAME)
}

export function resolveLinuxLaunchExecutable(appImagePath: string | undefined, executablePath: string): string {
  return appImagePath && isAbsolute(appImagePath) ? appImagePath : executablePath
}

export function quoteDesktopExecArgument(value: string): string {
  const escaped = value.replace(/[\\"`$]/g, (character) => `\\${character}`)
  return `"${escaped}"`
}

export function buildLinuxAutostartEntry(executablePath: string): string {
  const executable = quoteDesktopExecArgument(executablePath)
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Prism',
    'Comment=Open Prism at login',
    `TryExec=${executable}`,
    `Exec=${executable} ${LOGIN_LAUNCH_ARG}`,
    'Terminal=false',
    'Hidden=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

export function resolveNativeLoginItemStatus(
  platform: NodeJS.Platform,
  settings: NativeLoginItemSettings,
): LoginItemStatus {
  if (platform === 'darwin') {
    if (settings.status === 'requires-approval') return 'requires-approval'
    return settings.openAtLogin || settings.status === 'enabled' ? 'enabled' : 'disabled'
  }

  if (platform === 'win32') {
    if (!settings.openAtLogin) return 'disabled'
    return settings.executableWillLaunchAtLogin === false ? 'blocked' : 'enabled'
  }

  return 'unavailable'
}

export function isLoginLaunch(platform: NodeJS.Platform, argv: string[], nativeSettings?: NativeLoginItemSettings): boolean {
  return platform === 'darwin'
    ? nativeSettings?.wasOpenedAtLogin === true
    : argv.includes(LOGIN_LAUNCH_ARG)
}

export class LoginItemService {
  constructor(private readonly options: LoginItemServiceOptions) {}

  isSupported(): boolean {
    return this.options.isPackaged
      && (this.options.platform === 'darwin'
        || this.options.platform === 'win32'
        || this.options.platform === 'linux')
  }

  wasOpenedAtLogin(argv: string[]): boolean {
    if (!this.isSupported()) return false
    try {
      return isLoginLaunch(
        this.options.platform,
        argv,
        this.options.platform === 'darwin' ? this.options.getNativeSettings?.() : undefined,
      )
    } catch {
      return false
    }
  }

  async getSnapshot(
    preferences: DesktopIntegrationPreferences,
  ): Promise<DesktopIntegrationSnapshot> {
    if (!this.isSupported()) {
      return {
        ...preferences,
        openAtLogin: false,
        loginItemStatus: 'unavailable',
        loginItemError: null,
      }
    }

    try {
      if (this.options.platform === 'linux') {
        const filePath = resolveLinuxAutostartPath(this.options.configHome, this.options.homePath)
        let contents = ''
        try {
          contents = await readFile(filePath, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          return {
            ...preferences,
            openAtLogin: false,
            loginItemStatus: 'disabled',
            loginItemError: null,
          }
        }
        const enabled = !/^\s*Hidden\s*=\s*true\s*$/im.test(contents)
        return {
          ...preferences,
          openAtLogin: enabled,
          loginItemStatus: enabled ? 'enabled' : 'disabled',
          loginItemError: null,
        }
      }

      const nativeOptions = this.options.platform === 'win32'
        ? { path: this.options.executablePath, args: [LOGIN_LAUNCH_ARG] }
        : undefined
      const settings = this.options.getNativeSettings?.(nativeOptions) ?? {}
      const loginItemStatus = resolveNativeLoginItemStatus(this.options.platform, settings)
      return {
        ...preferences,
        openAtLogin: settings.openAtLogin === true
          || loginItemStatus === 'enabled'
          || loginItemStatus === 'requires-approval'
          || loginItemStatus === 'blocked',
        loginItemStatus,
        loginItemError: null,
      }
    } catch (error) {
      return {
        ...preferences,
        openAtLogin: false,
        loginItemStatus: 'error',
        loginItemError: getErrorMessage(error),
      }
    }
  }

  async setOpenAtLogin(
    enabled: boolean,
    preferences: DesktopIntegrationPreferences,
  ): Promise<DesktopIntegrationSnapshot> {
    if (!this.isSupported()) {
      return this.getSnapshot(preferences)
    }

    try {
      if (this.options.platform === 'linux') {
        const filePath = resolveLinuxAutostartPath(this.options.configHome, this.options.homePath)
        if (enabled) {
          const executablePath = resolveLinuxLaunchExecutable(
            this.options.appImagePath,
            this.options.executablePath,
          )
          await mkdir(dirname(filePath), { recursive: true })
          await writeFile(filePath, buildLinuxAutostartEntry(executablePath), 'utf8')
        } else {
          await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        }
      } else if (this.options.platform === 'win32') {
        this.options.setNativeSettings?.({
          openAtLogin: enabled,
          path: this.options.executablePath,
          args: [LOGIN_LAUNCH_ARG],
        })
      } else {
        this.options.setNativeSettings?.({
          openAtLogin: enabled,
          type: 'mainAppService',
        })
      }
    } catch (error) {
      const current = await this.getSnapshot(preferences)
      return {
        ...current,
        loginItemStatus: 'error',
        loginItemError: getErrorMessage(error),
      }
    }

    return this.getSnapshot(preferences)
  }
}

import { join } from 'node:path'

export function getTrayAssetFilename(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'prismTrayTemplate.png'
  if (platform === 'win32') return 'prism-tray.ico'
  return 'prism-tray.png'
}

export function resolveTrayAssetPath(options: {
  platform: NodeJS.Platform
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  const directory = options.isPackaged
    ? join(options.resourcesPath, 'tray')
    : join(options.appPath, 'resources', 'tray')
  return join(directory, getTrayAssetFilename(options.platform))
}

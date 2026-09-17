import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativeWindowDockingAPI } from '../types/windowDocking'

const require = createRequire(import.meta.url)
export function loadNativeWindowDockingApi(): NativeWindowDockingAPI | null {
  if (process.platform !== 'win32') return null
  for (const path of [
    join(dirname(fileURLToPath(import.meta.url)), '../../native/build/Release/visualizer_dsp.node'),
    join(process.resourcesPath, 'native/visualizer_dsp.node'),
  ]) {
    try {
      const api = require(path).windowDocking as NativeWindowDockingAPI | undefined
      if (api && ['register', 'remove', 'lower', 'position', 'messages', 'workArea', 'fullscreen'].every(key => typeof api[key as keyof NativeWindowDockingAPI] === 'function')) return api
    } catch { /* An older/missing addon simply does not expose docking. */ }
  }
  return null
}

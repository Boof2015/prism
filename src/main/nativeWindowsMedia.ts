import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VisualizerDSP } from '../renderer/audio/native/visualizer-dsp'
import type { NativeCaptureAPI } from '../types/nativeCapture'
import type { NativeWindowsMediaAPI } from '../types/nativeWindowsMedia'

type NativeAddonModule = VisualizerDSP & NativeCaptureAPI & {
  windowsMedia?: NativeWindowsMediaAPI
}

const require = createRequire(import.meta.url)
const currentDir = dirname(fileURLToPath(import.meta.url))

export function loadNativeWindowsMediaApi(): NativeWindowsMediaAPI | null {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    const isDev = process.env.NODE_ENV === 'development'
    const modulePath = isDev
      ? join(currentDir, '../../native/build/Release/visualizer_dsp.node')
      : join(process.resourcesPath!, 'native/visualizer_dsp.node')
    const nativeAddon = require(modulePath) as NativeAddonModule
    return nativeAddon.windowsMedia ?? null
  } catch {
    return null
  }
}

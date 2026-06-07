import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VisualizerDSP } from '../renderer/audio/native/visualizer-dsp'
import type { NativeCaptureAPI } from '../types/nativeCapture'
import type { NativeWindowChromeAPI } from '../types/nativeWindowChrome'

type NativeAddonModule = VisualizerDSP & NativeCaptureAPI & {
  windowChrome?: NativeWindowChromeAPI
}

const require = createRequire(import.meta.url)
const currentDir = dirname(fileURLToPath(import.meta.url))

export function loadNativeWindowChromeApi(): NativeWindowChromeAPI | null {
  if (process.platform !== 'win32') {
    return null
  }

  const candidatePaths = [
    join(currentDir, '../../native/build/Release/visualizer_dsp.node'),
    process.resourcesPath ? join(process.resourcesPath, 'native/visualizer_dsp.node') : null,
  ].filter((value): value is string => value !== null)

  for (const modulePath of candidatePaths) {
    try {
      const nativeAddon = require(modulePath) as NativeAddonModule
      if (nativeAddon.windowChrome) {
        return nativeAddon.windowChrome
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return null
}

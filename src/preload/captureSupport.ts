import type { CaptureBackendSupport, CaptureBackendSupportEntry } from '../types/capture'
import { resolveNativeBackendKind } from '../types/capture'
import type { NativeCaptureAPI } from '../types/nativeCapture'

function getUnavailableNativeEntry(platform: string, reason: string): CaptureBackendSupportEntry {
  return {
    kind: resolveNativeBackendKind(platform),
    available: false,
    reason,
  }
}

export function resolveNativeCaptureSupport(
  platform: string,
  nativeCaptureAPI: NativeCaptureAPI | null,
): CaptureBackendSupportEntry {
  if (platform === 'darwin') {
    const macosCapture = nativeCaptureAPI?.macosCapture
    if (!macosCapture) {
      return getUnavailableNativeEntry(platform, 'Native capture module is not available in this build.')
    }

    const support = macosCapture.getSupport()
    return {
      kind: 'native-macos',
      available: support.available,
      reason: support.reason,
    }
  }

  if (platform === 'win32') {
    const windowsCapture = nativeCaptureAPI?.windowsCapture
    if (!windowsCapture) {
      return getUnavailableNativeEntry(platform, 'Native capture module is not available in this build.')
    }

    const support = windowsCapture.getSupport()
    return {
      kind: 'native-windows',
      available: support.available,
      reason: support.reason,
    }
  }

  const linuxCapture = nativeCaptureAPI?.linuxCapture
  if (!linuxCapture) {
    return getUnavailableNativeEntry(platform, 'Native capture module is not available in this build.')
  }

  const support = linuxCapture.getSupport()
  return {
    kind: 'native-linux',
    available: support.available,
    reason: support.reason,
  }
}

export function getCaptureBackendSupport(
  platform: string,
  nativeCaptureAPI: NativeCaptureAPI | null,
): CaptureBackendSupport {
  return {
    nativeBackend: resolveNativeCaptureSupport(platform, nativeCaptureAPI),
    deviceInput: {
      kind: 'device-input',
      available: true,
      reason: null,
    },
    dawBridge: {
      kind: 'daw-bridge',
      available: false,
      reason: 'The DAW bridge listener is still starting.',
    },
  }
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { getCaptureBackendSupport, resolveNativeCaptureSupport } from '../src/preload/captureSupport'
import type { NativeCaptureSupport, NativeSystemCaptureAPI } from '../src/types/nativeCapture'

function createNativeSystemCaptureAPI(support: NativeCaptureSupport): NativeSystemCaptureAPI {
  return {
    getSupport: () => support,
    listOutputDevices: () => [],
    start: () => ({
      sampleRate: 48000,
      channelCount: 2,
      deviceId: 'default',
      deviceLabel: 'Default',
    }),
    stop: () => {},
    drain: () => ({
      chunks: [],
      overwriteCount: 0,
      queueDepth: 0,
    }),
    nowMilliseconds: () => 0,
  }
}

test('getCaptureBackendSupport resolves Linux native support from the addon surface', () => {
  const support = getCaptureBackendSupport('linux', {
    macosCapture: createNativeSystemCaptureAPI({ available: false, reason: 'macOS only' }),
    windowsCapture: createNativeSystemCaptureAPI({ available: false, reason: 'Windows only' }),
    linuxCapture: createNativeSystemCaptureAPI({
      available: false,
      reason: 'PulseAudio connection failed.',
    }),
  })

  assert.deepEqual(support, {
    nativeBackend: {
      kind: 'native-linux',
      available: false,
      reason: 'PulseAudio connection failed.',
    },
    deviceInput: {
      kind: 'device-input',
      available: true,
      reason: null,
    },
  })
})

test('resolveNativeCaptureSupport returns a module-unavailable reason when the addon is missing', () => {
  assert.deepEqual(resolveNativeCaptureSupport('linux', null), {
    kind: 'native-linux',
    available: false,
    reason: 'Native capture module is not available in this build.',
  })
})

test('preload no longer exposes desktop source capture APIs', async () => {
  const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')

  assert.doesNotMatch(preloadSource, /getDesktopSources/)
  assert.doesNotMatch(preloadSource, /capture:get-backend-support/)
  assert.doesNotMatch(preloadSource, /audio:get-desktop-sources/)
})

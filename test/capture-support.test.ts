import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { getCaptureBackendSupport, resolveNativeCaptureSupport } from '../src/preload/captureSupport'
import type {
  NativeCaptureSupport,
  NativeDeviceInputCaptureAPI,
  NativeSystemCaptureAPI,
} from '../src/types/nativeCapture'

function createNativeSystemCaptureAPI(support: NativeCaptureSupport): NativeSystemCaptureAPI {
  return {
    getSupport: () => support,
    listOutputDevices: () => [],
    start: () => ({
      sampleRate: 48000,
      channelCount: 2,
      sourceChannelCount: 2,
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

function createNativeDeviceInputCaptureAPI(support: NativeCaptureSupport): NativeDeviceInputCaptureAPI {
  return {
    getSupport: () => support,
    listInputDevices: () => [],
    start: () => ({
      sampleRate: 48000,
      channelCount: 2,
      sourceChannelCount: 2,
      deviceId: 'default-input',
      deviceLabel: 'Default Input',
    }),
    setChannelRouting: (left, right) => ({ left, right }),
    stop: () => {},
    drain: () => ({ chunks: [], overwriteCount: 0, queueDepth: 0 }),
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
    deviceInputCapture: createNativeDeviceInputCaptureAPI({ available: false, reason: 'macOS only' }),
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
      channelRoutingAvailable: false,
    },
    dawBridge: {
      kind: 'daw-bridge',
      available: false,
      reason: 'The DAW bridge listener is still starting.',
    },
  })
})

test('getCaptureBackendSupport exposes macOS routing capability explicitly', () => {
  const macosCapture = createNativeSystemCaptureAPI({ available: true, reason: null })
  macosCapture.setChannelRouting = (left, right) => ({ left, right })
  const support = getCaptureBackendSupport('darwin', {
    macosCapture,
    windowsCapture: createNativeSystemCaptureAPI({ available: false, reason: 'Windows only' }),
    linuxCapture: createNativeSystemCaptureAPI({ available: false, reason: 'Linux only' }),
    deviceInputCapture: createNativeDeviceInputCaptureAPI({ available: true, reason: null }),
  })

  assert.equal(support.nativeBackend.channelRoutingAvailable, true)
  assert.equal(support.deviceInput.channelRoutingAvailable, true)
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
  assert.match(preloadSource, /vumeter: nativeAddonModule\.vumeter/)
})

test('packaged macOS builds declare audio capture privacy usage', async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
    build?: { mac?: { extendInfo?: Record<string, unknown> } }
  }
  const extendInfo = packageJson.build?.mac?.extendInfo

  assert.equal(typeof extendInfo?.NSMicrophoneUsageDescription, 'string')
  assert.equal(typeof extendInfo?.NSAudioCaptureUsageDescription, 'string')

  const entitlements = await readFile(
    join(process.cwd(), 'resources', 'entitlements.mac.plist'),
    'utf8',
  )
  assert.match(entitlements, /com\.apple\.security\.device\.audio-input/)
})

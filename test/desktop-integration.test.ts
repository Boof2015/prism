import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import test from 'node:test'
import {
  loadDesktopIntegrationPreferences,
  normalizeDesktopIntegrationPreferences,
  resolveMainWindowCloseDisposition,
  resolveStartHiddenAtLogin,
  saveDesktopIntegrationPreferences,
} from '../src/main/services/desktopIntegrationPrefs'
import {
  LOGIN_LAUNCH_ARG,
  LoginItemService,
  buildLinuxAutostartEntry,
  isLoginLaunch,
  quoteDesktopExecArgument,
  resolveLinuxAutostartPath,
  resolveLinuxLaunchExecutable,
  resolveNativeLoginItemStatus,
} from '../src/main/services/loginItem'
import {
  buildTrayMenuModel,
  normalizeTrayRendererState,
} from '../src/main/services/trayMenu'
import { TrayRendererCommandQueue } from '../src/main/services/trayRendererCommandQueue'
import {
  getTrayAssetFilename,
  resolveTrayAssetPath,
} from '../src/main/services/trayAssets'

function inspectPng(buffer: Buffer): {
  width: number
  height: number
  alphaValues: Set<number>
} {
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.equal(data[8], 8)
      assert.equal(data[9], 6)
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    offset += length + 12
  }

  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(width * height * bytesPerPixel)
  let rawOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset]
    rawOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const source = raw[rawOffset + x]
      const pixelOffset = (y * stride) + x
      const left = x >= bytesPerPixel ? pixels[pixelOffset - bytesPerPixel] : 0
      const up = y > 0 ? pixels[pixelOffset - stride] : 0
      const upLeft = y > 0 && x >= bytesPerPixel
        ? pixels[pixelOffset - stride - bytesPerPixel]
        : 0
      let decoded = source
      if (filter === 1) decoded += left
      else if (filter === 2) decoded += up
      else if (filter === 3) decoded += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const predictor = left + up - upLeft
        const leftDistance = Math.abs(predictor - left)
        const upDistance = Math.abs(predictor - up)
        const upLeftDistance = Math.abs(predictor - upLeft)
        decoded += leftDistance <= upDistance && leftDistance <= upLeftDistance
          ? left
          : upDistance <= upLeftDistance ? up : upLeft
      } else {
        assert.equal(filter, 0)
      }
      pixels[pixelOffset] = decoded & 0xff
    }
    rawOffset += stride
  }

  const alphaValues = new Set<number>()
  for (let index = 3; index < pixels.length; index += bytesPerPixel) {
    alphaValues.add(pixels[index])
  }
  return { width, height, alphaValues }
}

test('desktop integration preferences normalize to safe defaults and persist', async () => {
  assert.deepEqual(normalizeDesktopIntegrationPreferences(null), {
    closeToTray: false,
    loginLaunchMode: 'show',
  })
  assert.deepEqual(normalizeDesktopIntegrationPreferences({
    closeToTray: true,
    loginLaunchMode: 'tray',
  }), {
    closeToTray: true,
    loginLaunchMode: 'tray',
  })

  const directory = await mkdtemp(join(tmpdir(), 'prism-desktop-prefs-'))
  const filePath = join(directory, 'nested', 'desktop-integration.json')
  try {
    await saveDesktopIntegrationPreferences(filePath, {
      closeToTray: true,
      loginLaunchMode: 'tray',
    })
    assert.deepEqual(await loadDesktopIntegrationPreferences(filePath), {
      closeToTray: true,
      loginLaunchMode: 'tray',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('close-to-tray is used only when hiding cannot strand the app', () => {
  assert.equal(resolveMainWindowCloseDisposition({
    closeToTray: true,
    isAppQuitting: false,
    trayAvailable: true,
    windowRecreationPending: false,
  }), 'hide-to-tray')
  for (const override of [
    { closeToTray: false },
    { isAppQuitting: true },
    { trayAvailable: false },
    { windowRecreationPending: true },
  ]) {
    assert.equal(resolveMainWindowCloseDisposition({
      closeToTray: true,
      isAppQuitting: false,
      trayAvailable: true,
      windowRecreationPending: false,
      ...override,
    }), 'close')
  }
})

test('hidden login launch requires the login origin, tray preference, and no file open', () => {
  assert.equal(resolveStartHiddenAtLogin({
    isLoginLaunch: true,
    loginLaunchMode: 'tray',
    hasPendingFileOpen: false,
  }), true)
  assert.equal(resolveStartHiddenAtLogin({
    isLoginLaunch: false,
    loginLaunchMode: 'tray',
    hasPendingFileOpen: false,
  }), false)
  assert.equal(resolveStartHiddenAtLogin({
    isLoginLaunch: true,
    loginLaunchMode: 'show',
    hasPendingFileOpen: false,
  }), false)
  assert.equal(resolveStartHiddenAtLogin({
    isLoginLaunch: true,
    loginLaunchMode: 'tray',
    hasPendingFileOpen: true,
  }), false)
})

test('Linux autostart helpers use XDG paths, AppImage paths, and desktop-entry quoting', () => {
  assert.equal(
    resolveLinuxAutostartPath('/tmp/prism config', '/home/test'),
    '/tmp/prism config/autostart/com.astra.prism.desktop',
  )
  assert.equal(
    resolveLinuxAutostartPath('relative', '/home/test'),
    '/home/test/.config/autostart/com.astra.prism.desktop',
  )
  assert.equal(resolveLinuxLaunchExecutable('/apps/Prism.AppImage', '/tmp/.mount/prism'), '/apps/Prism.AppImage')
  assert.equal(resolveLinuxLaunchExecutable('relative', '/usr/bin/prism'), '/usr/bin/prism')
  assert.equal(quoteDesktopExecArgument('/apps/Prism $Nightly`"'), '"/apps/Prism \\$Nightly\\`\\\""')

  const entry = buildLinuxAutostartEntry('/apps/Prism Nightly.AppImage')
  assert.match(entry, /^\[Desktop Entry\]$/m)
  assert.match(entry, /^TryExec="\/apps\/Prism Nightly\.AppImage"$/m)
  assert.match(entry, new RegExp(`^Exec="/apps/Prism Nightly\\.AppImage" ${LOGIN_LAUNCH_ARG}$`, 'm'))
  assert.match(entry, /^Hidden=false$/m)
})

test('Linux login service writes, detects, and removes its user autostart entry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-linux-login-'))
  const configHome = join(directory, 'config')
  const preferences = { closeToTray: false, loginLaunchMode: 'tray' as const }
  const service = new LoginItemService({
    platform: 'linux',
    isPackaged: true,
    executablePath: '/tmp/.mount_Prism/prism',
    appImagePath: '/apps/Prism.AppImage',
    configHome,
    homePath: directory,
  })
  try {
    assert.equal((await service.getSnapshot(preferences)).openAtLogin, false)
    const enabled = await service.setOpenAtLogin(true, preferences)
    assert.equal(enabled.openAtLogin, true)
    assert.equal(enabled.loginItemStatus, 'enabled')
    const entryPath = resolveLinuxAutostartPath(configHome, directory)
    assert.match(await readFile(entryPath, 'utf8'), /^Exec="\/apps\/Prism\.AppImage" --prism-login-launch$/m)
    assert.equal((await service.setOpenAtLogin(false, preferences)).openAtLogin, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('login support reports native approval/blocking and stays unavailable in development', async () => {
  assert.equal(resolveNativeLoginItemStatus('darwin', {
    openAtLogin: true,
    status: 'requires-approval',
  }), 'requires-approval')
  assert.equal(resolveNativeLoginItemStatus('win32', {
    openAtLogin: true,
    executableWillLaunchAtLogin: false,
  }), 'blocked')
  assert.equal(isLoginLaunch('darwin', [], { wasOpenedAtLogin: true }), true)
  assert.equal(isLoginLaunch('win32', [LOGIN_LAUNCH_ARG]), true)

  const service = new LoginItemService({
    platform: 'darwin',
    isPackaged: false,
    executablePath: '/Applications/Prism.app',
    homePath: '/tmp',
  })
  assert.deepEqual(await service.getSnapshot({ closeToTray: false, loginLaunchMode: 'show' }), {
    closeToTray: false,
    loginLaunchMode: 'show',
    openAtLogin: false,
    loginItemStatus: 'unavailable',
    loginItemError: null,
  })
})

test('tray state validation and menu model expose capture, visibility, and checked state', () => {
  const rendererState = normalizeTrayRendererState({
    profiles: [{ id: 'default', name: 'Default' }],
    activeProfileId: 'default',
    hasUnsavedProfileChanges: true,
    captureStatus: 'capturing',
    activeSourceLabel: 'Studio Output',
    captureMode: 'system',
    selectedSystemSourceId: 'output-1',
    selectedDeviceId: null,
    rollingCaptureSeconds: 30,
    systemSources: [{ id: 'output-1', label: 'Studio Output' }],
    inputSources: [{ id: '', label: 'Default Input' }],
  })
  const model = buildTrayMenuModel({
    mainWindowVisible: false,
    rendererReady: true,
    rendererState,
    desktopIntegration: {
      closeToTray: true,
      loginLaunchMode: 'tray',
      openAtLogin: true,
      loginItemStatus: 'enabled',
      loginItemError: null,
    },
    alwaysOnTop: true,
    supportsReposition: true,
  })
  assert.equal(model.statusLabel, 'Prism — Capturing · Studio Output')
  assert.equal(model.mainWindowActionLabel, 'Show Prism')
  assert.equal(model.captureActionLabel, 'Stop Capture')
  assert.equal(model.rendererState.hasUnsavedProfileChanges, true)
  assert.equal(model.rendererState.rollingCaptureSeconds, 30)

  const invalidState = normalizeTrayRendererState({
    profiles: 'invalid',
    captureStatus: 'bad',
    rollingCaptureSeconds: 15,
  })
  assert.equal(invalidState.captureStatus, 'idle')
  assert.equal(invalidState.rollingCaptureSeconds, null)
})

test('tray renderer commands remain queued until the renderer is ready', () => {
  const queue = new TrayRendererCommandQueue()
  const received: string[] = []
  queue.enqueue({ type: 'open-settings' })
  queue.enqueue({ type: 'set-rolling-capture', durationSeconds: 10 })
  queue.enqueue({ type: 'set-capture-running', running: false })
  queue.flush((command) => received.push(command.type))
  assert.deepEqual(received, ['open-settings', 'set-rolling-capture', 'set-capture-running'])
  queue.flush((command) => received.push(command.type))
  assert.deepEqual(received, ['open-settings', 'set-rolling-capture', 'set-capture-running'])
})

test('tray assets resolve for development and packaged builds', () => {
  assert.equal(getTrayAssetFilename('darwin'), 'prismTrayTemplate.png')
  assert.equal(getTrayAssetFilename('win32'), 'prism-tray.ico')
  assert.equal(getTrayAssetFilename('linux'), 'prism-tray.png')
  assert.equal(resolveTrayAssetPath({
    platform: 'darwin',
    isPackaged: true,
    resourcesPath: '/Applications/Prism.app/Contents/Resources',
    appPath: '/Applications/Prism.app/Contents/Resources/app.asar',
  }), '/Applications/Prism.app/Contents/Resources/tray/prismTrayTemplate.png')
  assert.equal(resolveTrayAssetPath({
    platform: 'linux',
    isPackaged: false,
    resourcesPath: '/unused',
    appPath: '/workspace/prism',
  }), '/workspace/prism/resources/tray/prism-tray.png')
})

test('generated tray assets have the expected sizes and transparent macOS mask', async () => {
  const trayDirectory = join(process.cwd(), 'resources', 'tray')
  const template1x = inspectPng(await readFile(join(trayDirectory, 'prismTrayTemplate.png')))
  const template2x = inspectPng(await readFile(join(trayDirectory, 'prismTrayTemplate@2x.png')))
  const linux = inspectPng(await readFile(join(trayDirectory, 'prism-tray.png')))
  assert.deepEqual([template1x.width, template1x.height], [16, 16])
  assert.deepEqual([template2x.width, template2x.height], [32, 32])
  assert.deepEqual([linux.width, linux.height], [24, 24])
  assert.equal(template1x.alphaValues.has(0), true)
  assert.equal(template1x.alphaValues.has(255), true)
  assert.equal(template2x.alphaValues.has(0), true)
  assert.equal(template2x.alphaValues.has(255), true)

  const ico = await readFile(join(trayDirectory, 'prism-tray.ico'))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  const imageCount = ico.readUInt16LE(4)
  assert.equal(imageCount, 6)
  const dimensions = Array.from({ length: imageCount }, (_, index) => {
    const entryOffset = 6 + (index * 16)
    return [ico[entryOffset], ico[entryOffset + 1]]
  })
  assert.deepEqual(dimensions, [
    [16, 16],
    [20, 20],
    [24, 24],
    [32, 32],
    [40, 40],
    [48, 48],
  ])
})

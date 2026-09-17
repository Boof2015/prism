import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const require = createRequire(import.meta.url)
const channelMap = 'aux0,aux1,aux2,aux3,aux4,aux5'
const amplitudes = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75]
const usePipeWire = process.env.PRISM_CAPTURE_TEST_SERVER === 'pipewire'
const peak = samples => samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
  try { await exited } finally { clearTimeout(timer) }
}

async function waitFor(description, check, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = check()
    if (result) return result
    await delay(20)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

test(`Linux native capture routes six-channel system audio and device inputs (${usePipeWire ? 'PipeWire' : 'PulseAudio'})`, {
  skip: process.platform !== 'linux', timeout: 60000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-capture-'))
  const previousServer = process.env.PULSE_SERVER
  const env = {
    ...process.env,
    PULSE_SERVER: `unix:${directory}/native`, PULSE_RUNTIME_PATH: `${directory}/runtime`,
    XDG_CONFIG_HOME: `${directory}/config`, XDG_STATE_HOME: `${directory}/state`,
  }
  const helpers = []
  let server
  let player
  let serverLog = ''
  let system
  let input
  const pactl = (...args) => execFileSync('pactl', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const launch = (command, args = []) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr.on('data', chunk => { serverLog += `${command}: ${chunk}` })
    child.on('error', error => { serverLog += `${command}: ${error.message}` })
    return child
  }
  try {
    await mkdir(env.PULSE_RUNTIME_PATH, { mode: 0o700 })
    if (usePipeWire) {
      env.XDG_RUNTIME_DIR = directory
      env.PIPEWIRE_RUNTIME_DIR = directory
      env.PIPEWIRE_REMOTE = 'pipewire-0'
      env.PULSE_SERVER = `unix:${env.PULSE_RUNTIME_PATH}/native`
      const bus = launch('dbus-daemon', ['--session', '--nofork', '--print-address=1'])
      helpers.push(bus)
      let address = ''
      bus.stdout.on('data', chunk => { address += chunk })
      await waitFor('private D-Bus session', () => address.includes('\n'))
      env.DBUS_SESSION_BUS_ADDRESS = address.trim()
      helpers.push(launch('pipewire'))
      // Policy-only operation links the virtual nodes without discovering or
      // opening the machine's physical audio/video devices (WirePlumber 0.5+).
      helpers.push(launch('wireplumber', ['--profile=policy']))
      server = launch('pipewire-pulse')
    } else {
      const config = join(directory, 'server.pa')
      await writeFile(config, `load-module module-native-protocol-unix socket=${directory}/native auth-anonymous=1\n`)
      server = launch('pulseaudio', ['-n', '--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1', '-F', config])
    }
    await waitFor('isolated audio server', () => {
      if (server.exitCode !== null) assert.fail(serverLog)
      try { return pactl('info') } catch { return false }
    })
    process.env.PULSE_SERVER = env.PULSE_SERVER
    const native = require('../native/build/Release/visualizer_dsp.node')
    system = native.linuxCapture
    input = native.deviceInputCapture
    assert.equal(system.getSupport().available, true)
    assert.equal(input.getSupport().available, true, 'an empty input list must still permit later hotplug')
    assert.deepEqual(input.listInputDevices(), [])

    const outputModule = pactl('load-module', 'module-null-sink', 'sink_name=prism_output',
      'format=float32le', 'rate=48000', 'channels=6', `channel_map=${channelMap}`)
    const inputModule = pactl('load-module', 'module-remap-source', 'source_name=prism_input',
      'master=prism_output.monitor', 'channels=6', `channel_map=${channelMap}`, `master_channel_map=${channelMap}`, 'remix=no')
    pactl('set-default-sink', 'prism_output')
    pactl('set-default-source', 'prism_input')
    for (const [devices, id] of [[system.listOutputDevices(), 'prism_output'], [input.listInputDevices(), 'prism_input']]) {
      assert.equal(devices.length, 1, 'monitor sources must not appear as device inputs')
      assert.equal(devices[0].id, id)
      assert.equal(devices[0].isDefault, true)
      assert.equal(devices[0].channelRoutingAvailable, true)
      assert.equal(devices[0].channelCount, 6)
      assert.deepEqual(devices[0].channels.map(channel => channel.index), [0, 1, 2, 3, 4, 5])
      assert.ok(devices[0].channels.every(channel => channel.label.length > 0))
    }

    // Integer-period tones let each short packet expose the known channel peaks.
    const tone = Buffer.alloc(48000 * 6 * 4)
    for (let frame = 0; frame < 48000; frame++) {
      for (let channel = 0; channel < 6; channel++) {
        tone.writeFloatLE(amplitudes[channel] * Math.sin(2 * Math.PI * (channel + 1) * frame / 48),
          (frame * 6 + channel) * 4)
      }
    }
    const audioFile = join(directory, 'six-channel.f32')
    await writeFile(audioFile, Buffer.concat(Array.from({ length: 20 }, () => tone)))
    player = spawn('pacat', ['--playback', '--raw', '--format=float32le', '--rate=48000', '--channels=6',
      `--channel-map=${channelMap}`, '--device=prism_output', audioFile], { env, stdio: 'ignore' })

    async function expectSignal(capture, left, right) {
      return waitFor(`routed signal ${left + 1}/${right + 1}`, () => {
        for (const chunk of capture.drain(256).chunks) {
          assert.equal(chunk.channelCount, 2)
          assert.equal(chunk.sourceChannelPeaks.length, 6)
          if (chunk.left.length < 48 || peak(chunk.left) < 0.01) continue
          if (Math.abs(peak(chunk.left) - amplitudes[left]) > 0.01
            || Math.abs(peak(chunk.right) - amplitudes[right]) > 0.01) continue // queued previous route
          for (let channel = 0; channel < 6; channel++) {
            assert.ok(Math.abs(chunk.sourceChannelPeaks[channel] - amplitudes[channel]) < 0.015,
              `channel ${channel + 1}: ${chunk.sourceChannelPeaks[channel]}`)
          }
          assert.ok(Math.abs(peak(chunk.left) - chunk.sourceChannelPeaks[left]) < 1e-6)
          assert.ok(Math.abs(peak(chunk.right) - chunk.sourceChannelPeaks[right]) < 1e-6)
          if (left === right) assert.deepEqual(chunk.left, chunk.right)
          return chunk
        }
        return false
      })
    }

    await t.test('non-adjacent startup routes and independent simultaneous capture modes', async () => {
      for (const [capture, routing, id] of [
        [system, { left: 5, right: 2 }, 'prism_output'], [input, { left: 4, right: 1 }, 'prism_input'],
      ]) {
        const started = capture.start(undefined, routing)
        assert.equal(started.deviceId, id)
        assert.equal(started.channelCount, 2)
        assert.equal(started.sourceChannelCount, 6)
        assert.equal(started.sampleRate, 48000)
        await expectSignal(capture, routing.left, routing.right)
      }
    })
    await t.test('live duplicate routing, invalid routes, and restart persistence', async () => {
      assert.deepEqual(system.setChannelRouting(3, 3), { left: 3, right: 3 })
      await expectSignal(system, 3, 3)
      await expectSignal(input, 4, 1)
      assert.deepEqual(input.setChannelRouting(99, 0), { left: 0, right: 1 })
      await expectSignal(input, 0, 1)
      input.start('prism_input', { left: 5, right: 4 })
      await expectSignal(input, 5, 4)
    })
    await t.test('silence clears activity on all six source channels', async () => {
      await stopProcess(player)
      for (const capture of [system, input]) {
        await waitFor('silent capture', () => capture.drain(256).chunks.some(chunk =>
          chunk.left.length > 0 && chunk.sourceChannelPeaks.length === 6
          && chunk.sourceChannelPeaks.every(value => value === 0)
          && chunk.left.every(value => value === 0) && chunk.right.every(value => value === 0)))
      }
    })
    await t.test('source removal and reconnect update the native device lists', () => {
      input.stop()
      system.stop()
      assert.deepEqual(input.drain().chunks, [])
      pactl('unload-module', inputModule)
      assert.deepEqual(input.listInputDevices(), [])
      assert.throws(() => input.start('prism_input'), /No Linux input devices/)
      pactl('unload-module', outputModule)
      assert.ok(system.listOutputDevices().every(device => device.id !== 'prism_output'),
        'PipeWire may supply an automatic dummy output after the real sink disappears')
      pactl('load-module', 'module-null-sink', 'sink_name=prism_mono', 'channels=1', 'channel_map=mono')
      pactl('load-module', 'module-remap-source', 'source_name=prism_mono_input',
        'master=prism_mono.monitor', 'channels=1', 'channel_map=mono', 'master_channel_map=mono', 'remix=no')
      for (const [capture, id] of [[system, 'prism_mono'], [input, 'prism_mono_input']]) {
        const started = capture.start(id, { left: 5, right: 4 })
        assert.equal(started.channelCount, 1)
        assert.equal(started.sourceChannelCount, 1)
        assert.deepEqual(capture.setChannelRouting(5, 4), { left: 0, right: 0 })
        capture.stop()
      }
    })
    await stopProcess(server)
    assert.equal(system.getSupport().available, false)
    assert.equal(input.getSupport().available, false)
    assert.ok(input.getSupport().reason)
  } catch (error) {
    t.diagnostic(serverLog)
    throw error
  } finally {
    input?.stop()
    system?.stop()
    await stopProcess(player)
    await stopProcess(server)
    for (const helper of [...helpers].reverse()) await stopProcess(helper)
    if (previousServer === undefined) delete process.env.PULSE_SERVER
    else process.env.PULSE_SERVER = previousServer
    await rm(directory, { recursive: true, force: true })
  }
})

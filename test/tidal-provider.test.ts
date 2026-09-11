import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { parseTidalMacStatus, TidalProvider, isTidalWindowsSession } from '../src/main/services/tidalProvider'
import { extractGdbusStringVariant, extractGdbusStringArrayVariant } from '../src/main/services/localMediaMpris'
import type { NativeWindowsMediaAPI, NativeWindowsPlaybackState } from '../src/types/nativeWindowsMedia'

const now = 100_000
const mac = { bundleIdentifier: 'com.tidal.desktop', title: 'A "title"\nwith Unicode — 音楽', artist: 'Artist',
  playing: true, elapsedTime: 10, duration: 90, timestampMs: now - 2000 }
const windows: NativeWindowsPlaybackState = { sourceAppUserModelId: 'com.squirrel.TIDAL.TIDAL',
  title: 'Track', artist: 'Artist', album: '', positionMs: 2000, durationMs: 0,
  playbackStatus: 'Playing', artworkDataUrl: null }
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) { if (condition()) return; await setImmediate() }
  assert.ok(condition(), 'provider did not reach expected state')
}
function macProvider(read: () => string = () => JSON.stringify(mac)) {
  return new TidalProvider({ platform: 'darwin', now: () => now,
    accessImpl: async () => undefined, commandRunner: async () => read() })
}

test('Mac parses track info, extrapolates playing only, and tolerates missing metadata', () => {
  const parsed = parseTidalMacStatus(JSON.stringify(mac), now)!
  assert.equal(parsed.currentTrack?.title, mac.title)
  assert.equal(parsed.currentTrack?.album, '')
  assert.equal(parsed.currentTrack?.artworkDataUrl, null)
  assert.equal(parsed.currentTime, 12)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, playing: false }), now)?.currentTime, 10)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, elapsedTime: 89 }), now)?.currentTime, 90)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, duration: 0 }), now)?.currentTime, 12)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, elapsedTime: undefined }), now)?.currentTime, 0)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, timestampMs: now + 999 }), now)?.currentTime, 10)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, artist: null, duration: null }), now)?.currentTrack?.artist, '')
})

test('Mac filters unrelated sessions and accepts the TIDAL parent app identity', () => {
  assert.equal(parseTidalMacStatus('null', now), null)
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, bundleIdentifier: 'com.spotify.client' }), now), null)
  assert.ok(parseTidalMacStatus(JSON.stringify({ ...mac, bundleIdentifier: 'com.tidal.helper', parentApplicationBundleIdentifier: 'com.tidal.desktop' }), now))
  assert.throws(() => parseTidalMacStatus('bad json', now))
  assert.throws(() => parseTidalMacStatus('[]', now))
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...mac, title: null }), now), null)
})

test('Mac uses only supplied image bytes and rejects non-image artwork', () => {
  const withArt = { ...mac, artworkData: 'aGVsbG8=', artworkMimeType: 'image/png' }
  assert.equal(parseTidalMacStatus(JSON.stringify(withArt), now)?.currentTrack?.artworkDataUrl, 'data:image/png;base64,aGVsbG8=')
  assert.equal(parseTidalMacStatus(JSON.stringify({ ...withArt, artworkMimeType: 'text/html' }), now)?.currentTrack?.artworkDataUrl, null)
})

test('Mac provider clears a lost session, recovers, and rejects all controls', async () => {
  let data = JSON.stringify(mac)
  const provider = macProvider(() => data)
  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().supportsTransportControls, false)
    await provider.setConsumerActive(1, true)
    await until(() => provider.getProviderState().connectionState === 'connected')
    await assert.rejects(provider.sendControl('play'), /unavailable on this platform/)
    data = 'null'
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot, null)
    assert.equal(provider.getProviderState().connectionState, 'disabled')
    data = JSON.stringify(mac)
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.title, mac.title)
    await provider.setConsumerActive(1, false)
    assert.equal(provider.getProviderState().snapshot, null)
  } finally { await provider.dispose() }
})

test('unavailable Mac probe can be retried after the system integration recovers', async () => {
  let broken = true
  const provider = macProvider(() => { if (broken) throw new Error('TIDAL_MEDIA_UNAVAILABLE: no selector'); return JSON.stringify(mac) })
  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, false)
    await provider.setConsumerActive(1, true)
    await assert.rejects(provider.retry(), /macOS/)
    broken = false
    await provider.retry()
    assert.equal(provider.getProviderState().connectionState, 'connected')
  } finally { await provider.dispose() }
})

test('missing TIDAL installation reports unavailable without launching the app', async () => {
  let calls = 0
  const provider = new TidalProvider({ platform: 'darwin', accessImpl: async () => { throw new Error('ENOENT') },
    commandRunner: async () => { calls++; return 'null' } })
  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, false)
    assert.match(provider.getProviderState().lastError!, /Install TIDAL.app/)
    assert.equal(calls, 0)
  } finally { await provider.dispose() }
})

test('Windows preserves unknown duration and metadata; commands target TIDAL only', async () => {
  let data: NativeWindowsPlaybackState | null = windows
  let accept = false
  const calls: string[] = []
  const api: NativeWindowsMediaAPI = {
    getSupport: () => ({ available: true, reason: null }),
    getSpotifyPlaybackState: () => { throw new Error('wrong provider') },
    sendSpotifyControl: () => { throw new Error('wrong provider') },
    getTidalPlaybackState: () => data,
    sendTidalControl: command => { calls.push(command); return accept },
  }
  const provider = new TidalProvider({ platform: 'win32', windowsMediaApi: api })
  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await until(() => provider.getProviderState().connectionState === 'connected')
    assert.equal(provider.getProviderState().snapshot?.currentTime, 2)
    assert.equal(provider.getProviderState().snapshot?.duration, 0)
    assert.equal(provider.getProviderState().snapshot?.playbackState, 'playing')
    await assert.rejects(provider.sendControl('next'), /did not accept/)
    assert.match(provider.getProviderState().lastControlError!, /did not accept/)
    accept = true
    data = { ...windows, playbackStatus: 'Paused' }
    await provider.sendControl('pause')
    assert.equal(provider.getProviderState().snapshot?.playbackState, 'paused')
    assert.equal(provider.getProviderState().lastControlError, null)
    assert.deepEqual(calls, ['next', 'pause'])
    data = null
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot, null)
    data = { ...windows, sourceAppUserModelId: 'Spotify.exe' }
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot, null)
  } finally { await provider.dispose() }
})

test('Windows session matching excludes browsers and substring matches', () => {
  for (const id of ['com.squirrel.TIDAL.TIDAL', 'TIDAL.exe', 'TIDALMusicAS.TIDAL_abcdef!TIDAL']) assert.equal(isTidalWindowsSession(id), true)
  for (const id of ['Chrome.exe', 'something-tidal', 'com.squirrel.tidal.tidal.other']) assert.equal(isTidalWindowsSession(id), false)
})

test('older native addons fail closed without affecting Spotify', async () => {
  const provider = new TidalProvider({ platform: 'win32', windowsMediaApi: {
    getSupport: () => ({ available: true, reason: null }), getSpotifyPlaybackState: () => null, sendSpotifyControl: () => true,
  } })
  try {
    await provider.initialize()
    assert.equal(provider.getProviderState().available, false)
    assert.match(provider.getProviderState().lastError!, /Rebuild or update Prism/)
  } finally { await provider.dispose() }
})

const prefix = 'org.mpris.MediaPlayer2.'
function metadata(title: string, status = 'Playing', art = ''): string {
  return `({'PlaybackStatus': <'${status}'>, 'Position': <int64 2000000>, 'Metadata': <{'xesam:title': <'${title}'>, 'xesam:artist': <['Artist']>, 'mpris:artUrl': <'${art}'>, 'mpris:length': <int64 180000000>}>},)`
}
function linuxHarness(fetchImpl?: typeof fetch) {
  let busError = false
  const sessions = new Map([
    ['browser', { identity: 'Chromium', data: metadata('TIDAL in browser') }],
    ['a', { identity: 'TIDAL Hi-Fi', data: metadata('First', 'Paused') }],
    ['b', { identity: 'TIDAL', data: metadata('Second') }],
  ])
  const commands: { bus: string; method: string }[] = []
  const provider = new TidalProvider({ platform: 'linux', fetchImpl, commandRunner: async (_command, args) => {
    const method = args[args.indexOf('--method') + 1]
    if (busError) throw new Error('Cannot connect to session bus')
    if (method.endsWith('.ListNames')) return `([${[...sessions.keys()].map(key => `'${prefix}${key}'`).join(', ')}],)`
    const bus = args[args.indexOf('--dest') + 1].slice(prefix.length)
    const session = sessions.get(bus)
    if (!session) throw new Error('NameHasNoOwner')
    if (method.endsWith('.GetAll')) return args.at(-1) === 'org.mpris.MediaPlayer2'
      ? `({'Identity': <'${session.identity}'>},)` : session.data
    commands.push({ bus, method })
    return '()'
  } })
  return { provider, sessions, commands, setBusError: (value: boolean) => { busError = value } }
}

test('Linux prefers playing dedicated clients, keeps ties stable, and routes controls to that session', async () => {
  const { provider, sessions, commands } = linuxHarness()
  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await until(() => provider.getProviderState().snapshot?.currentTrack?.title === 'Second')
    assert.equal(provider.getProviderState().snapshot?.currentTime, 2)
    assert.equal(provider.getProviderState().snapshot?.duration, 180)
    sessions.get('a')!.data = metadata('First')
    await provider.sendControl('pause') // refresh both playing; retain b
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.title, 'Second')
    assert.deepEqual(commands, [{ bus: 'b', method: 'org.mpris.MediaPlayer2.Player.Pause' }])
    sessions.delete('b')
    await assert.rejects(provider.sendControl('next'), /NameHasNoOwner/)
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.title, 'First')
    sessions.delete('a')
    await provider.retry()
    assert.equal(provider.getProviderState().snapshot, null)
    await assert.rejects(provider.sendControl('play'), /No active TIDAL/)
  } finally { await provider.dispose() }
})

test('Linux reports unavailable bus and recovers through Retry', async () => {
  const harness = linuxHarness()
  harness.setBusError(true)
  try {
    await harness.provider.initialize()
    assert.equal(harness.provider.getProviderState().available, false)
    harness.setBusError(false)
    await harness.provider.setConsumerActive(1, true)
    await harness.provider.retry()
    assert.equal(harness.provider.getProviderState().connectionState, 'connected')
  } finally { await harness.provider.dispose() }
})

test('Linux checks identity again before sending a control', async () => {
  const { provider, sessions, commands } = linuxHarness()
  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await until(() => provider.getProviderState().connectionState === 'connected')
    sessions.get('b')!.identity = 'Chromium'
    await assert.rejects(provider.sendControl('next'), /no longer belongs to TIDAL/)
    assert.equal(commands.length, 0)
  } finally { await provider.dispose() }
})

test('dispose aborts active requests and suppresses late results', async () => {
  let release!: (value: string) => void
  let activeSignal: AbortSignal | undefined
  let calls = 0
  let emissions = 0
  const provider = new TidalProvider({ platform: 'darwin', accessImpl: async () => undefined,
    commandRunner: async (_command, _args, signal) => {
      if (++calls === 1) return 'null'
      activeSignal = signal
      return new Promise(resolve => { release = resolve })
    } })
  provider.subscribe(() => { emissions++ })
  await provider.initialize()
  await provider.setConsumerActive(1, true)
  await until(() => Boolean(release))
  const beforeDispose = emissions
  const disposing = provider.dispose()
  assert.equal(activeSignal?.aborted, true)
  release(JSON.stringify(mac))
  await disposing
  assert.equal(emissions, beforeDispose)
  assert.equal(provider.getProviderState().snapshot, null)
})

test('removing the final consumer cancels reads without affecting other consumers', async () => {
  const provider = macProvider()
  try {
    await provider.setConsumerActive(1, true)
    await provider.setConsumerActive(2, true)
    await provider.initialize()
    await until(() => provider.getProviderState().connectionState === 'connected')
    await provider.setConsumerActive(1, false)
    assert.ok(provider.getProviderState().snapshot)
    await provider.setConsumerActive(2, false)
    assert.equal(provider.getProviderState().snapshot, null)
    await provider.setConsumerActive(3, true)
    await until(() => provider.getProviderState().connectionState === 'connected')
  } finally { await provider.dispose() }
})


test('shared MPRIS parsing preserves quotes, escapes, Unicode and artist arrays', () => {
  const data = String.raw`({'xesam:title': <"Don't Stop \"Now\" — 音楽">, 'xesam:artist': <["D'Angelo", 'Artist\\Name']>},)`
  assert.equal(extractGdbusStringVariant(data, 'xesam:title'), 'Don\'t Stop "Now" — 音楽')
  assert.deepEqual(extractGdbusStringArrayVariant(data, 'xesam:artist'), ["D'Angelo", 'Artist\\Name'])
})

test('Linux artwork is cached without flicker and discarded when the track changes', async () => {
  let fetches = 0
  const { provider, sessions } = linuxHarness(async () => {
    fetches++
    return new Response('cover', { headers: { 'content-type': 'image/png' } })
  })
  sessions.get('b')!.data = metadata('Second', 'Playing', 'https://example.test/cover')
  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await until(() => Boolean(provider.getProviderState().snapshot?.currentTrack?.artworkDataUrl))
    assert.equal(fetches, 1)
    const updates: (string | null | undefined)[] = []
    const unsubscribe = provider.subscribe(() => updates.push(provider.getProviderState().snapshot?.currentTrack?.artworkDataUrl))
    await provider.sendControl('play')
    assert.equal(fetches, 1)
    assert.ok(updates.every(Boolean), 'cached artwork should not disappear during refresh')
    unsubscribe()
    sessions.get('b')!.data = metadata('Third')
    await provider.sendControl('next')
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.title, 'Third')
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.artworkDataUrl, null)
  } finally { await provider.dispose() }
})

test('failed or non-image artwork does not drop the track and retries are bounded', async () => {
  let fetches = 0
  const { provider, sessions } = linuxHarness(async () => {
    fetches++
    return new Response('not an image', { headers: { 'content-type': 'text/html' } })
  })
  sessions.get('b')!.data = metadata('Second', 'Playing', 'https://example.test/cover')
  try {
    await provider.initialize()
    await provider.setConsumerActive(1, true)
    await until(() => fetches > 0)
    await provider.sendControl('play')
    assert.equal(fetches, 1)
    assert.equal(provider.getProviderState().connectionState, 'connected')
    assert.equal(provider.getProviderState().snapshot?.currentTrack?.artworkDataUrl, null)
    await provider.retry()
    assert.equal(fetches, 2)
  } finally { await provider.dispose() }
})

test('disposing while artwork is loading aborts the fetch and suppresses stale updates', async () => {
  let fetchSignal: AbortSignal | undefined
  let started = false
  const { provider, sessions } = linuxHarness(async (_url, init) => {
    started = true
    fetchSignal = init?.signal ?? undefined
    return new Promise((_resolve, reject) => fetchSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  sessions.get('b')!.data = metadata('Second', 'Playing', 'https://example.test/cover')
  let emissions = 0
  provider.subscribe(() => { emissions++ })
  await provider.initialize()
  await provider.setConsumerActive(1, true)
  await until(() => started)
  const before = emissions
  await provider.dispose()
  assert.equal(fetchSignal?.aborted, true)
  assert.equal(emissions, before)
})

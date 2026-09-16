import { spawnSync } from 'node:child_process'

const testScripts = [
  'test:audio-router',
  'test:audio-clips',
  'test:audio-store',
  'test:astra',
  'test:capture-support',
  'test:capture-channel-selection-native',
  'test:daw-bridge',
  'test:spotify-provider',
  'test:tidal-provider',
  'test:now-playing',
  'test:now-playing-ui',
  'test:profiles',
  'test:themes',
  'test:secret-vault',
  'test:window-state',
  'test:desktop-integration',
  'test:renderer-helpers',
  'test:build-metadata',
  'test:updates',
  'test:plugin-packaging',
  'test:plugin-build',
  'test:plugin-install',
  'test:waterfall-native',
  'test:spectrum-native',
  'test:reference-tracks',
  'test:spectrogram-native',
  'test:vectorscope-native',
  'test:lufsmeter-native',
]

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('[test] Could not locate the npm CLI. Run this command through npm test.')
  process.exit(1)
}

for (const testScript of testScripts) {
  // Use npm's JS entry point so Windows does not have to spawn a .cmd shim.
  const result = spawnSync(process.execPath, [npmCli, 'run', testScript], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`[test] ${testScript} failed to start: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

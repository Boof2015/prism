import { spawnSync } from 'node:child_process'

const testScripts = [
  'test:audio-router',
  'test:audio-clips',
  'test:audio-store',
  'test:astra',
  'test:capture-support',
  'test:spotify-provider',
  'test:now-playing',
  'test:profiles',
  'test:themes',
  'test:secret-vault',
  'test:window-state',
  'test:desktop-integration',
  'test:renderer-helpers',
  'test:build-metadata',
  'test:updates',
  'test:spectrum-native',
  'test:spectrogram-native',
  'test:vectorscope-native',
  'test:lufsmeter-native',
]

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

for (const testScript of testScripts) {
  const result = spawnSync(npmCommand, ['run', testScript], {
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

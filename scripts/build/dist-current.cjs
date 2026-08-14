const { spawnSync } = require('node:child_process')

const scriptByPlatform = {
  darwin: 'dist:mac',
  linux: 'dist:linux',
  win32: 'dist:win',
}

const script = scriptByPlatform[process.platform]
if (!script) {
  console.error(`Packaging is not configured for ${process.platform}.`)
  process.exit(1)
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['run', script], { stdio: 'inherit' })
process.exit(result.status ?? 1)

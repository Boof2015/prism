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

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('Could not locate the npm CLI. Run this command through `npm run dist`.')
  process.exit(1)
}

// Node 22 rejects direct child-process launches of Windows .cmd shims with
// EINVAL. Reuse the npm CLI that launched this script through the current Node
// executable instead, which is portable and avoids an extra command shell.
const result = spawnSync(process.execPath, [npmCli, 'run', script], {
  stdio: 'inherit',
})
if (result.error) {
  console.error(`Could not start npm run ${script}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)

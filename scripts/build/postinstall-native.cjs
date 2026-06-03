const { spawnSync } = require('node:child_process')

const skipNativePostinstall = /^(1|true|yes)$/i.test(process.env.PRISM_SKIP_NATIVE_POSTINSTALL || '')

if (skipNativePostinstall) {
  console.log('Skipping native postinstall because PRISM_SKIP_NATIVE_POSTINSTALL is set.')
  process.exit(0)
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['run', 'rebuild:native'], { stdio: 'inherit' })

if (result.status === 0) {
  process.exit(0)
}

console.warn('Native build failed, will use JS fallback')
process.exit(0)

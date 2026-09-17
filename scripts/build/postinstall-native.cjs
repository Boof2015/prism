const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const skipNativePostinstall = /^(1|true|yes)$/i.test(process.env.PRISM_SKIP_NATIVE_POSTINSTALL || '')

if (skipNativePostinstall) {
  console.log('Skipping native postinstall because PRISM_SKIP_NATIVE_POSTINSTALL is set.')
  process.exit(0)
}

// Launch JavaScript through Node; Windows cannot spawn npm.cmd without a shell.
const result = spawnSync(process.execPath, [join(__dirname, 'build-native.cjs'), '--electron'], {
  stdio: 'inherit',
  shell: false,
})

if (result.status === 0) {
  process.exit(0)
}

if (result.error) console.warn(`Could not start native build: ${result.error.message}`)
console.warn('Native build failed, will use JS fallback')
process.exit(0)

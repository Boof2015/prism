const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const options = process.argv.slice(2)
const args = ['rebuild']
if (options.includes('--electron')) {
  args.push(
    `--target=${require('electron/package.json').version}`,
    `--arch=${process.arch}`,
    '--dist-url=https://electronjs.org/headers',
  )
}
args.push(...options.filter(option => option !== '--electron'))

// Both node-gyp and @electron/node-gyp provide the same command shim. Resolve
// our direct dependency explicitly: the older Electron fork can inherit Node's
// clang setting on Windows and request ClangCL instead of the installed MSVC.
const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), ...args], {
  cwd: join(__dirname, '..', '..', 'native'),
  stdio: 'inherit',
  shell: false,
})
if (result.error) console.error(`Could not start native build: ${result.error.message}`)
process.exitCode = result.status ?? 1

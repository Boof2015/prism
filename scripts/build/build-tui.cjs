const { copyFileSync, existsSync, mkdirSync, chmodSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const rootDir = join(__dirname, '..', '..')
const buildDir = join(rootDir, 'tui', 'build')
const packageJson = require(join(rootDir, 'package.json'))
const shouldTest = process.argv.includes('--test')
const shouldStage = process.argv.includes('--stage')
const configureOnly = process.argv.includes('--configure-only')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('cmake', [
  '-S', 'tui',
  '-B', 'tui/build',
  '-DCMAKE_BUILD_TYPE=Release',
  `-DPRISM_VERSION=${packageJson.version}`,
])
if (configureOnly) process.exit(0)

run('cmake', ['--build', 'tui/build', '--config', 'Release', '--parallel', '4'])

if (shouldTest) {
  run('ctest', ['--test-dir', 'tui/build', '-C', 'Release', '--output-on-failure'])
}

if (shouldStage) {
  const executableName = process.platform === 'win32' ? 'prism-tui.exe' : 'prism-tui'
  const candidates = [
    join(buildDir, 'bin', executableName),
    join(buildDir, 'bin', 'Release', executableName),
    join(buildDir, 'Release', executableName),
  ]
  const source = candidates.find(existsSync)
  if (!source) {
    console.error(`Could not find built ${executableName}. Checked:\n${candidates.join('\n')}`)
    process.exit(1)
  }
  const stageDir = join(rootDir, 'tui', 'dist-installer')
  mkdirSync(stageDir, { recursive: true })
  const destination = join(stageDir, executableName)
  copyFileSync(source, destination)
  if (process.platform !== 'win32') chmodSync(destination, 0o755)
  console.log(`Staged ${destination}`)
}

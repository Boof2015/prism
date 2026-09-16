const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const help = `Usage: npm run build:plugins -- [options] [CMake options]

Builds the web UI, configures plugin/build, and compiles the plugins.

  --configure-only  Build the UI and configure CMake without compiling
  --test            Also enable and run the native plugin tests
  --install         Copy plugins into the platform's plugin folders after building
  --stage           Build all release formats and stage them for packaging
  --jobs N          Parallel build jobs (default: CMAKE_BUILD_PARALLEL_LEVEL or 4)
  --help            Show this help

CMake options: -DNAME=VALUE, -G GENERATOR, -A PLATFORM, -T TOOLSET.
Existing generator and format selections are preserved unless overridden.
Defaults: Release, embedded UI, no installation. Use -DCMAKE_BUILD_TYPE=Debug
for a debug build. AU is available only on macOS; CMake selects native formats.
`

function parseOptions(argv, env) {
  const options = { cmakeArgs: [], definitions: new Map(), jobs: env.CMAKE_BUILD_PARALLEL_LEVEL || '4' }
  const valueAfter = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value.`)
    return value
  }
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]
    if (arg === '--help') options.help = true
    else if (arg === '--configure-only') options.configureOnly = true
    else if (arg === '--test') options.test = true
    else if (arg === '--install') options.install = true
    else if (arg === '--stage') options.stage = true
    else if (arg === '--jobs') options.jobs = valueAfter(i++, arg)
    else if (['-G', '-A', '-T'].includes(arg)) options.cmakeArgs.push(arg, valueAfter(i++, arg))
    else if (arg.startsWith('-D')) {
      const definition = arg === '-D' ? valueAfter(i++, arg) : arg.slice(2)
      const match = /^([^:=]+)(?::[^=]+)?=(.*)$/.exec(definition)
      if (!match) throw new Error(`Invalid CMake definition: ${arg}. Use -DNAME=VALUE.`)
      options.definitions.set(match[1], match[2])
      options.cmakeArgs.push(`-D${definition}`)
    } else throw new Error(`Unknown option: ${arg}. Run with --help for usage.`)
  }
  if (!/^[1-9]\d*$/.test(options.jobs)) throw new Error('--jobs must be a positive integer.')
  if (options.test && options.configureOnly) throw new Error('--test cannot be combined with --configure-only.')
  if (options.configureOnly && (options.install || options.stage)) throw new Error('--configure-only cannot install or stage plugins.')
  if (options.stage && options.install) throw new Error('--stage cannot be combined with --install.')
  if (options.definitions.has('PRISM_COPY_PLUGIN_AFTER_BUILD') &&
      !/^(OFF|FALSE|NO|0)$/i.test(options.definitions.get('PRISM_COPY_PLUGIN_AFTER_BUILD'))) {
    throw new Error('CMake copy-after-build is disabled. Use --install or npm run install:plugins for the separate copy step.')
  }
  return options
}

function buildPlugins({
  argv = process.argv.slice(2),
  platform = process.platform,
  env = process.env,
  rootDir = join(__dirname, '..', '..'),
  spawn = spawnSync,
} = {}) {
  const options = parseOptions(argv, env)
  if (options.help) {
    console.log(help)
    return
  }
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error(`Plugin builds are not configured for ${platform}.`)
  if (!env.npm_execpath) throw new Error('Could not locate npm. Run this script through npm run build:plugins.')

  function run(label, command, args) {
    const result = spawn(command, args, { cwd: rootDir, env, stdio: 'inherit', shell: false })
    if (result.error) {
      const hint = command === 'cmake' || command === 'ctest' ? ' Install CMake 3.22+ and ensure it is on PATH.' : ''
      throw new Error(`${label} could not start: ${result.error.message}.${hint}`)
    }
    if (result.status !== 0) {
      const error = new Error(`${label} failed (${result.signal || `exit ${result.status ?? 1}`}).`)
      error.exitCode = result.status > 0 ? result.status : 1
      throw error
    }
  }

  const config = options.definitions.get('CMAKE_BUILD_TYPE') ?? 'Release'
  if (!config.trim()) throw new Error('CMAKE_BUILD_TYPE must name a configuration, such as Release or Debug.')
  if (options.stage && config !== 'Release') throw new Error('Installer staging requires a Release build.')
  const stage = () => run('Plugin staging', process.execPath, [join(rootDir, 'scripts/build/stage-plugins.mjs')])
  if (options.stage && !options.test && env.PRISM_PLUGINS_PREBUILT === '1') {
    // Release CI has already built and tested with its compiler environment.
    // Still validate every required artifact before packaging.
    stage()
    return
  }
  const cachePath = join(rootDir, 'plugin/build/CMakeCache.txt')
  const cache = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : ''
  const configureArgs = [
    '-S', 'plugin', '-B', 'plugin/build',
    `-DCMAKE_BUILD_TYPE=${config}`,
    '-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF',
    '-DPRISM_DEV_SERVER=OFF',
  ]

  // JUCE needs the parent of Microsoft.Web.WebView2, not the package itself.
  // Explicit CMake arguments take priority over the environment, cache, and local SDK.
  if (platform === 'win32' && !options.definitions.has('JUCE_WEBVIEW2_PACKAGE_LOCATION')) {
    const cachedSdk = /^JUCE_WEBVIEW2_PACKAGE_LOCATION:[^=]+=(.+)$/m.exec(cache)?.[1].trim()
    const localSdk = join(rootDir, 'plugin/sdk')
    if (env.JUCE_WEBVIEW2_PACKAGE_LOCATION) {
      configureArgs.push(`-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=${env.JUCE_WEBVIEW2_PACKAGE_LOCATION}`)
    } else if (!cachedSdk && existsSync(join(localSdk, 'Microsoft.Web.WebView2/build/native/include/WebView2.h'))) {
      configureArgs.push(`-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=${localSdk}`)
    }
  }
  configureArgs.push(...options.cmakeArgs)
  if (options.stage) {
    const requiredFormats = platform === 'darwin' ? ['AU', 'VST3', 'CLAP'] : ['VST3', 'CLAP']
    const previousFormats = options.definitions.get('PRISM_PLUGIN_FORMATS') ??
      /^PRISM_PLUGIN_FORMATS:[^=]+=(.*)$/m.exec(cache)?.[1].trim() ?? ''
    const formats = [...new Set([...previousFormats.split(';').filter(Boolean), ...requiredFormats])]
    configureArgs.push(`-DPRISM_PLUGIN_FORMATS=${formats.join(';')}`, '-DPRISM_DEV_SERVER=OFF', '-DPRISM_LINUX_UI_MODE=webview')
  }
  if (options.test) configureArgs.push('-DBUILD_TESTING=ON')

  // Launch npm's JS entry point through Node: Windows .cmd shims cannot be
  // spawned directly on recent Node versions, and shell quoting breaks paths.
  run('Plugin UI build', process.execPath, [env.npm_execpath, 'run', 'plugin-ui:build'])
  run('Plugin configuration', 'cmake', configureArgs)
  if (options.configureOnly) return
  const targets = options.stage && !options.test ? ['--target', 'PrismInstallerPlugins'] : []
  run('Plugin compilation', 'cmake', ['--build', 'plugin/build', '--config', config, '--parallel', options.jobs, ...targets])
  if (options.test) run('Plugin tests', 'ctest', ['--test-dir', 'plugin/build', '-C', config, '--output-on-failure'])
  if (options.stage) stage()
  if (options.install) {
    console.log('Compilation succeeded. Installing the built plugins separately...')
    run('Plugin installation (compiled files are still available in plugin/build)', process.execPath,
      [join(rootDir, 'scripts/build/install-plugins.mjs'), '--config', config])
  }
}

module.exports = { buildPlugins }

if (require.main === module) {
  try {
    buildPlugins()
  } catch (error) {
    console.error(`[plugins] ${error.message}`)
    process.exitCode = error.exitCode || 1
  }
}

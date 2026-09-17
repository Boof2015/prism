import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { collectPluginArtifacts, releasePluginFormats } from './stage-plugins.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), '../..')

export function pluginInstallDirectories({ platform = process.platform, system = platform === 'win32', home = homedir(), env = process.env } = {}) {
  releasePluginFormats(platform)
  if (platform === 'win32') {
    const base = system ? env.CommonProgramW6432 || env.CommonProgramFiles : env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs/Common')
    if (!base) throw new Error(`Cannot locate Windows ${system ? 'Common Files' : 'Local AppData'} directory.`)
    return { VST3: join(base, 'VST3'), CLAP: join(base, 'CLAP') }
  }
  if (platform === 'darwin') {
    const base = system ? '/Library/Audio/Plug-Ins' : join(home, 'Library/Audio/Plug-Ins')
    return { VST3: join(base, 'VST3'), CLAP: join(base, 'CLAP'), AU: join(base, 'Components') }
  }
  return system ? { VST3: '/usr/lib/vst3', CLAP: '/usr/lib/clap' } : { VST3: join(home, '.vst3'), CLAP: join(home, '.clap') }
}

export function copyPluginArtifacts(products, directories) {
  // Check all destinations before copying anything. Only named Prism products
  // are updated, and an existing link must not redirect a privileged copy.
  const plan = products.map(product => {
    const root = resolve(directories[product.format])
    const destination = resolve(root, product.name)
    if (dirname(destination) !== root || lstatSync(destination, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Invalid plugin destination: ${destination}`)
    }
    return { ...product, root, destination }
  })
  for (const { source, root, destination } of plan) {
    mkdirSync(root, { recursive: true })
    cpSync(source, destination, { recursive: true, force: true, verbatimSymlinks: true })
    console.log(`Installed ${destination}`)
  }
}

export function installPlugins({
  argv = process.argv.slice(2), platform = process.platform, env = process.env,
  rootDir = repoRoot, home = homedir(), spawn = spawnSync, getuid = process.getuid,
} = {}) {
  let config = 'Release'
  let formats
  let scope
  let dryRun = false
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]
    if (arg === '--help') {
      console.log('Usage: npm run install:plugins -- [--config Release] [--formats VST3,CLAP] [--user | --system] [--dry-run]\nInstalls already-built plugins. Windows defaults to system folders with UAC; macOS/Linux default to user folders. No compilation runs elevated.')
      return
    }
    if (arg === '--user' || arg === '--system') {
      if (scope && scope !== arg) throw new Error('Choose either --user or --system.')
      scope = arg
    } else if (arg === '--dry-run') dryRun = true
    else if (arg === '--config' || arg === '--formats') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value.`)
      if (arg === '--config') config = value
      else formats = value.split(',')
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!/^[A-Za-z0-9_-]+$/.test(config)) throw new Error('Invalid build configuration.')
  const supported = releasePluginFormats(platform)
  const buildDir = join(rootDir, 'plugin/build')
  if (!formats) {
    const cachePath = join(buildDir, 'CMakeCache.txt')
    const cache = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : ''
    const selected = /^PRISM_PLUGIN_FORMATS:[^=]+=(.*)$/m.exec(cache)?.[1].trim()
    if (selected === undefined) throw new Error('No configured plugin build found. Run npm run build:plugins first.')
    formats = selected.split(';').filter(format => supported.includes(format))
  }
  formats = [...new Set(formats)]
  const products = collectPluginArtifacts({ buildDir, platform, config, formats })
  const system = scope ? scope === '--system' : platform === 'win32'
  const directories = pluginInstallDirectories({ platform, system, home, env })
  if (dryRun) {
    for (const { source, format, name } of products) console.log(`${source} -> ${join(directories[format], name)}`)
    return
  }

  function run(command, args) {
    const result = spawn(command, args, { cwd: rootDir, env, stdio: 'inherit', shell: false })
    if (result.error) throw new Error(`Could not start plugin installation: ${result.error.message}`)
    if (result.status !== 0) {
      const error = new Error(result.status === 1223 ? 'Plugin installation cancelled at the UAC prompt. Built plugins are unchanged.' :
        `Plugin installation failed (exit ${result.status ?? 1}). Built plugins remain in plugin/build; close any DAW using them and check the copy error above.`)
      error.exitCode = result.status > 0 ? result.status : 1
      throw error
    }
  }
  if (platform === 'win32' && system) {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      join(rootDir, 'scripts/build/install-plugins-windows.ps1'), '-BuildDir', buildDir,
      '-Configuration', config, '-Formats', formats.join(',')])
  } else if (system && getuid?.() !== 0) {
    // Elevate only this copy helper, never npm, CMake, or dependency scripts.
    run('sudo', ['--', process.execPath, scriptPath, '--system', '--config', config, '--formats', formats.join(',')])
  } else {
    copyPluginArtifacts(products, directories)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try { installPlugins() }
  catch (error) { console.error(`[plugins] ${error.message}`); process.exitCode = error.exitCode || 1 }
}

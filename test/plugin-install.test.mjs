import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { pluginProducts, collectPluginArtifacts, releasePluginFormats } from '../scripts/build/stage-plugins.mjs'
import { installPlugins, pluginInstallDirectories } from '../scripts/build/install-plugins.mjs'

function fixture(t, platform = 'win32', formats = releasePluginFormats(platform)) {
  const rootDir = mkdtempSync(join(tmpdir(), "prism install's $ "))
  t.after(() => {
    assert.equal(dirname(resolve(rootDir)), resolve(tmpdir()))
    rmSync(rootDir, { recursive: true, force: true })
  })
  const file = (path, value = 'built plugin') => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, value)
  }
  const buildDir = join(rootDir, 'plugin/build')
  file(join(buildDir, 'CMakeCache.txt'), `PRISM_PLUGIN_FORMATS:STRING=${formats.join(';')};Standalone\n`)
  for (const [target, product] of pluginProducts) {
    for (const format of formats) {
      const extension = { VST3: 'vst3', CLAP: 'clap', AU: 'component' }[format]
      const source = join(buildDir, `${target}_artefacts/Release`, format, `${product}.${extension}`)
      if (platform === 'darwin') {
        file(join(source, 'Contents/Info.plist'))
        file(join(source, 'Contents/MacOS', product))
      } else if (format === 'CLAP') file(source)
      else file(join(source, 'Contents', platform === 'win32' ? 'arm64-win/plugin.vst3' : 'aarch64-linux/plugin.so'))
    }
  }
  const home = join(rootDir, 'user home')
  const env = { CommonProgramW6432: join(rootDir, 'Common Files'), LOCALAPPDATA: join(rootDir, 'Local AppData') }
  const calls = []
  const spawn = (command, args, options) => { calls.push({ command, args, options }); return { status: 0 } }
  const run = (argv = [], overrides = {}) => installPlugins({ rootDir, platform, home, env, spawn, argv, ...overrides })
  return { rootDir, buildDir, home, env, calls, run, file }
}

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`${platform}: user installation updates all selected products without elevation or touching other plugins`, (t) => {
    const { run, rootDir, home, env, calls, file } = fixture(t, platform)
    const directories = pluginInstallDirectories({ platform, home, env, system: false })
    const unrelated = join(directories.CLAP, 'Unrelated.clap')
    file(unrelated, 'keep')
    run(platform === 'win32' ? ['--user'] : [])
    run(platform === 'win32' ? ['--user'] : [])
    assert.equal(calls.length, 0, 'per-user installation must not request elevation')
    assert.equal(readFileSync(unrelated, 'utf8'), 'keep')
    for (const format of releasePluginFormats(platform)) {
      assert.equal(readdirSync(directories[format]).filter(name => name.startsWith('Prism ')).length, 9)
      assert.ok(directories[format].startsWith(rootDir))
    }
  })
}

test('Windows system installation delegates only copying to PowerShell', (t) => {
  const { run, calls, buildDir, env } = fixture(t)
  run()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'powershell.exe')
  assert.ok(calls[0].args.some(arg => arg.endsWith('install-plugins-windows.ps1')))
  assert.ok(calls[0].args.includes(buildDir))
  assert.equal(calls[0].options.shell, false)
  assert.ok(!existsSync(env.CommonProgramW6432), 'unelevated parent performs no system copies')
})

test('UAC cancellation is reported separately and preserves compiled plugins', (t) => {
  const { run, buildDir } = fixture(t)
  assert.throws(() => run([], { spawn: () => ({ status: 1223 }) }), error => error.exitCode === 1223 && /cancelled/.test(error.message))
  assert.equal(collectPluginArtifacts({ buildDir, platform: 'win32' }).length, 18)
})

test('VST3-only builds install without requiring CLAP or Standalone artifacts', (t) => {
  const { run, calls } = fixture(t, 'win32', ['VST3'])
  run()
  assert.equal(calls[0].args.at(-1), 'VST3')
})

test('missing final product fails before any elevation or partial installation', (t) => {
  const { run, buildDir, env, calls } = fixture(t)
  const missing = join(buildDir, 'PrismBridge_artefacts/Release/CLAP/Prism Bridge.clap')
  rmSync(missing)
  assert.throws(() => run(), /Missing plugin/)
  assert.equal(calls.length, 0)
  assert.ok(!existsSync(env.CommonProgramW6432))
})

test('dry run checks artifacts but never elevates or installs', (t) => {
  const { run, calls, env } = fixture(t)
  run(['--dry-run'])
  assert.equal(calls.length, 0)
  assert.ok(!existsSync(env.CommonProgramW6432))
})

for (const platform of ['darwin', 'linux']) {
  test(`${platform}: explicit system install elevates only the copy helper`, (t) => {
    const { run, calls } = fixture(t, platform)
    run(['--system'], { getuid: () => 1000 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, 'sudo')
    assert.equal(calls[0].args[1], process.execPath)
    assert.ok(calls[0].args[2].endsWith('install-plugins.mjs'))
    assert.ok(calls[0].args.includes('--system'))
  })
}

const quotePS = value => `'${value.replaceAll("'", "''")}'`
const helper = resolve('scripts/build/install-plugins-windows.ps1')
function powershell(source) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8' })
}

test('Windows copy helper updates actual bundles twice without nesting or changing unrelated files', { skip: process.platform !== 'win32' }, (t) => {
  const { buildDir, env, file } = fixture(t)
  const unrelated = join(env.CommonProgramW6432, 'VST3/Unrelated.vst3')
  file(unrelated, 'keep')
  const updatedClap = join(buildDir, 'PrismBridge_artefacts/Release/CLAP/Prism Bridge.clap')
  const script = `. ${quotePS(helper)}; $plan = @(Get-PrismWindowsInstallPlan ${quotePS(buildDir)} Release 'VST3,CLAP' ${quotePS(env.CommonProgramW6432)}); Copy-PrismWindowsPlugins $plan; [IO.File]::WriteAllText(${quotePS(updatedClap)}, 'updated plugin'); Copy-PrismWindowsPlugins $plan`
  const result = powershell(script)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const [, product] of pluginProducts) {
    assert.equal(readFileSync(join(env.CommonProgramW6432, 'VST3', `${product}.vst3/Contents/arm64-win/plugin.vst3`), 'utf8'), 'built plugin')
    assert.equal(readFileSync(join(env.CommonProgramW6432, 'CLAP', `${product}.clap`), 'utf8'), product === 'Prism Bridge' ? 'updated plugin' : 'built plugin')
    assert.ok(!existsSync(join(env.CommonProgramW6432, 'VST3', `${product}.vst3`, `${product}.vst3`)))
  }
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep')
})

test('Windows helper preflight rejects an incomplete set without copying anything', { skip: process.platform !== 'win32' }, (t) => {
  const { buildDir, env } = fixture(t)
  rmSync(join(buildDir, 'PrismBridge_artefacts/Release/CLAP/Prism Bridge.clap'))
  const result = powershell(`. ${quotePS(helper)}; $plan = @(Get-PrismWindowsInstallPlan ${quotePS(buildDir)} Release 'VST3,CLAP' ${quotePS(env.CommonProgramW6432)}); Copy-PrismWindowsPlugins $plan`)
  assert.notEqual(result.status, 0)
  assert.ok(!existsSync(env.CommonProgramW6432))
})

test('elevated invocation preserves spaces, apostrophes and shell metacharacters as literal data', { skip: process.platform !== 'win32' }, (t) => {
  const { rootDir, file } = fixture(t)
  const fakeHelper = join(rootDir, 'record arguments.ps1')
  file(fakeHelper, 'param($BuildDir, $Configuration, $Formats, [switch]$Elevated)\n@{ BuildDir=$BuildDir; Configuration=$Configuration; Formats=$Formats; Elevated=[bool]$Elevated } | ConvertTo-Json -Compress')
  const source = join(rootDir, "space ' & $(must-not-run) ` build")
  const result = powershell(`. ${quotePS(helper)}; $arguments = Get-PrismElevationArguments ${quotePS(fakeHelper)} ${quotePS(source)} Release 'VST3,CLAP'; $arguments[-1]`)
  assert.equal(result.status, 0, result.stderr)
  const invoked = powershell(Buffer.from(result.stdout.trim(), 'base64').toString('utf16le'))
  assert.equal(invoked.status, 0, invoked.stderr)
  assert.deepEqual(JSON.parse(invoked.stdout), { BuildDir: source, Configuration: 'Release', Formats: 'VST3,CLAP', Elevated: true })
})

test('distribution scripts prepare plugins before packaging, while AppImage remains app-only', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const name of ['dist:mac', 'dist:win', 'dist:linux:packages']) {
    assert.ok(scripts[name].indexOf('npm run prepare:plugins') < scripts[name].indexOf('electron-builder'))
    assert.ok(scripts[name].includes('npm run prepare:plugins'))
  }
  assert.ok(scripts['dist:linux'].includes('dist:linux:packages'))
  assert.ok(!scripts['dist:linux:appimage'].includes('prepare:plugins'))
})

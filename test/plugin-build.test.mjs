import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { buildPlugins } from '../scripts/build/build-plugins.cjs'

function fixture(t, platform = 'win32') {
  const rootDir = mkdtempSync(join(tmpdir(), 'prism plugin build '))
  t.after(() => {
    assert.equal(dirname(resolve(rootDir)), resolve(tmpdir()))
    rmSync(rootDir, { recursive: true, force: true })
  })
  const calls = []
  const env = { npm_execpath: join(rootDir, 'node tools/npm-cli.js') }
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { status: 0 }
  }
  const run = (argv = [], overrides = {}) => buildPlugins({ rootDir, platform, env, spawn, argv, ...overrides })
  const file = (path, contents = '') => {
    const absolute = join(rootDir, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  return { rootDir, calls, env, run, file }
}

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: UI precedes configure/build without imposing a generator or plugin formats`, (t) => {
    const { run, calls, env, file } = fixture(t, platform)
    file('plugin/build/CMakeCache.txt', 'CMAKE_GENERATOR:INTERNAL=Ninja\nPRISM_PLUGIN_FORMATS:STRING=VST3;CLAP\n')
    env.CMAKE_BUILD_PARALLEL_LEVEL = '2'
    env.JUCE_WEBVIEW2_PACKAGE_LOCATION = 'SDK directory with spaces'
    run()
    assert.equal(calls.length, 3)
    assert.equal(calls[0].command, process.execPath, 'npm must use Node, not a Windows command shim')
    assert.deepEqual(calls[0].args, [env.npm_execpath, 'run', 'plugin-ui:build'])
    const configure = calls[1].args
    assert.equal(calls[1].command, 'cmake')
    assert.ok(configure.includes('-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF'), 'builds must not unexpectedly install')
    assert.ok(!configure.some(arg => /^-DPRISM_PLUGIN_FORMATS=|^-G$|^-A$|^-T$/.test(arg)))
    assert.equal(configure.some(arg => arg.includes('JUCE_WEBVIEW2')), platform === 'win32')
    assert.deepEqual(calls[2].args, ['--build', 'plugin/build', '--config', 'Release', '--parallel', '2'])
    assert.ok(calls.every(call => call.options.shell === false), 'spaces and semicolons must not go through a shell')
  })
}

test('CMake arguments retain spaces/semicolons, and Debug configuration reaches compilation and CTest', (t) => {
  const { run, calls } = fixture(t, 'darwin')
  run(['--test', '--jobs', '3', '-D', 'CMAKE_BUILD_TYPE:STRING=Debug', '-DPRISM_PLUGIN_FORMATS=AU;VST3;CLAP',
    '-DJUCE_PATH=/a local checkout/JUCE', '-DBUILD_TESTING=OFF'])
  assert.ok(calls[1].args.includes('-DPRISM_PLUGIN_FORMATS=AU;VST3;CLAP'))
  assert.ok(calls[1].args.includes('-DJUCE_PATH=/a local checkout/JUCE'))
  assert.equal(calls[1].args.at(-1), '-DBUILD_TESTING=ON', 'test command must enable cached-disabled tests')
  assert.deepEqual(calls[2].args, ['--build', 'plugin/build', '--config', 'Debug', '--parallel', '3'])
  assert.equal(calls[3].command, 'ctest')
  assert.deepEqual(calls[3].args, ['--test-dir', 'plugin/build', '-C', 'Debug', '--output-on-failure'])
})

test('configuration supports an explicit generator/toolchain without installing', (t) => {
  const { run, calls } = fixture(t)
  run(['--configure-only', '-G', 'Visual Studio 17 2022', '-A', 'ARM64', '-T', 'v143'])
  assert.equal(calls.length, 2)
  assert.ok(calls[1].args.includes('-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF'))
  assert.deepEqual(calls[1].args.slice(-6), ['-G', 'Visual Studio 17 2022', '-A', 'ARM64', '-T', 'v143'])
})

for (const source of ['local', 'cache', 'environment', 'argument']) {
  test(`Windows WebView2 precedence: ${source}`, (t) => {
    const { run, calls, file, env, rootDir } = fixture(t)
    file('plugin/sdk/Microsoft.Web.WebView2/build/native/include/WebView2.h')
    if (source !== 'local') file('plugin/build/CMakeCache.txt', 'JUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=cached SDK\r\n')
    if (['environment', 'argument'].includes(source)) env.JUCE_WEBVIEW2_PACKAGE_LOCATION = 'environment SDK'
    run(source === 'argument' ? ['-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=explicit SDK'] : [])
    const sdkArgs = calls[1].args.filter(arg => arg.includes('JUCE_WEBVIEW2_PACKAGE_LOCATION'))
    const expected = {
      local: [`-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=${join(rootDir, 'plugin/sdk')}`],
      cache: [],
      environment: ['-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=environment SDK'],
      argument: ['-DJUCE_WEBVIEW2_PACKAGE_LOCATION:PATH=explicit SDK'],
    }
    assert.deepEqual(sdkArgs, expected[source])
  })
}

for (const failedPhase of [1, 2, 3, 4]) {
  test(`failure in phase ${failedPhase} stops subsequent work and preserves the exit code`, (t) => {
    const { run } = fixture(t)
    let count = 0
    assert.throws(() => run(['--test'], { spawn: () => ({ status: ++count === failedPhase ? 7 : 0 }) }),
      error => error.exitCode === 7)
    assert.equal(count, failedPhase)
  })
}

test('invalid options and missing npm fail before any build runs', (t) => {
  const { run, calls } = fixture(t)
  for (const argv of [['--jobs', '0'], ['--jobs'], ['--unknown'], ['-B', 'other'], ['-Dbroken'],
    ['-G'], ['-DCMAKE_BUILD_TYPE='], ['--test', '--configure-only'], ['--install', '--configure-only'],
    ['--stage', '--configure-only'], ['--stage', '--install'], ['--stage', '-DCMAKE_BUILD_TYPE=Debug'],
    ['-DPRISM_COPY_PLUGIN_AFTER_BUILD=ON']]) assert.throws(() => run(argv))
  assert.throws(() => run([], { env: {} }), /Run this script through npm/)
  assert.equal(calls.length, 0)
})

test('installation runs only after a successful unelevated build and tests', (t) => {
  const { run, calls, rootDir } = fixture(t)
  run(['--install', '--test'])
  assert.ok(calls[1].args.includes('-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF'))
  assert.equal(calls[3].command, 'ctest')
  assert.equal(calls[4].command, process.execPath)
  assert.deepEqual(calls[4].args, [join(rootDir, 'scripts/build/install-plugins.mjs'), '--config', 'Release'])
})

test('failed compilation never invokes installation', (t) => {
  const { run } = fixture(t)
  let count = 0
  assert.throws(() => run(['--install'], { spawn: () => ({ status: ++count === 3 ? 2 : 0 }) }), /compilation failed/)
  assert.equal(count, 3)
})

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: packaging adds missing release formats to an old cache before staging`, (t) => {
    const { run, file, calls, rootDir } = fixture(t, platform)
    file('plugin/build/CMakeCache.txt', 'PRISM_PLUGIN_FORMATS:STRING=VST3;Standalone\nPRISM_COPY_PLUGIN_AFTER_BUILD:BOOL=ON\n')
    run(['--stage'])
    const formats = calls[1].args.find(arg => arg.startsWith('-DPRISM_PLUGIN_FORMATS=')).split('=')[1].split(';')
    assert.ok(formats.includes('VST3') && formats.includes('CLAP') && formats.includes('Standalone'))
    assert.equal(formats.includes('AU'), platform === 'darwin')
    assert.ok(calls[1].args.includes('-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF'))
    assert.deepEqual(calls[2].args.slice(-2), ['--target', 'PrismInstallerPlugins'])
    assert.deepEqual(calls[3].args, [join(rootDir, 'scripts/build/stage-plugins.mjs')])
  })
}

test('CI prebuilt mode still runs artifact validation/staging without a compiler environment', (t) => {
  const { run, env, calls, rootDir } = fixture(t)
  env.PRISM_PLUGINS_PREBUILT = '1'
  run(['--stage'])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [join(rootDir, 'scripts/build/stage-plugins.mjs')])
})

test('explicit tests are not silently skipped by the CI prebuilt setting', (t) => {
  const { run, env, calls } = fixture(t)
  env.PRISM_PLUGINS_PREBUILT = '1'
  run(['--stage', '--test'])
  assert.equal(calls[3].command, 'ctest')
  assert.ok(calls[4].args[0].endsWith('stage-plugins.mjs'))
})

test('missing CMake reports the prerequisite and stops before compilation', (t) => {
  const { run } = fixture(t)
  let count = 0
  assert.throws(() => run([], { spawn: () => ++count === 1 ? { status: 0 } : { error: new Error('ENOENT') } }),
    /Install CMake 3.22\+/)
  assert.equal(count, 2)
})

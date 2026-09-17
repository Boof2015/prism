import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { pluginProducts, stagePlugins } from '../scripts/build/stage-plugins.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prism plugins '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function file(path, contents = 'plugin fixture') {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}
function formatSource(root, format) {
  const directory = join(root, format)
  for (const [, name] of pluginProducts) {
    file(format === 'CLAP' ? join(directory, `${name}.clap`) : join(directory, `${name}.vst3/Contents/x86_64-linux/plugin.so`))
  }
  return directory
}
function runHook(path, args, env) {
  return spawnSync('sh', [resolve(path), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })
}
function succeed(result) { assert.equal(result.status, 0, result.stdout + result.stderr) }

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`stages complete ${platform} format sets and rejects incomplete releases`, (t) => {
    const root = fixture(t)
    const buildDir = join(root, 'build')
    const destination = join(root, 'staging')
    const formats = [['VST3', 'vst3'], ['CLAP', 'clap']]
    if (platform === 'darwin') formats.push(['AU', 'component'])
    for (const [target, product] of pluginProducts) {
      for (const [format, extension] of formats) {
        const source = join(buildDir, `${target}_artefacts/Release`, format, `${product}.${extension}`)
        if (platform === 'darwin') {
          file(join(source, 'Contents/MacOS', product))
          file(join(source, 'Contents/Info.plist'))
        } else if (format === 'CLAP') file(source)
        else file(join(source, `Contents/${platform === 'linux' ? 'x86_64-linux/plugin.so' : 'x86_64-win/plugin.vst3'}`))
      }
    }
    stagePlugins({ buildDir, destination, platform })
    for (const [format] of formats) assert.equal(readdirSync(join(destination, format)).length, 9)
    if (platform === 'linux') {
      assert.ok(existsSync(join(destination, 'install-clap.sh')))
      assert.ok(existsSync(join(destination, 'install-vst3.sh')))
    }
    const missing = join(buildDir, 'PrismBridge_artefacts/Release/CLAP/Prism Bridge.clap')
    rmSync(missing, { recursive: true })
    assert.throws(() => stagePlugins({ buildDir, destination, platform }), /Missing plugin/)
    assert.ok(existsSync(join(destination, 'CLAP/Prism Bridge.clap')), 'failed preflight preserves previous staging')
    mkdirSync(missing)
    assert.throws(() => stagePlugins({ buildDir, destination, platform }), /Missing plugin/, 'rejects wrong file type or malformed bundle')
  })
}

test('Linux CLAP tar helper supports overrides, repeat installs, and complete-set preflight', { skip: process.platform === 'win32' }, (t) => {
  const root = fixture(t)
  const source = formatSource(root, 'CLAP')
  const dest = join(root, 'user plugins')
  const helper = 'resources/installer/linux/install-clap.sh'
  succeed(runHook(helper, ['--system', '--dest', dest, '--source', source], {}))
  assert.equal(readdirSync(dest).length, 9)
  file(join(dest, 'Prism Other.clap'), 'unrelated')
  file(join(source, 'Prism Spectrum.clap'), 'updated')
  succeed(runHook(helper, [], { PRISM_CLAP_SOURCE_DIR: source, PRISM_CLAP_DEST_DIR: dest }))
  assert.equal(readFileSync(join(dest, 'Prism Spectrum.clap'), 'utf8'), 'updated')
  assert.equal(readFileSync(join(dest, 'Prism Other.clap'), 'utf8'), 'unrelated')
  rmSync(join(source, 'Prism Bridge.clap'))
  file(join(source, 'Prism Spectrum.clap'), 'must not copy')
  assert.notEqual(runHook(helper, ['--source', source, '--dest', dest], {}).status, 0)
  assert.equal(readFileSync(join(dest, 'Prism Spectrum.clap'), 'utf8'), 'updated')
  for (const args of [['--dest'], ['--source'], ['--unknown']]) assert.equal(runHook(helper, args, {}).status, 2)
})

test('Linux package hooks install both formats, preserve upgrades, and remove only named plugins', { skip: process.platform === 'win32' }, (t) => {
  const root = fixture(t)
  const env = {
    PRISM_VST3_SOURCE_DIR: formatSource(root, 'VST3'),
    PRISM_CLAP_SOURCE_DIR: formatSource(root, 'CLAP'),
    PRISM_VST3_DEST_DIR: join(root, 'installed VST3'),
    PRISM_CLAP_DEST_DIR: join(root, 'installed CLAP'),
    PRISM_TUI_SOURCE_PATH: join(root, 'app/tui/prism-tui'),
    PRISM_TUI_LINK_PATH: join(root, 'prism-tui'),
  }
  file(env.PRISM_TUI_SOURCE_PATH, '#!/bin/sh\nexit 0\n')
  const install = 'resources/installer/linux/install-vst3-from-package.sh'
  const remove = 'resources/installer/linux/remove-vst3-from-system.sh'
  succeed(runHook(install, [], env))
  succeed(runHook(install, [], env))
  for (const format of ['VST3', 'CLAP']) assert.equal(readdirSync(env[`PRISM_${format}_DEST_DIR`]).length, 9)
  const unrelated = join(env.PRISM_CLAP_DEST_DIR, 'Prism Unrelated.clap')
  file(unrelated, 'keep')
  for (const action of ['upgrade', 'failed-upgrade', 'abort-upgrade', '1', '2']) {
    succeed(runHook(remove, [action], env))
    assert.ok(existsSync(join(env.PRISM_CLAP_DEST_DIR, 'Prism Bridge.clap')))
    assert.ok(existsSync(env.PRISM_TUI_LINK_PATH))
  }
  for (const action of ['remove', '0']) {
    succeed(runHook(remove, [action], env))
    assert.deepEqual(readdirSync(env.PRISM_CLAP_DEST_DIR), ['Prism Unrelated.clap'])
    assert.deepEqual(readdirSync(env.PRISM_VST3_DEST_DIR), [])
    assert.ok(!existsSync(env.PRISM_TUI_LINK_PATH))
    assert.equal(readFileSync(unrelated, 'utf8'), 'keep')
    if (action === 'remove') succeed(runHook(install, [], env))
  }
  // Optional missing VST3 resources must not suppress an available CLAP set.
  env.PRISM_VST3_SOURCE_DIR = join(root, 'missing VST3')
  succeed(runHook(install, [], env))
  assert.ok(existsSync(join(env.PRISM_CLAP_DEST_DIR, 'Prism Bridge.clap')))
  rmSync(join(env.PRISM_CLAP_SOURCE_DIR, 'Prism Bridge.clap'))
  assert.notEqual(runHook(install, [], env).status, 0, 'a partial format is an installation error')
})

test('macOS package hook copies all CLAP bundles and supports repeated installation', { skip: process.platform === 'win32' }, (t) => {
  const root = fixture(t)
  const apps = join(root, 'Applications')
  const source = join(apps, 'Prism.app/Contents/Resources/plugins/CLAP')
  for (const [, name] of pluginProducts) file(join(source, `${name}.clap/Contents/MacOS`, name))
  const env = {
    PRISM_VST3_DEST_DIR: join(root, 'VST3'), PRISM_AU_DEST_DIR: join(root, 'AU'),
    PRISM_CLAP_DEST_DIR: join(root, 'CLAP'), PRISM_TUI_LINK_PATH: join(root, 'prism-tui'),
  }
  const hook = 'resources/installer/macos-scripts/postinstall'
  succeed(runHook(hook, ['fixture.pkg', apps], env))
  succeed(runHook(hook, ['fixture.pkg', apps], env))
  assert.equal(readdirSync(env.PRISM_CLAP_DEST_DIR).length, 9)
  assert.ok(existsSync(join(env.PRISM_CLAP_DEST_DIR, 'Prism Bridge.clap/Contents/MacOS/Prism Bridge')))
  rmSync(join(source, 'Prism Bridge.clap'), { recursive: true })
  assert.notEqual(runHook(hook, ['fixture.pkg', apps], env).status, 0)
})

test('AppImage resources exclude plugins even with CLAP staging present', async () => {
  const { default: config } = await import('../electron-builder.appimage.cjs')
  assert.ok(!config.extraResources.some(({ to }) => to === 'plugins/'))
})

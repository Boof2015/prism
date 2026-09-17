import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pluginProducts } from './build/stage-plugins.mjs'

const buildDir = resolve('plugin/build')
const cache = readFileSync(join(buildDir, 'CMakeCache.txt'), 'utf8')
const value = (name) => cache.split('\n').find((line) => line.startsWith(`${name}:`))?.split('=').slice(1).join('=').trim()
const juce = value('JUCE_SOURCE_DIR')
const clap = value('clap-juce-extensions_SOURCE_DIR')
assert.ok(juce && clap, 'Configure the full CLAP-enabled build first')

for (const formats of ['CLAP', 'VST3']) {
  const dir = join(buildDir, 'format-checks', formats.toLowerCase())
  const query = join(dir, '.cmake/api/v1/query')
  mkdirSync(query, { recursive: true })
  writeFileSync(join(query, 'codemodel-v2'), '')
  const args = ['-S', resolve('plugin'), '-B', dir, '-G', value('CMAKE_GENERATOR'),
    `-DJUCE_PATH=${juce}`, `-DPRISM_PLUGIN_FORMATS=${formats}`,
    '-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF', '-DPRISM_DEV_SERVER=ON',
    '-DBUILD_TESTING=OFF', '-DCMAKE_BUILD_TYPE=Release',
    // A deliberately invalid dependency path proves VST3 builds never load it.
    `-DCLAP_JUCE_EXTENSIONS_PATH=${formats === 'CLAP' ? clap : join(dir, 'must-not-be-read')}`]
  for (const name of ['JUCE_WEBVIEW2_PACKAGE_LOCATION', 'CMAKE_OSX_ARCHITECTURES', 'CMAKE_OSX_DEPLOYMENT_TARGET']) {
    if (value(name)) args.push(`-D${name}=${value(name)}`)
  }
  const result = spawnSync('cmake', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  writeFileSync(join(dir, 'configure.log'), `${result.stdout || ''}${result.stderr || ''}`)
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
  const reply = join(dir, '.cmake/api/v1/reply')
  const indexName = readdirSync(reply).filter((name) => name.startsWith('index-')).sort().at(-1)
  const index = JSON.parse(readFileSync(join(reply, indexName), 'utf8'))
  const model = JSON.parse(readFileSync(join(reply, index.reply['codemodel-v2'].jsonFile), 'utf8'))
  const targets = model.configurations[0].targets.map(({ name }) => name)
  for (const [target] of pluginProducts) {
    assert.ok(targets.includes(`${target}_${formats}`), `${target}_${formats} must exist`)
    for (const excluded of ['CLAP', 'VST3', 'AU', 'Standalone'].filter((format) => format !== formats)) {
      assert.ok(!targets.includes(`${target}_${excluded}`), `${target}_${excluded} must not exist`)
    }
  }
  if (formats === 'VST3') {
    assert.ok(!readFileSync(join(dir, 'CMakeCache.txt'), 'utf8').includes('CLAP_SOURCE_DIR:'), 'CLAP SDK was not loaded')
  }
  console.log(`${formats}-only configuration has exactly the nine requested plugin targets`)
}

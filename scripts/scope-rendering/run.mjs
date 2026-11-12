import { build } from 'esbuild'
import { cp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const output = resolve(option('--output', join(tmpdir(), 'prism-scope-rendering')))
const baseline = option('--baseline', '4972180')
const mode = args.includes('--benchmark') ? 'benchmark' : 'visual'
const webkit = args.includes('--webkit')
await mkdir(output, { recursive: true })
const base = join(output, 'baseline')
await mkdir(base, { recursive: true })
execFileSync('tar', ['-x', '-C', base], { input: execFileSync('git', ['archive', baseline, 'src'], { cwd: root, maxBuffer: 32 * 1024 * 1024 }) })
if (!existsSync(join(base, 'node_modules'))) await symlink(join(root, 'node_modules'), join(base, 'node_modules'))
const stages = {
  history: ['Spectrogram.ts', 'Waveform.ts'],
  spectrum: ['SpectrumAnalyzer.ts', 'spectrumHeatmapColors.ts'],
  gpu: ['Vectorscope.ts', 'vectorscopeGpu.ts'],
  caches: ['Oscilloscope.ts', 'LUFSMeter.ts', 'meterRenderCache.ts'],
}
const sources = { baseline: base, current: root }
if (args.includes('--stages')) for (const [stage, files] of Object.entries(stages)) {
  const directory = join(output, stage)
  await mkdir(directory, { recursive: true })
  await cp(join(base, 'src'), join(directory, 'src'), { recursive: true })
  if (!existsSync(join(directory, 'node_modules'))) await symlink(join(root, 'node_modules'), join(directory, 'node_modules'))
  for (const file of files) await cp(join(root, 'src/renderer/visualizers', file), join(directory, 'src/renderer/visualizers', file))
  sources[stage] = directory
}
for (const [variant, directory] of Object.entries(sources)) await build({
  entryPoints: [join(root, 'scripts/scope-rendering/fixture.ts')], outfile: join(output, `${variant}.js`),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome144',
  alias: { 'scope-source': join(directory, 'src') },
})
let fonts = ''
for (const weight of [400, 500, 600, 700]) {
  const font = pathToFileURL(join(root, `node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${weight}-normal.woff2`)).href
  fonts += `@font-face{font-family:'JetBrains Mono';font-weight:${weight};src:url('${font}')}`
}
const all = ['spectrum', 'oscilloscope', 'spectrogram', 'waveform', 'vectorscope', 'vumeter', 'lufsmeter']
const cases = []
const add = (id, scopes, settings = {}, stage = 'current') => cases.push({ id, stage, config: {
  mode, scopes, width: 420, height: 210, fps: 120, dpr: 2, ...settings,
} })
if (mode === 'visual') {
  for (const dpr of [1, 2]) for (const transport of ['native', 'bridge']) {
    for (const transition of ['', 'resize', 'theme', 'pause', 'reset']) add(`all-${dpr}-${transport}-${transition || 'steady'}`, all, { dpr, transport, transition })
    add(`small-${dpr}-${transport}`, all, { dpr, transport, width: 180, height: 100, background: '#f5f5f5' })
    for (const orientation of ['horizontal', 'vertical']) for (const colorScheme of ['mono', 'heat'])
      add(`history-${orientation}-${colorScheme}-${dpr}-${transport}`, ['spectrogram', 'waveform'], { orientation, colorScheme, dpr, transport, transition: 'resize' })
    for (const reference of ['overlay', 'difference']) add(`reference-${reference}-${dpr}-${transport}`, ['spectrum'], { reference, dpr, transport })
  }
  for (const projection of ['lissajous', 'polar-unipolar', 'polar-bipolar', 'linear-unipolar', 'linear-bipolar'])
    for (const persistence of [0.1, 1]) add(`gpu-${projection}-${persistence}`, ['vectorscope'], { projection, persistence })
  add('gpu-loss', ['vectorscope'], { transition: 'loss' })
  add('gpu-ordinary', ['vectorscope'], { transition: 'ordinary' })
  add('gpu-unavailable', ['vectorscope'], { forceCanvas: true })
  add('fallback', ['vectorscope', 'waveform'], { fallback: true })
  for (const sampleRate of [44100, 96000]) add(`sample-rate-${sampleRate}`, all, { sampleRate })
  add('heatmap-off', ['spectrum'], { heatmap: false })
  add('vu-bars', ['vumeter'], { vuMode: 'bar' })
  add('wave-mono', ['waveform'], { waveformMode: 'mono', waveformMultiband: false })
} else {
  for (const kind of all) add(kind, [kind], {}, ['spectrogram', 'waveform'].includes(kind) ? 'history' : kind === 'spectrum' ? 'spectrum' : kind === 'vectorscope' ? 'gpu' : 'caches')
  add('spectrum-plain', ['spectrum'], { heatmap: false }, 'spectrum')
  add('mixed-gpu', ['spectrum', 'oscilloscope', 'vectorscope'], {}, 'gpu')
  add('mixed-history', ['spectrum', 'spectrogram', 'waveform'], {}, 'history')
  add('mixed-caches', ['spectrum', 'vumeter', 'lufsmeter'], {}, 'caches')
  for (const fps of [60, 120]) {
    add(`all-${fps}`, all, { fps })
    add(`hidden-${fps}`, [], { fps })
  }
}
const filter = new RegExp(option('--filter', '.*'))
const runs = []
const rounds = Number(option('--rounds', mode === 'visual' ? '1' : '3'))
for (let round = 0; round < rounds; round++) for (const c of cases.filter(c => filter.test(c.id))) {
  if (webkit && c.config.transport === 'native') continue
  if (webkit) c.config.transport = 'bridge'
  const variant = args.includes('--stages') ? c.stage : 'current'
  for (const v of (round % 2 ? [variant, 'baseline'] : ['baseline', variant])) runs.push({
    id: `${c.id}-r${round}`, variant: v, bundle: join(output, `${v}.js`), config: c.config,
  })
}
const manifest = { output, fonts, baseline, native: join(root, 'native/build/Release/visualizer_dsp.node'), runs,
  warmup: Number(option('--warmup', '2')), seconds: Number(option('--seconds', '6')), resultName: `${mode}-results.json` }
const manifestPath = join(output, `${mode}-manifest.json`)
await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
if (args.includes('--prepare')) {
  console.log(manifestPath)
  process.exit(0)
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const require = createRequire(import.meta.url)
let executable = require('electron')
let launchArgs = [join(root, 'scripts/scope-rendering/electron.cjs'), manifestPath]
if (webkit) {
  executable = join(output, 'webkit-runner')
  execFileSync('swiftc', ['-module-cache-path', join(output, 'swift-cache'), join(root, 'scripts/scope-rendering/webkit.swift'), '-o', executable])
  launchArgs = [manifestPath]
}
await new Promise((done, reject) => {
  const child = spawn(executable, launchArgs, { env, stdio: 'inherit' })
  child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`Browser exited ${code}`)))
})
if (mode === 'visual') {
  const { results } = JSON.parse(await readFile(join(output, 'visual-results.json'), 'utf8'))
  const comparisons = []
  for (let i = 0; i < results.length; i += 2) {
    const pair = results.slice(i, i + 2)
    const before = pair.find(result => result.variant === 'baseline')
    const after = pair.find(result => result.variant !== 'baseline')
    for (const capture of before.captures) {
      const a = await readFile(join(output, `${before.id}-${before.variant}-${capture.kind}.rgba`))
      const b = await readFile(join(output, `${after.id}-${after.variant}-${capture.kind}.rgba`))
      if (a.length !== b.length) throw new Error('Capture dimensions changed')
      let max = 0, changed = 0
      for (let pixel = 0; pixel < a.length; pixel += 4) {
        let difference = 0
        for (let channel = 0; channel < 4; channel++) {
          const aa = channel === 3 ? a[pixel + 3] : a[pixel + channel] * a[pixel + 3] / 255
          const bb = channel === 3 ? b[pixel + 3] : b[pixel + channel] * b[pixel + 3] / 255
          difference = Math.max(difference, Math.abs(aa - bb))
        }
        if (difference > 0) changed++
        max = Math.max(max, difference)
      }
      const gpu = after.gpu[after.captures.findIndex(c => c.kind === capture.kind)]
      const tolerance = capture.kind === 'vectorscope' && gpu ? (after.config.persistence === 1 ? 7 : 3) : 0
      comparisons.push({ id: before.id, scope: capture.kind, max, changed, pixels: a.length / 4, tolerance, pass: max <= tolerance })
    }
  }
  await writeFile(join(output, 'visual-comparisons.json'), JSON.stringify(comparisons, null, 2))
  const failed = comparisons.filter(c => !c.pass)
  console.log(JSON.stringify({ comparisons: comparisons.length, failed }, null, 2))
  if (failed.length) process.exitCode = 1
}

import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { generateReport } from './report.mjs'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const quick = args.includes('--quick')
const outputIndex = args.indexOf('--output')
if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output requires a directory')
const output = resolve(outputIndex >= 0 ? args[outputIndex + 1] : join(root, 'benchmark-results', new Date().toISOString().replaceAll(':', '-')))
if (process.platform !== 'darwin') throw new Error('This first benchmark supports native macOS system capture only')
const run = (command, argv, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, argv, { cwd: root, stdio: 'inherit', ...options })
  child.on('error', reject)
  child.on('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code ?? signal}`)))
})
await mkdir(output, { recursive: true })
// Refuse accidental overwrite of a previous experiment.
await writeFile(join(output, 'run.lock'), `${process.pid}\n`, { flag: 'wx' })
await mkdir(join(output, 'user-data'), { recursive: true })
const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' })
const baseCommit = '166e0f03369a2c13a3ede5d43c7bb70b8751e447'
const measurementCommit = git('rev-parse', 'HEAD').trim()
let patch = git('diff', '--binary', baseCommit)
const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
for (const file of untracked) {
  try { patch += git('diff', '--no-index', '--binary', '--', '/dev/null', file) }
  catch (error) { if (error.status !== 1) throw error; patch += error.stdout }
}
await writeFile(join(output, 'benchmark.patch'), patch)
const files = [...new Set([...git('ls-files', '-z').split('\0').filter(Boolean), ...untracked])]
const hashes = {}
for (const file of files) {
  try { hashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex') }
  catch (error) { if (error.code !== 'ENOENT') throw error; hashes[file] = null }
}
const env = { ...process.env, PRISM_LATENCY_BENCHMARK: '1', PRISM_LATENCY_BENCHMARK_DIR: output,
  PRISM_BENCH_DURATION: quick ? '3' : '60', PRISM_BENCH_WARMUP: quick ? '2' : '10', PRISM_BENCH_REPEATS: quick ? '1' : '3' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
await writeFile(join(output, 'source-manifest.json'), JSON.stringify({
  baseCommit, measurementCommit, branch: git('branch', '--show-current').trim(), version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  patchSha256: createHash('sha256').update(patch).digest('hex'), files: hashes,
  quick, createdAt: new Date().toISOString(), command: process.argv, nodeVersion: process.version,
}, null, 2))

// A file-backed external player keeps synthesis work off Prism's rendering thread.
const sampleRate = 48000, seconds = Number(env.PRISM_BENCH_DURATION) + Number(env.PRISM_BENCH_WARMUP) + 15
const totalFrames = Math.ceil(sampleRate * seconds), dataSize = totalFrames * 4
const header = Buffer.alloc(44)
header.write('RIFF'); header.writeUInt32LE(36 + dataSize, 4); header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28)
header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(dataSize, 40)
const wav = await open(join(output, 'stimulus.wav'), 'w')
await wav.write(header)
const block = Buffer.alloc(sampleRate * 4)
let phaseL = 0, phaseR = 0
for (let first = 0; first < totalFrames; first += sampleRate) {
  const frames = Math.min(sampleRate, totalFrames - first)
  for (let i = 0; i < frames; i++) {
    const t = (first + i) / sampleRate
    const step = Math.floor(t / 0.73) % 4
    phaseL += 2 * Math.PI * [220, 440, 880, 330][step] / sampleRate
    phaseR += 2 * Math.PI * [330, 550, 660, 440][step] / sampleRate
    const amplitude = 0.025 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 1.37 * t))
    block.writeInt16LE(Math.round(32767 * amplitude * Math.sin(phaseL)), i * 4)
    block.writeInt16LE(Math.round(32767 * amplitude * Math.sin(phaseR)), i * 4 + 2)
  }
  await wav.write(block.subarray(0, frames * 4))
}
await wav.close()
await writeFile(join(output, 'stimulus.json'), JSON.stringify({ sampleRate, channels: 2, format: 'PCM16', seconds,
  peakAmplitude: 0.025, amplitudeModulationHz: 1.37, frequencyStepSeconds: 0.73,
  leftHz: [220, 440, 880, 330], rightHz: [330, 550, 660, 440],
  sha256: createHash('sha256').update(await readFile(join(output, 'stimulus.wav'))).digest('hex'),
}, null, 2))
await run(process.execPath, [join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', '--config', 'scripts/benchmark/electron.config.mjs'], { env })
await run(process.execPath, ['scripts/build/writeAppBuildMetadata.cjs'], { env })
const require = createRequire(import.meta.url)
const electron = require('electron')
await run('npm', ['run', 'rebuild:native'], { env })
const nativePath = join(root, 'native/build/Release/visualizer_dsp.node')
await run(electron, [join(root, 'scripts/benchmark/check-native.cjs'), nativePath], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
await writeFile(join(output, 'native-build.json'), JSON.stringify({ path: nativePath,
  sha256: createHash('sha256').update(await readFile(nativePath)).digest('hex'),
  electronVersion: require('electron/package.json').version, rebuiltFromSource: true,
}, null, 2))
console.log(`Benchmark artifacts: ${output}\n${quick ? 'Diagnostic quick run; not suitable for published claims.' : 'Full suite: approximately 29 minutes. Keep Prism visible; a quiet test tone will play.'}`)
await run(electron, [join(root, 'scripts/benchmark/cooldown.cjs')], { env })
try {
  await run(electron, [root], { env })
} finally {
  await generateReport(output)
}

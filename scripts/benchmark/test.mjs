import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
const directory = await mkdtemp(join(tmpdir(), 'prism-latency-tests-'))
try {
  for (const [name, enabled] of [['latency-benchmark', false], ['latency-benchmark-integration', true]]) {
  const file = join(directory, name + '.mjs')
  await build({ entryPoints: [resolve(import.meta.dirname, `../../test/${name}.test.ts`)], outfile: file,
    bundle: true, platform: 'node', format: 'esm', define: { __PRISM_LATENCY_BENCHMARK__: String(enabled) } })
  process.exitCode = await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--test', file], { stdio: 'inherit' })
    child.on('error', reject); child.on('exit', code => resolveRun(code ?? 1))
  })
  if (process.exitCode) break
  }
  if (!process.exitCode) {
    process.exitCode = await new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, ['--test', resolve(import.meta.dirname, '../../test/presentation-benchmark.test.mjs')], { stdio: 'inherit' })
      child.on('error', reject); child.on('exit', code => resolveRun(code ?? 1))
    })
  }
} finally { await rm(directory, { recursive: true, force: true }) }

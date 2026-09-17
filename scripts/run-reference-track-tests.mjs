import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const tempDir = await mkdtemp(join(tmpdir(), 'prism-reference-track-tests-'))
const bundledTestPath = join(tempDir, 'reference-tracks.test.mjs')
const entryPoint = join(rootDir, 'test', 'reference-tracks.test.ts')

let exitCode = 1

try {
  await build({
    entryPoints: [entryPoint],
    outfile: bundledTestPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node23',
    sourcemap: 'inline',
  })

  exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', bundledTestPath, join(rootDir, 'test', 'reference-tracks-native.test.mjs')], {
      stdio: 'inherit',
      cwd: rootDir,
    })

    child.on('exit', (code) => {
      resolve(code ?? 1)
    })

    child.on('error', () => {
      resolve(1)
    })
  })
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

process.exit(exitCode)

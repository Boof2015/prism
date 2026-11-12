import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = await mkdtemp(join(tmpdir(), 'prism-scope-tests-'))
let exitCode = 1
try {
  const names = (await readdir(join(root, 'test/visualizers'))).filter(name => name.endsWith('.test.ts'))
  await build({
    entryPoints: names.map(name => join(root, 'test/visualizers', name)),
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node23',
    sourcemap: 'inline',
  })
  const result = spawnSync(process.execPath, ['--test', ...names.map(name => join(temporary, name.replace(/\.ts$/, '.mjs')))], {
    cwd: root, stdio: 'inherit',
  })
  if (result.error) throw result.error
  exitCode = result.status ?? 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
process.exit(exitCode)

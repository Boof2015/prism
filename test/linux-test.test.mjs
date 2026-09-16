import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseOptions, selectSourceFiles, shellQuote } from '../scripts/linux-test.mjs'

test('Linux launcher selects working files including edits and untracked files, excluding deletions and build output', () => {
  const repo = mkdtempSync(join(tmpdir(), 'prism-linux-source-'))
  const put = (path, text) => {
    const target = join(repo, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
  try {
    execFileSync('git', ['init', '-q', repo])
    put('.gitignore', 'node_modules/\nartifacts/\n.env\n')
    put('tracked.txt', 'before')
    put('deleted.txt', 'remove me')
    put('native/build/accidentally-tracked.node', 'Windows binary')
    execFileSync('git', ['add', '.'], { cwd: repo })
    put('tracked.txt', 'unstaged edit')
    unlinkSync(join(repo, 'deleted.txt'))
    put("source with spaces and 'quotes'.txt", 'new source')
    put('node_modules/dependency.js', 'ignore')
    put('artifacts/run.log', 'ignore')
    put('.env', 'ignore')
    assert.deepEqual(selectSourceFiles(repo), ['.gitignore', "source with spaces and 'quotes'.txt", 'tracked.txt'])
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'unstaged edit')
  } finally {
    assert.equal(dirname(resolve(repo)), resolve(tmpdir()))
    rmSync(repo, { recursive: true, force: true })
  }
})

test('Linux launcher rejects invalid targets, suites, hosts and missing arguments before any transfer', () => {
  for (const args of [['--target', 'windows'], ['--suite', 'everything'], ['--host', 'host;id'], ['--distro'], ['--unknown'], ['dry-run']]) {
    assert.throws(() => parseOptions(args))
  }
  assert.equal(parseOptions(['--target', 'fedora', '--host', 'user@192.0.2.1']).target, 'fedora')
  assert.equal(parseOptions([]).suite, 'routine')
})

test('Remote shell quoting keeps punctuation and substitution syntax literal', () => {
  assert.equal(shellQuote("a'b $(id) `id`"), "'a'\\''b $(id) `id`'")
})

test('Linux preparation rejects changed source and restores shell endings and executable modes', { skip: process.platform !== 'linux' }, () => {
  const run = mkdtempSync(join(tmpdir(), 'prism-linux-prepare-'))
  const prepare = fileURLToPath(new URL('../scripts/linux/prepare-source.py', import.meta.url))
  try {
    mkdirSync(join(run, 'source'))
    const original = '#!/bin/sh\r\necho verified\r\n'
    const file = join(run, 'source', 'installer')
    writeFileSync(file, 'changed while archiving')
    writeFileSync(join(run, 'source-manifest.json'), JSON.stringify({ files: [{
      path: 'installer', mode: '100755', sha256: createHash('sha256').update(original).digest('hex'),
    }] }))
    assert.throws(() => execFileSync('python3', [prepare], { cwd: run, stdio: 'pipe' }), /Command failed/)
    writeFileSync(file, original)
    execFileSync('python3', [prepare], { cwd: run, stdio: 'pipe' })
    assert.equal(readFileSync(file, 'utf8'), '#!/bin/sh\necho verified\n')
    assert.equal(statSync(file).mode & 0o777, 0o755)
    const changes = JSON.parse(readFileSync(join(run, 'logs/source-preparation.json'), 'utf8'))
    assert.equal(changes[0].path, 'installer')
  } finally {
    assert.equal(dirname(resolve(run)), resolve(tmpdir()))
    rmSync(run, { recursive: true, force: true })
  }
})

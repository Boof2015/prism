import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const help = `Usage: npm run test:linux -- [options]
  --target wsl|fedora    Default: wsl
  --distro NAME         WSL distribution (default: Ubuntu)
  --host USER@HOST      SSH destination or alias (default: prism-fedora)
  --suite routine|full  Default: routine; full adds plugin tests and packages
  --dry-run             Preview source selection without transferring or running
  --help                Show this help

Runs in a fresh ~/.cache/prism-linux-tests/runs/<id>/source directory.
Local logs: artifacts/linux-tests/<id>/. See docs/linux-testing.md for setup.
`

export function parseOptions(args) {
  const options = { target: 'wsl', distro: 'Ubuntu', host: 'prism-fedora', suite: 'routine' }
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '')
    if ((key === 'help' || key === 'dry-run') && args[i].startsWith('--')) options[key] = true
    else if (['target', 'distro', 'host', 'suite'].includes(key) && args[i].startsWith('--')) {
      const value = args[++i]
      if (!value || value.startsWith('-')) throw new Error(`--${key} requires a value`)
      options[key] = value
    } else throw new Error(`Unknown option: ${args[i]}`)
  }
  if (!['wsl', 'fedora'].includes(options.target)) throw new Error('Target must be wsl or fedora')
  if (!['routine', 'full'].includes(options.suite)) throw new Error('Suite must be routine or full')
  if (!/^[\w.@:[\]-]+$/.test(options.host) || options.host.startsWith('-')) throw new Error('Invalid SSH host')
  return options
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

export function selectSourceFiles(repo) {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean)
  return [...new Set(paths)].filter((path) => {
    // Defense in depth if a generated file has accidentally become tracked.
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(path) ||
        /^(artifacts|out|dist|native\/build|tui\/build|tui\/dist-installer|plugin\/build|plugin\/sdk|plugin\/webview-dist|plugin\/dist-installer)(\/|$)/.test(path)) return false
    const fullPath = join(repo, path)
    if (!existsSync(fullPath)) return false // A tracked deletion must stay deleted.
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) throw new Error(`Source symlinks need explicit handling: ${path}`)
    return stat.isFile()
  }).sort()
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args)
  if (options.help) { console.log(help); return 0 }
  if (options.target === 'wsl' && process.platform !== 'win32') throw new Error('The WSL target must be launched from Windows')
  const files = selectSourceFiles(rootDir)
  if (options['dry-run']) {
    console.log(JSON.stringify({ ...options, sourceRoot: rootDir, fileCount: files.length, files }, null, 2))
    return 0
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.target}-${randomUUID().slice(0, 8)}`
  const logDir = join(rootDir, 'artifacts', 'linux-tests', runId)
  mkdirSync(logDir, { recursive: true })
  const log = createWriteStream(join(logDir, 'runner.log'))
  const result = { runId, ...options, startedAt: new Date().toISOString(), status: 'running', exitCode: null, steps: [] }
  const gitModes = new Map(execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: rootDir, encoding: 'utf8' })
    .split('\0').filter(Boolean).map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry.slice(0, 6)]))
  const source = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim(),
    gitStatus: execFileSync('git', ['status', '--porcelain=v1'], { cwd: rootDir, encoding: 'utf8' }),
    files: files.map((path) => ({ path, mode: gitModes.get(path) ?? '100644', sha256: createHash('sha256').update(readFileSync(join(rootDir, path))).digest('hex') })),
  }
  source.isDirty = source.gitStatus.length > 0
  source.fingerprint = createHash('sha256').update(JSON.stringify(source.files)).digest('hex')
  writeFileSync(join(logDir, 'source-manifest.json'), JSON.stringify(source, null, 2) + '\n')
  writeFileSync(join(logDir, 'files.list'), files.join('\0') + '\0')
  const archive = join(logDir, 'source.tar.gz')
  let remotePath

  async function run(label, command, argv, input) {
    const step = { label, startedAt: new Date().toISOString(), exitCode: null }
    result.steps.push(step)
    const heading = `\n[linux-test] ${label}\n`
    process.stdout.write(heading); log.write(heading)
    step.exitCode = await new Promise((resolveExit) => {
      const child = spawn(command, argv, { cwd: rootDir, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        process.stdout.write(chunk); log.write(chunk)
      })
      child.on('error', (error) => { log.write(error.message + '\n'); console.error(error.message); resolveExit(1) })
      child.on('close', (code) => resolveExit(code ?? 1))
      child.stdin.on('error', () => {}) // Connection failure can close stdin early.
      child.stdin.end(input)
    })
    step.finishedAt = new Date().toISOString()
    log.write(`[linux-test] ${label}: exit ${step.exitCode}\n`)
    if (step.exitCode !== 0) throw Object.assign(new Error(`${label} failed (exit ${step.exitCode})`), { exitCode: step.exitCode })
  }

  function remote(label, script) {
    const command = options.target === 'wsl' ? 'wsl.exe' : 'ssh'
    const argv = options.target === 'wsl'
      ? ['-d', options.distro, '--exec', 'bash', '-s']
      : ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', options.host, 'bash -s']
    return run(label, command, argv, `set -euo pipefail\n${script}\n`)
  }

  try {
    console.log(`Linux test logs: ${logDir}`)
    await run('Archive current working files', 'tar', ['-czf', archive, '--null', '-T', join(logDir, 'files.list'), '--no-recursion'])
    // The fresh directory makes deleted/renamed files and old build outputs unambiguous.
    remotePath = `.cache/prism-linux-tests/runs/${runId}`
    await remote('Create isolated Linux run', `umask 077\nmkdir -p "$HOME/${remotePath}"\ntest ! -e "$HOME/${remotePath}/source"\nmkdir "$HOME/${remotePath}/source"`)
    if (options.target === 'wsl') {
      const linuxArchive = execFileSync('wsl.exe', ['-d', options.distro, '--exec', 'wslpath', '-a', archive], { encoding: 'utf8' }).trim()
      const linuxManifest = execFileSync('wsl.exe', ['-d', options.distro, '--exec', 'wslpath', '-a', join(logDir, 'source-manifest.json')], { encoding: 'utf8' }).trim()
      await remote('Transfer source to WSL', `cp -- ${shellQuote(linuxArchive)} "$HOME/${remotePath}/source.tar.gz"\ncp -- ${shellQuote(linuxManifest)} "$HOME/${remotePath}/source-manifest.json"`)
    } else {
      await run('Transfer source over SSH', 'scp', ['-B', '-o', 'ConnectTimeout=10', archive, join(logDir, 'source-manifest.json'), `${options.host}:${remotePath}/`])
    }
    await remote('Run Linux checks', `cd "$HOME/${remotePath}"\ntar -xzf source.tar.gz -C source\npython3 source/scripts/linux/prepare-source.py\nexport PRISM_GIT_COMMIT=${shellQuote(source.revision)}\nexport PRISM_GIT_DIRTY=${shellQuote(source.isDirty ? '1' : '0')}\nbash source/scripts/linux/run.sh ${shellQuote(options.suite)}`)
    result.status = 'passed'; result.exitCode = 0
  } catch (error) {
    console.error(error.message)
    result.status = 'failed'; result.exitCode = error.exitCode || 1; result.error = error.message
  } finally {
    // Retrieve partial results even if compilation or a test failed.
    if (remotePath) {
      try {
        if (options.target === 'wsl') {
          const linuxLogs = execFileSync('wsl.exe', ['-d', options.distro, '--exec', 'wslpath', '-a', logDir], { encoding: 'utf8' }).trim()
          await remote('Collect Linux logs', `if [[ -d "$HOME/${remotePath}/logs" ]]; then cp -r "$HOME/${remotePath}/logs" ${shellQuote(linuxLogs)}; fi`)
        } else {
          await run('Collect Linux logs', 'scp', ['-B', '-r', '-o', 'ConnectTimeout=10', `${options.host}:${remotePath}/logs`, join(logDir, 'logs')])
        }
      } catch (error) {
        result.collectionError = error.message
        if (result.exitCode === 0) { result.exitCode = 1; result.status = 'failed' }
      }
    }
    result.remoteDirectory = remotePath ? `~/${remotePath}` : null
    result.sourceFingerprint = source.fingerprint
    result.finishedAt = new Date().toISOString()
    writeFileSync(join(logDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    await new Promise((resolveEnd) => log.end(resolveEnd))
    console.log(`\n${result.status.toUpperCase()}: ${logDir}\nLinux files: ${result.remoteDirectory}`)
  }
  return result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}

import { app, contentTracing, powerSaveBlocker, screen, type BrowserWindow } from 'electron'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { recordBenchmarkEnvironment } from './benchmarkEnvironment'

/** Runs only with the explicit benchmark environment, in an isolated userData directory. */
export async function runLatencyBenchmark(window: BrowserWindow): Promise<void> {
  const directory = process.env.PRISM_LATENCY_BENCHMARK_DIR
  if (!directory || process.platform !== 'darwin') throw new Error('Benchmark requires macOS and an output directory')
  const output = resolve(directory)
  const duration = Number(process.env.PRISM_BENCH_DURATION ?? 60)
  const warmup = Number(process.env.PRISM_BENCH_WARMUP ?? 10)
  const repeats = Number(process.env.PRISM_BENCH_REPEATS ?? 3)
  if (![duration, warmup, repeats].every(n => Number.isFinite(n) && n > 0) || repeats > 10 || duration > 120) throw new Error('Invalid benchmark durations')
  const invoke = async (method: string, ...args: unknown[]) => window.webContents.executeJavaScript(
    `window.prismLatencyBenchmark.${method}(...${JSON.stringify(args)})`,
  )
  let player: ChildProcess | null = null
  let tracing = false
  const sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
  const environment = recordBenchmarkEnvironment()
  const stopPlayer = () => { player?.kill('SIGTERM'); player = null }
  const assertWindow = () => {
    if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) throw new Error('Benchmark window was closed, minimized, or hidden')
  }
  try {
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript('Boolean(window.prismLatencyBenchmark)')) break
      if (i === 99) throw new Error('Benchmark renderer interface unavailable; rebuild with PRISM_LATENCY_BENCHMARK=1')
      await delay(100)
    }
    window.setBounds({ width: 1200, height: 360 })
    window.center(); window.show(); window.focus()
    const display = screen.getDisplayMatching(window.getBounds())
    await writeFile(join(output, 'machine.json'), JSON.stringify({
      platform: process.platform, arch: process.arch, os: os.release(), systemVersion: process.getSystemVersion(),
      model: execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(),
      cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), versions: process.versions,
      display, bounds: window.getBounds(), durationSeconds: duration, warmupSeconds: warmup, repeats,
      audioPlayer: '/usr/bin/afplay', signalFile: 'stimulus.wav',
      powerSettings: execFileSync('/usr/bin/pmset', ['-g', 'custom'], { encoding: 'utf8' }),
    }, null, 2))
    const cases = [
      { name: 'spectrum', scopes: ['spectrum'] },
      { name: 'oscilloscope', scopes: ['oscilloscope'] },
      { name: 'default-rack', scopes: ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter'] },
    ]
    const modes = ['baseline', ...Array.from({ length: repeats }, () => 'probe')]
    let run = 0
    for (const target of ['display-sync', 60] as const) {
      for (const config of cases) {
        await invoke('configure', config.scopes, target)
        for (let repeat = 0; repeat < modes.length; repeat++) {
          const mode = modes[repeat]
          const id = `${String(++run).padStart(2, '0')}-${config.name}-${target}-${mode}-${repeat}`
          console.log(`[latency] ${id}: warming up ${warmup}s`)
          let playerError = ''
          player = spawn('/usr/bin/afplay', [join(output, 'stimulus.wav')], { stdio: ['ignore', 'ignore', 'pipe'] })
          player.on('error', error => { playerError = error.message })
          player.stderr?.on('data', data => { playerError += data.toString() })
          await delay(warmup * 1000)
          assertWindow()
          if (playerError || player.exitCode !== null) throw new Error(`Stimulus player failed: ${playerError}`)
          const environmentStart = environment.mark()
          const startMetadata = await invoke('start', mode)
          console.log(`[latency] ${id}: measuring ${duration}s`)
          await delay(duration * 1000)
          assertWindow()
          const result = await invoke('stop')
          const runEnvironment = environment.finishRun(environmentStart)
          if (playerError || player.exitCode !== null) throw new Error(`Stimulus ended during measurement: ${playerError}`)
          stopPlayer()
          await writeFile(join(output, `${id}.json`), JSON.stringify({ id, config: config.name, target, repeat, startMetadata, environment: runEnvironment, ...result }))
          console.log(`[latency] ${id}: saved ${result.records.length} chunk/scope records, ${result.frames.length} frames`)
        }
      }
    }
    // Diagnostic trace is a separate workload and is never pooled into latency claims.
    await invoke('configure', cases[2].scopes, 'display-sync')
    player = spawn('/usr/bin/afplay', [join(output, 'stimulus.wav')], { stdio: 'ignore' })
    await delay(warmup * 1000)
    const categories = await contentTracing.getCategories()
    await writeFile(join(output, 'trace-categories.json'), JSON.stringify(categories, null, 2))
    await contentTracing.startRecording({ included_categories: ['blink.user_timing', 'devtools.timeline', 'cc', 'viz', 'gpu', 'toplevel', 'benchmark'] })
    tracing = true
    const traceEnvironmentStart = environment.mark()
    await invoke('start', 'trace')
    await delay(Math.min(duration, 10) * 1000)
    const traceResult = await invoke('stop')
    await contentTracing.stopRecording(join(output, 'chromium-trace.json'))
    tracing = false
    await writeFile(join(output, 'trace-measurement.json'), JSON.stringify({ ...traceResult, environment: environment.finishRun(traceEnvironmentStart) }))
    stopPlayer()
    await writeFile(join(output, 'thermal.json'), JSON.stringify(environment.stop()))
    await writeFile(join(output, 'complete.json'), JSON.stringify({ completedAt: new Date().toISOString(), runs: run }))
    console.log(`[latency] Complete: ${output}`)
    app.exit(0)
  } catch (error) {
    stopPlayer()
    await writeFile(join(output, 'thermal.json'), JSON.stringify(environment.stop()))
    if (tracing) await contentTracing.stopRecording(join(output, 'interrupted-trace.json')).catch(() => {})
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), at: new Date().toISOString() }, null, 2))
    console.error('[latency]', error)
    app.exit(1)
  } finally {
    if (powerSaveBlocker.isStarted(sleepBlocker)) powerSaveBlocker.stop(sleepBlocker)
  }
}

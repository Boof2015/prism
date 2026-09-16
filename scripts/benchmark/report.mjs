import { build } from 'esbuild'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { linkPresentation } from './presentation.mjs'

const fmt = value => value == null ? '—' : Number(value).toFixed(3)
export async function generateReport(directory) {
  const output = resolve(directory)
  const bundled = join(output, 'analysis.mjs')
  await build({ entryPoints: [resolve(import.meta.dirname, '../../src/renderer/benchmark/analyze.ts')], outfile: bundled,
    bundle: true, platform: 'node', format: 'esm', define: { __PRISM_LATENCY_BENCHMARK__: 'false' } })
  const { analyzeMeasurement, statistics } = await import(`${pathToFileURL(bundled).href}?t=${Date.now()}`)
  const read = async name => JSON.parse(await readFile(join(output, name), 'utf8'))
  const manifest = await read('source-manifest.json')
  const machine = await read('machine.json').catch(() => null)
  const completed = await read('complete.json').catch(() => null)
  const names = (await readdir(output)).filter(name => /^\d+-.*\.json$/.test(name)).sort()
  const results = []
  for (const name of names) {
    const raw = await read(name)
    results.push({ id: raw.id, config: raw.config, target: raw.target, mode: raw.mode, repeat: raw.repeat,
      metadata: raw.metadata, ...analyzeMeasurement(raw) })
  }
  await writeFile(join(output, 'summary.json'), JSON.stringify(results, null, 2))
  const lines = ['# Prism capture-to-render submission benchmark', '',
    `Base: \`${manifest.baseCommit}\` (${manifest.version}); branch: \`${manifest.branch}\`.`,
    `Instrumentation patch SHA-256: \`${manifest.patchSha256}\`.`, '',
    'Endpoint: the existing native timestamp inside the CoreAudio capture callback → return from a successful scope draw invocation that consumed that chunk. Every consumed chunk is counted once per scope. This measures processing and draw-command submission, not physical presentation or the time for a signal change to become visible.', '',
    'Excluded: audio buffering before the native timestamp, GPU execution/compositing, display scanout/pixel response, and the perceptual response of FFT windows, pitch locking, persistence, and meter ballistics. A scope may display selected history after consuming newer audio.', '',
    `Status: ${completed ? 'suite completed' : 'incomplete suite'}${manifest.quick ? '; diagnostic quick run — no publication claim' : ''}.`,
    ...(machine ? [`Machine: ${machine.cpu}, ${machine.model}, macOS ${machine.systemVersion}, ${machine.arch}.`,
      `Window: ${machine.bounds.width}×${machine.bounds.height}; display scale: ${machine.display.scaleFactor}; reported display frequency: ${machine.display.displayFrequency ?? 'unavailable'} Hz.`,
      `Electron ${machine.versions.electron}; Chromium ${machine.versions.chrome}. ${machine.warmupSeconds}s warmup; ${machine.durationSeconds}s measurement; ${machine.repeats} probe repeats.`] : []), '',
    'Complete scope settings, capture device/rate, canvas dimensions, and start/end metadata are in each raw JSON. See machine.json, stimulus.json, source-manifest.json, and benchmark.patch for reproduction.', '',
    '## Per-run results', '',
    '| Run | Scope | Median ms | p95 ms | p99 ms | Max ms | N | Timing ±ms | Observed FPS | Valid |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|']
  for (const r of results.filter(r => r.mode === 'probe')) for (const s of r.scopes) {
    lines.push(`| ${r.id} | ${s.scope} | ${fmt(s.latencyMs.median)} | ${fmt(s.latencyMs.p95)} | ${fmt(s.latencyMs.p99)} | ${fmt(s.latencyMs.max)} | ${s.latencyMs.count} | ${fmt(r.latencyUncertaintyMs)} | ${fmt(s.observedFps)} | ${r.valid ? 'yes' : 'no'} |`)
  }
  lines.push('', '## Stage timings', '',
    '| Run | Scope | Capture → receipt p95 ms | Receipt → consumption p95 ms | Consumption → draw end p95 ms | Unresolved receipt durations |',
    '|---|---|---:|---:|---:|---:|')
  for (const r of results.filter(r => r.mode === 'probe')) for (const s of r.scopes) {
    lines.push(`| ${r.id} | ${s.scope} | ${fmt(s.captureToReceiptMs.p95)} | ${fmt(s.receiptToConsumptionMs.p95)} | ${fmt(s.consumptionToDrawEndMs.p95)} | ${s.unresolvedDelivery} |`)
  }
  lines.push('', 'Stage percentiles are separate distributions and must not be added together. Receipt intervals that overlap clock uncertainty are unresolved and excluded only from the receipt-duration distribution; their capture-to-draw measurements remain subject to the full uncertainty bounds.')
  lines.push('', '## Losses and exclusions', '')
  for (const r of results) lines.push(`- ${r.id}: ${r.problems.join('; ') || 'no validity failures'}. ${r.mode === 'baseline' ? 'Chunk probes disabled; chunk-loss counters unavailable.' : `Counters: ${JSON.stringify(r.counters)}. Pending at stop: ${r.scopes.map(s => `${s.scope}=${s.unconsumedAtStop}`).join(', ')}.`}`)
  lines.push('', 'Boundary chunks were queued before observation began and are reported separately; chunks still queued at stop are right-censored. Neither is treated as a successful low-latency sample. Skipped draws, unexplained losses, duplicate consumption, and invalid clock ordering invalidate that run for a claim.', '',
    '## Probe overhead comparison', '',
    'Baseline disables capture/chunk probes but retains the same minimal frame-duration recorder. Differences below are observed workload differences, not a precise causal overhead correction; run order and system load can also affect them. No overhead is subtracted from latency.', '',
    '| Configuration / target | Scope | Baseline draw p95 ms | Probe draw p95 range ms | Baseline FPS | Probe FPS range |',
    '|---|---|---:|---|---:|---|')
  for (const b of results.filter(r => r.mode === 'baseline')) for (const bs of b.scopes) {
    const probes = results.filter(r => r.mode === 'probe' && r.config === b.config && r.target === b.target).map(r => r.scopes.find(s => s.scope === bs.scope)).filter(Boolean)
    if (!probes.length) continue
    const range = values => `${fmt(Math.min(...values))}–${fmt(Math.max(...values))}`
    lines.push(`| ${b.config} / ${b.target} | ${bs.scope} | ${fmt(bs.frameWorkMs.p95)} | ${range(probes.map(s => s.frameWorkMs.p95))} | ${fmt(bs.observedFps)} | ${range(probes.map(s => s.observedFps))} |`)
  }
  lines.push('', '## Supported wording', '')
  let claims = 0
  if (!manifest.quick && completed) {
    for (const config of ['spectrum', 'oscilloscope', 'default-rack']) for (const target of ['display-sync', 60]) {
      const runs = results.filter(r => r.config === config && r.target === target && r.mode === 'probe')
      if (runs.length !== 3 || runs.some(r => !r.valid || r.durationMs < 59900)) continue
      for (const scope of runs[0].scopes.map(s => s.scope)) {
        const samples = runs.map(r => r.scopes.find(s => s.scope === scope))
        const p95 = Math.max(...samples.map(s => s.latencyMs.p95))
        const p95Upper = Math.max(...samples.map(s => s.upperLatencyMs.p95))
        const median = Math.max(...samples.map(s => s.latencyMs.median))
        const uncertainty = Math.max(...runs.map(r => r.latencyUncertaintyMs))
        lines.push(`- On ${machine.cpu} / macOS ${machine.systemVersion}, an instrumented build of Prism ${manifest.version} based on ${manifest.baseCommit.slice(0, 7)} measured at most ${fmt(median)} ms median and ${fmt(p95)} ms p95 across three 60-second runs for **${scope}**, using **${config}, ${target} target**, native system capture at ${runs[0].metadata.capture.sampleRate} Hz. Timing uncertainty was at most ±${fmt(uncertainty)} ms. ${p95Upper < 8 ? 'All three observed p95 upper bounds were below 8 ms.' : 'These results do not support an under-8-ms p95 claim.'}`)
        claims++
      }
    }
  }
  if (!claims) lines.push('No publication-ready latency claim is supported by this dataset. See validity failures and suite status above.')
  lines.push('', 'These statements apply only to the tested configuration and instrumentation patch. Observed maxima are not guaranteed bounds. No claim of capture-to-physical-display latency is made.', '',
    '## Presentation investigation', '',
    'Presentation latency: **unavailable unless separately established from an unambiguous chunk/frame/presentation association**. The separate chromium-trace.json and trace-measurement.json contain scope frame markers and Chromium events; their mere proximity is not a valid association. Presentation feedback may itself be estimated on macOS. No nominal refresh interval is added to manufacture an end-to-end result.', '',
    '## Clock method', '',
    '64 synchronous native-clock calls are bracketed by performance.now() before and after each run. The narrowest round-trip bracket at each endpoint is selected, then their union bounds the offset used for the run. This assumes no unobserved clock excursion between endpoints. Calibration bounds include the measured renderer timer quantum (at least 0.1 ms), and draw-end uncertainty includes an additional quantum. The midpoint supplies reported estimates; conservative p95 checks use the older possible capture time and later possible draw time. Receipt durations below timer resolution are counted as unresolved, never clamped or presented as zero latency. Complete calibration samples and endpoint drift are exported.', '')
  try {
    const traceRaw = await read('trace-measurement.json')
    const trace = await read('chromium-trace.json')
    const traceAnalysis = analyzeMeasurement(traceRaw)
    const presentation = linkPresentation(trace.traceEvents, traceRaw, traceAnalysis.clock)
    await writeFile(join(output, 'presentation-investigation.json'), JSON.stringify({ ...presentation, traceValidity: traceAnalysis.problems }, null, 2))
    lines.push('## Separate trace findings', '',
      `Matched ${presentation.matchedFrames} scope frames and ${presentation.matchedChunkScopeRecords}/${presentation.successfulChunkScopeRecords} successful chunk/scope records; ${presentation.rejectedFrames} frame associations were rejected.`,
      'Associations require unique scope markers inside one RAF task and one AnimationFrame interval, exact animation/presentation IDs, matching begin-frame source/sequence IDs, and a STATE_PRESENTED_ALL compositor reporter.', '')
    if (presentation.available && traceAnalysis.valid) {
      lines.push('| Scope | Estimated capture → presentation median ms | Estimated p95 ms | Matched records |', '|---|---:|---:|---:|')
      for (const scope of traceRaw.metadata.visibleScopes) {
        const stats = statistics(presentation.samples.filter(s => s.scope === scope).map(s => s.latencyMs))
        lines.push(`| ${scope} | ${fmt(stats.median)} | ${fmt(stats.p95)} | ${stats.count} |`)
      }
      lines.push('', `Software timestamp uncertainty is approximately ±${fmt(presentation.softwareTimingUncertaintyMs)} ms, **plus unquantified macOS presentation-estimation error**. These are diagnostic estimates from the separate tracing workload, not physical display measurements or publication claims.`)
    } else lines.push(`Presentation estimate unavailable: ${traceAnalysis.problems.join('; ') || 'no unambiguous associations'}.`)
  } catch (error) {
    lines.push('## Separate trace findings', '', `Presentation estimate unavailable: ${String(error)}.`)
  }
  await writeFile(join(output, 'REPORT.md'), lines.join('\n'))
  console.log(`Report: ${join(output, 'REPORT.md')}`)
  return results
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (!process.argv[2]) throw new Error('Usage: npm run bench:latency:report -- benchmark-results/<run>')
  await generateReport(process.argv[2])
}

import { readFile } from 'node:fs/promises'
const { results } = JSON.parse(await readFile(process.argv[2], 'utf8'))
const cases = new Map()
for (const result of results) {
  const id = result.id.replace(/-r\d+$/, '')
  if (!cases.has(id)) cases.set(id, { baseline: [], changed: [] })
  cases.get(id)[result.variant === 'baseline' ? 'baseline' : 'changed'].push(result)
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length
for (const [id, trials] of cases) {
  const baseline = trials.baseline.filter(r => trials.changed.some(c => c.id === r.id))
  const changed = trials.changed.filter(r => trials.baseline.some(b => b.id === r.id))
  if (!baseline.length || !changed.length) continue
  const before = mean(baseline.map(r => r.cpuMsPerSecond)), after = mean(changed.map(r => r.cpuMsPerSecond))
  console.log(JSON.stringify({ case: id, pairs: Math.min(baseline.length, changed.length),
    pairsMeetingFrameTarget: baseline.filter(b => {
      const c = changed.find(c => c.id === b.id)
      return b.count * 1000 / b.elapsed >= b.config.fps * 0.98 && c.count * 1000 / c.elapsed >= c.config.fps * 0.98
    }).length,
    baselineCpuMsPerSecond: +before.toFixed(1), optimizedCpuMsPerSecond: +after.toFixed(1), reductionPercent: +(100 * (1 - after / before)).toFixed(1),
    baselineTrials: baseline.map(r => +r.cpuMsPerSecond.toFixed(1)), optimizedTrials: changed.map(r => +r.cpuMsPerSecond.toFixed(1)),
    pairedReductionPercent: baseline.map(b => +(100 * (1 - changed.find(c => c.id === b.id).cpuMsPerSecond / b.cpuMsPerSecond)).toFixed(1)),
    baselineFramesPerSecond: +mean(baseline.map(r => r.count * 1000 / r.elapsed)).toFixed(1),
    optimizedFramesPerSecond: +mean(changed.map(r => r.count * 1000 / r.elapsed)).toFixed(1),
    baselineP95FrameMs: +mean(baseline.map(r => r.p95FrameMs)).toFixed(2),
    optimizedP95FrameMs: +mean(changed.map(r => r.p95FrameMs)).toFixed(2),
    baselineP95DrawMs: +mean(baseline.map(r => r.p95DrawMs)).toFixed(2), optimizedP95DrawMs: +mean(changed.map(r => r.p95DrawMs)).toFixed(2),
    baselineWorkingSetMB: +mean(baseline.map(r => r.workingSetMB)).toFixed(1), optimizedWorkingSetMB: +mean(changed.map(r => r.workingSetMB)).toFixed(1),
  }))
}

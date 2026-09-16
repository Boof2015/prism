const { app, powerMonitor, powerSaveBlocker } = require('electron')
const { writeFile } = require('node:fs/promises')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const userData = join(process.env.PRISM_LATENCY_BENCHMARK_DIR, 'cooldown-user-data')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.whenReady().then(async () => {
  app.dock?.hide()
  const blocker = powerSaveBlocker.start('prevent-display-sleep')
  const quick = process.env.PRISM_BENCH_DURATION === '3'
  const minimumSeconds = quick ? 0 : 120
  const requiredNominalSeconds = quick ? 0 : 60
  const start = performance.now(), samples = []
  let nominalSince = null, success = false
  console.log(`[latency] Post-build cooldown: at least ${minimumSeconds}s, including ${requiredNominalSeconds}s continuously nominal; maximum 10 minutes.`)
  while (true) {
    const now = performance.now(), elapsedSeconds = (now - start) / 1000
    const thermalState = powerMonitor.getCurrentThermalState()
    samples.push({ elapsedSeconds, thermalState, onBattery: powerMonitor.isOnBatteryPower() })
    nominalSince = thermalState === 'nominal' ? nominalSince ?? now : null
    if (quick || (elapsedSeconds >= minimumSeconds && nominalSince !== null && now - nominalSince >= requiredNominalSeconds * 1000)) { success = true; break }
    if (elapsedSeconds >= 600) break
    await delay(1000)
  }
  await writeFile(join(process.env.PRISM_LATENCY_BENCHMARK_DIR, 'cooldown.json'), JSON.stringify({ success, minimumSeconds, requiredNominalSeconds, samples }, null, 2))
  powerSaveBlocker.stop(blocker)
  console.log(success ? '[latency] Cooldown complete.' : '[latency] Nominal thermal state was not sustained; measurement was not started.')
  app.exit(success ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })

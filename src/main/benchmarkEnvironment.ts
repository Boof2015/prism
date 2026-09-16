import { powerMonitor } from 'electron'

/** Main-process-only observer. No per-frame polling, logging, or file writes. */
export function recordBenchmarkEnvironment() {
  const states = ['unknown', 'nominal', 'fair', 'serious', 'critical']
  const columns = ['mainMonotonicMs', 'unixMs', 'thermalState', 'onBattery', 'cpuSpeedLimitPercent', 'reason']
  const reasons = ['sample', 'thermal-change', 'speed-limit-change', 'power-change', 'boundary']
  const width = columns.length
  const data = new Float64Array(8192 * width)
  let count = 0, overflow = 0, speedLimit = Number.NaN
  const sample = (reason = 0) => {
    if (count >= data.length / width) { overflow++; return }
    const offset = count++ * width
    data[offset] = performance.now()
    data[offset + 1] = Date.now()
    data[offset + 2] = states.indexOf(powerMonitor.getCurrentThermalState())
    data[offset + 3] = Number(powerMonitor.isOnBatteryPower())
    data[offset + 4] = speedLimit
    data[offset + 5] = reason
  }
  const thermal = () => sample(1)
  const speed = ({ limit }: { limit: number }) => { speedLimit = limit; sample(2) }
  const power = () => sample(3)
  powerMonitor.on('thermal-state-change', thermal)
  powerMonitor.on('speed-limit-change', speed)
  powerMonitor.on('on-ac', power)
  powerMonitor.on('on-battery', power)
  const timer = setInterval(sample, 1000)
  sample()
  const exportSince = (first = 0) => {
    const samples = Array.from({ length: count - first }, (_, i) => Array.from(data.subarray((first + i) * width, (first + i + 1) * width)))
    const limits = samples.map(row => row[4]).filter(Number.isFinite)
    return { columns, states, reasons, samples, overflow,
      thermalStates: [...new Set(samples.map(row => states[row[2]] ?? 'unknown'))],
      batteryObserved: samples.some(row => row[3] === 1),
      minimumReportedCpuSpeedLimitPercent: limits.length ? Math.min(...limits) : null,
      note: '1 Hz snapshots plus OS notifications; CPU speed limit is unknown until a notification arrives. Nominal thermal state does not prove an absence of all clock-frequency changes. No temperature or causal latency correction is inferred.' }
  }
  return {
    mark: () => { const first = count; sample(4); return first },
    finishRun: (first: number) => { sample(4); return exportSince(first) },
    stop: () => {
      clearInterval(timer)
      powerMonitor.removeListener('thermal-state-change', thermal)
      powerMonitor.removeListener('speed-limit-change', speed)
      powerMonitor.removeListener('on-ac', power)
      powerMonitor.removeListener('on-battery', power)
      sample(4)
      return exportSince()
    },
  }
}

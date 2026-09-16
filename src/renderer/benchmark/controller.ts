import { audioCapture } from '../audio/AudioCapture'
import { audioRouter } from '../audio/AudioRouter'
import { isNativeAvailable } from '../audio/native'
import { useAudioStore } from '../stores/audioStore'
import { useSettingsStore } from '../stores/settingsStore'
import { usePerformanceStore } from '../stores/performanceStore'
import { createDefaultProfile } from '../../shared/profileState'
import { SCOPE_KINDS } from '../../types/scope'
import { BENCHMARK_BUILD, calibrateClock, measureTimerQuantum, latencyProbe, type BenchScope, type ClockSample, type ProbeMode } from './latencyProbe'

export function installLatencyBenchmark(): void {
  if (!BENCHMARK_BUILD || !latencyProbe) return
  const probe = latencyProbe
  let clockStart: ClockSample[] = []
  let timerQuantumStart = 0
  let routerStart = audioRouter.getDiagnosticsSnapshot()
  let hiddenEvents = 0
  document.addEventListener('visibilitychange', () => { if (probe.active) hiddenEvents++ })
  const metadata = () => ({
    capture: audioCapture.getStatus(), session: audioRouter.getSessionState(),
    frameTarget: usePerformanceStore.getState().frameTarget,
    scopeSettings: useSettingsStore.getState().scopeSettings,
    visibleScopes: useSettingsStore.getState().visibleScopes(),
    pixelRatio: devicePixelRatio, innerWidth, innerHeight, hidden: document.hidden,
    canvases: [...document.querySelectorAll('canvas')].map(canvas => ({
      width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
    })),
  })
  const readNative = () => {
    const api = window.nativeCaptureAPI?.macosCapture
    if (!api) throw new Error('Native macOS capture API unavailable')
    return api.nowMilliseconds()
  }
  window.prismLatencyBenchmark = {
    async configure(scopes: BenchScope[], frameTarget: 60 | 'display-sync') {
      if (probe.active) throw new Error('Cannot configure during a measurement')
      if (!isNativeAvailable() || !window.nativeCaptureAPI?.macosCapture?.getSupport().available
          || scopes.some(scope => !window.visualizerAPI?.[scope])) {
        throw new Error('Benchmark requires the native capture and every selected native DSP module; fallback measurements are forbidden')
      }
      const profile = createDefaultProfile()
      useSettingsStore.setState({ ...profile, hiddenScopes: new Set(SCOPE_KINDS.filter(s => !scopes.includes(s as BenchScope))) })
      usePerformanceStore.getState().setFrameTarget(frameTarget)
      useAudioStore.getState().setRollingCaptureSeconds(null)
      useAudioStore.getState().setInputGain(0)
      if (!audioCapture.getStatus().isCapturing) {
        useAudioStore.getState().setCaptureMode('system')
        await useAudioStore.getState().startCapture()
      }
      const status = audioCapture.getStatus()
      if (!status.isCapturing || status.activeBackendKind !== 'native-macos') {
        throw new Error(`Benchmark requires native macOS system capture: ${JSON.stringify(status)}`)
      }
      return metadata()
    },
    start(mode: ProbeMode) {
      if (document.hidden) throw new Error('Benchmark window must be visible')
      timerQuantumStart = measureTimerQuantum()
      clockStart = calibrateClock(readNative)
      routerStart = audioRouter.getDiagnosticsSnapshot()
      hiddenEvents = 0
      probe.start(mode, audioRouter.getSessionState().sessionId)
      return metadata()
    },
    stop() {
      probe.stop()
      const clockEnd = calibrateClock(readNative)
      const timerQuantumMs = Math.max(timerQuantumStart, measureTimerQuantum())
      const routerEnd = audioRouter.getDiagnosticsSnapshot()
      return { ...probe.export(), clockStart, clockEnd, timerQuantumMs, routerStart, routerEnd, hiddenEvents, metadata: metadata() }
    },
    metadata,
  }
}

declare global {
  interface Window {
    prismLatencyBenchmark?: {
      configure: (scopes: BenchScope[], frameTarget: 60 | 'display-sync') => Promise<unknown>
      start: (mode: ProbeMode) => unknown
      stop: () => unknown
      metadata: () => unknown
    }
  }
}

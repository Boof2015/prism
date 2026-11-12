// Browser-only QA fixture. Bundled against either the baseline or current sources.
import { SpectrumAnalyzer } from 'scope-source/renderer/visualizers/SpectrumAnalyzer'
import { Oscilloscope } from 'scope-source/renderer/visualizers/Oscilloscope'
import { Spectrogram } from 'scope-source/renderer/visualizers/Spectrogram'
import { Waveform } from 'scope-source/renderer/visualizers/Waveform'
import { Vectorscope } from 'scope-source/renderer/visualizers/Vectorscope'
import { VUMeter } from 'scope-source/renderer/visualizers/VUMeter'
import { LUFSMeter } from 'scope-source/renderer/visualizers/LUFSMeter'
import { BridgeVUMeterAnalyzer } from 'scope-source/plugin-ui/BridgeVUMeterAnalyzer'
import { BridgeLUFSMeterAnalyzer } from 'scope-source/plugin-ui/BridgeLUFSMeterAnalyzer'
import { BridgeVectorscopeAnalyzer } from 'scope-source/plugin-ui/BridgeVectorscopeAnalyzer'
import { BridgeSpectrumAnalyzer } from 'scope-source/plugin-ui/BridgeSpectrumAnalyzer'
import { BridgeSpectrogramAnalyzer } from 'scope-source/plugin-ui/BridgeSpectrogramAnalyzer'
import { BridgeWaveformAnalyzer } from 'scope-source/plugin-ui/BridgeWaveformAnalyzer'
import { BridgeOscilloscopeAnalyzer } from 'scope-source/plugin-ui/BridgeOscilloscopeAnalyzer'
import { REFERENCE_FFT_SIZES, encodeReferencePower } from 'scope-source/types/spectrumReference'

const host = window as any
const config = host.scopeRunConfig
const constructors = { spectrum: SpectrumAnalyzer, oscilloscope: Oscilloscope, spectrogram: Spectrogram,
  waveform: Waveform, vectorscope: Vectorscope, vumeter: VUMeter, lufsmeter: LUFSMeter }
const bridges = { spectrum: BridgeSpectrumAnalyzer, oscilloscope: BridgeOscilloscopeAnalyzer,
  spectrogram: BridgeSpectrogramAnalyzer, waveform: BridgeWaveformAnalyzer, vectorscope: BridgeVectorscopeAnalyzer,
  vumeter: BridgeVUMeterAnalyzer, lufsmeter: BridgeLUFSMeterAnalyzer }
let frame = 0, playing = true
const rate = config.sampleRate ?? 48000
const count = Math.floor(rate / config.fps)
const pcm = [new Float32Array(rate * 8), new Float32Array(rate * 8)]
for (let i = 0; i < pcm[0].length; i++) {
  const envelope = 0.35 + 0.2 * Math.sin(i / rate * 2)
  pcm[0][i] = envelope * (Math.sin(i * 2 * Math.PI * 173 / rate) + 0.2 * Math.sin(i * 2 * Math.PI * 5311 / rate))
  pcm[1][i] = envelope * (Math.sin(i * 2 * Math.PI * 173 / rate + 0.4) + 0.2 * Math.sin(i * 2 * Math.PI * 3901 / rate))
}
if (config.mode === 'visual') Object.defineProperty(performance, 'now', { value: () => 100000 + frame * 1000 / config.fps })
Object.defineProperty(window, 'devicePixelRatio', { value: config.dpr })
if (config.forceCanvas) {
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    return kind === 'webgl2' ? null : getContext.call(this, kind, ...args)
  } as any
}
const records: any[] = []
const callbacks = new Set<() => void>()
const scheduler = { subscribe(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback) } }
let chunk: any
function makeChunk() {
  const offset = (frame * count) % (pcm[0].length - count)
  chunk = { left: pcm[0].subarray(offset, offset + count), right: pcm[1].subarray(offset, offset + count),
    transport: { sequence: frame, timeInSamples: frame * count, ppqPosition: frame * count / rate * 2,
      bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, isPlaying: playing, isLooping: false, isRecording: false } }
}
makeChunk()
const dataSource = {
  getSampleRate: () => rate, isPlaying: () => playing, getBackendKind: () => 'daw-bridge',
  subscribeToSessionChanges: () => () => {},
  getPendingSpectrumSamples: () => [chunk.left], getPendingSpectrumStereoSamples: () => [chunk],
  getPendingOscilloscopeSamples: () => [chunk.left], getPendingSpectrogramSamples: () => [chunk.left],
  getPendingSpectrogramStereoSamples: config.transport === 'bridge' ? undefined : () => [chunk],
  getPendingWaveformSamples: () => [chunk.left], getPendingWaveformStereoSamples: () => [chunk],
  getPendingWaveformAnnotatedSamples: () => [chunk], getPendingVectorscopeSamples: () => [chunk],
  getPendingVUMeterSamples: () => [chunk], getPendingLUFSMeterSamples: () => [chunk],
}
function reference(view: string) {
  return { asset: { version: 1, id: 'qa', name: 'QA reference', sampleRate: 48000, sourceNyquistHz: 18000,
    durationSeconds: 10, meanSquare: 0.001, curves: Object.fromEntries(REFERENCE_FFT_SIZES.map(size =>
      [size, encodeReferencePower(new Float32Array(size / 2).fill(0.001))])) }, trimDb: 2, view }
}
function resize(record: any, width: number, height: number) {
  record.canvas.width = width * config.dpr; record.canvas.height = height * config.dpr
  record.canvas.style.width = `${width}px`; record.canvas.style.height = `${height}px`
  record.scope?.resize()
}
for (const kind of config.scopes) {
  const canvas = document.createElement('canvas')
  canvas.style.display = 'inline-block'
  document.body.appendChild(canvas)
  const record: any = { kind, canvas }
  resize(record, config.width, config.height)
  const options: any = { dataSource, frameScheduler: scheduler, backgroundColor: config.background ?? 'transparent',
    ...(kind === 'spectrum' ? { heatmapFill: config.heatmap ?? true, showSideLine: true, capturePeakInfo: true,
      reference: config.reference ? reference(config.reference) : null } : {}),
    ...(kind === 'spectrogram' ? { fftSize: 2048, scrollSpeed: 4, orientation: config.orientation ?? 'horizontal', colorScheme: config.colorScheme ?? 'heat' } : {}),
    ...(kind === 'waveform' ? { mode: config.waveformMode ?? 'stereo', scrollSpeed: 4, multiband: config.waveformMultiband ?? true } : {}),
    ...(kind === 'vectorscope' ? { multiband: config.multiband ?? true, mode: config.projection ?? 'lissajous', persistence: config.persistence ?? 0.1 } : {}),
    ...(kind === 'oscilloscope' ? { underfillEnabled: true, underfillColor: 'rgba(56, 189, 248, 0.2)' } : {}),
    ...(kind === 'vumeter' ? { mode: config.vuMode ?? 'needle', needleChannels: config.needleChannels ?? 'stereo' } : {}),
    ...(kind === 'lufsmeter' ? { readout: config.readout ?? 'shortTerm' } : {}),
  }
  if (config.transport === 'bridge' || (config.mode === 'visual' && ['vumeter', 'lufsmeter'].includes(kind))) {
    record.bridge = new bridges[kind]()
    options.nativeAnalyzer = record.bridge
  } else if (config.fallback && ['waveform', 'vectorscope'].includes(kind)) options.nativeAnalyzer = null
  record.scope = new constructors[kind](canvas, options)
  record.scope.start()
  records.push(record)
}
const snapshot = { vuLDb: -19, vuRDb: -17, barLDb: -12, barRDb: -9, peakLDb: -8, peakRDb: -6,
  momentaryLUFS: -16.4, shortTermLUFS: -15.3, integratedLUFS: -14.8, truePeakLDb: -5, truePeakRDb: -3,
  maxTruePeakDb: -2.4, correlation: 0.64 }
function feedBridge(record: any) {
  const b = record.bridge
  if (!b) return
  switch (record.kind) {
    case 'vumeter': case 'lufsmeter': b.setSnapshot(snapshot); break
    case 'vectorscope': {
      const points = 4096, data = new Float32Array(points * 6), x = new Float32Array(points), y = new Float32Array(points)
      for (let i = 0; i < points; i++) {
        const n = (frame * count + i) % pcm[0].length
        x[i] = pcm[1][n]; y[i] = pcm[0][n]
        for (let band = 0; band < 3; band++) {
          data[i * 6 + band * 2] = y[i] * (1 - band * 0.25)
          data[i * 6 + band * 2 + 1] = x[i] * (1 - band * 0.25)
        }
      }
      b.setStandard(x, y, points); b.setMultiband(data, points); break
    }
    case 'spectrum': {
      const values = Float32Array.from({ length: 1024 }, (_, i) => -80 + 55 * Math.exp(-(((i - 80 - 20 * Math.sin(frame / 30)) / 40) ** 2)))
      b.setMagnitudes(values, values.map(v => v - 6), values.map(v => v + 3))
      b.setReferenceLevel(0.001, 10); break
    }
    case 'spectrogram': {
      const rows = b.getExpectedRowCount(), columns = 3 + frame % 2
      const values = Float32Array.from({ length: rows * columns }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.03 + frame * 0.07))
      b.pushFrame(values, values, columns, rows); break
    }
    case 'waveform': {
      const stereo = (config.waveformMode ?? 'stereo') === 'stereo', columns = 3 + frame % 2
      const values = Float32Array.from({ length: columns * (stereo ? 10 : 5) }, (_, i) => i % 5 === 0 ? -0.5 : i % 5 === 1 ? 0.5 : 0.2)
      b.pushFrame(values, stereo); break
    }
    case 'oscilloscope': b.setSamples(chunk.left, 173); break
  }
}
function tick() {
  makeChunk()
  for (const record of records) feedBridge(record)
  for (const callback of [...callbacks]) callback()
  frame++
}
function base64(bytes: Uint8ClampedArray) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
  return btoa(binary)
}
function state() {
  return { frames: frame, dpr: config.dpr, gpu: records.map(r => Boolean(r.scope.gpuRenderer)),
    glErrors: records.map(r => r.scope.gpuRenderer ? r.scope.gpuRenderer.canvas.getContext('webgl2').getError() : 0) }
}
function dispose() {
  for (const r of records) r.scope.dispose()
  if (callbacks.size) throw new Error('Scope callbacks leaked after disposal')
}
host.scopeFixture = { tick, state, dispose }
host.scopeReady = (async () => {
  await document.fonts.ready
  for (const weight of [400, 500, 600, 700]) await document.fonts.load(`${weight} 12px "JetBrains Mono"`)
  if (config.mode !== 'visual') return
  for (let i = 0; i < 180; i++) tick()
  if (config.transition === 'resize') {
    for (const r of records) resize(r, Math.max(64, config.width - 70), config.height + 20)
  } else if (config.transition === 'theme') {
    for (const r of records) r.scope.setOptions({ lineColor: '#ff477e', underfillColor: 'rgba(220, 30, 70, 0.3)', heatColors: ['#010203', '#456789', '#fedcba'], bandColors: { low: '#dd1144', mid: '#33bb66', high: '#5599ff' } })
  } else if (config.transition === 'reset') {
    for (const r of records) (r.scope.resetDisplay ?? r.scope.resetState)?.call(r.scope)
  } else if (config.transition === 'pause') playing = false
  else if (config.transition === 'loss') {
    for (const r of records) r.scope.gpuRenderer?.canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
    await new Promise(resolve => setTimeout(resolve, 40))
    // Context loss loses GPU pixels. Reset both histories before comparing fresh rendering.
    for (const r of records) r.scope.resetDisplay?.()
  } else if (config.transition === 'ordinary') {
    for (const r of records) r.scope.setOptions({ multiband: false })
  }
  for (let i = 0; i < 50; i++) { for (const r of records) r.scope.invalidate(); tick() }
  const result = { ...state(), captures: records.map(r => ({ kind: r.kind, width: r.canvas.width, height: r.canvas.height,
    rgba: base64(r.canvas.getContext('2d').getImageData(0, 0, r.canvas.width, r.canvas.height).data), png: r.canvas.toDataURL() })) }
  dispose()
  return result
})()

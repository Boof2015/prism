import { oscilloscope, spectrum, vectorscope, isNativeAvailable } from './native'
import type { VisualizerConsumerDemand } from './AudioRouter'

export interface NativeVisualizerTransportSessionState {
  sessionId: number
  sampleRate: number
  channelCount: number
  capturing: boolean
}

export interface NativeVisualizerTransportBridge {
  isAvailable: () => boolean
  oscilloscope: {
    setSampleRate: (sampleRate: number) => void
    pushSamples: (samples: Float32Array) => void
    reset: () => void
  }
  spectrum: {
    setSampleRate: (sampleRate: number) => void
    pushSamples: (samples: Float32Array) => void
    fillMagnitudes: (output: Float32Array) => number
    reset: () => void
  }
  vectorscope: {
    setSampleRate: (sampleRate: number) => void
    pushSamples: (left: Float32Array, right: Float32Array) => void
    reset: () => void
  }
}

const EMPTY_DEMAND: Required<VisualizerConsumerDemand> = {
  spectrum: false,
  oscilloscope: false,
  vectorscope: false,
  spectrogram: false,
  vumeter: false,
  lufsmeter: false,
  waveform: false,
}

const defaultBridge: NativeVisualizerTransportBridge = {
  isAvailable: () => isNativeAvailable(),
  oscilloscope: {
    setSampleRate: (sampleRate) => oscilloscope.setSampleRate(sampleRate),
    pushSamples: (samples) => oscilloscope.pushSamples(samples),
    reset: () => oscilloscope.reset(),
  },
  spectrum: {
    setSampleRate: (sampleRate) => spectrum.setSampleRate(sampleRate),
    pushSamples: (samples) => spectrum.pushSamples(samples),
    fillMagnitudes: (output) => spectrum.fillMagnitudes(output),
    reset: () => spectrum.reset(),
  },
  vectorscope: {
    setSampleRate: (sampleRate) => vectorscope.setSampleRate(sampleRate),
    pushSamples: (left, right) => vectorscope.pushSamples(left, right),
    reset: () => vectorscope.reset(),
  },
}

function normalizeDemand(demand: VisualizerConsumerDemand): Required<VisualizerConsumerDemand> {
  return {
    spectrum: Boolean(demand.spectrum),
    oscilloscope: Boolean(demand.oscilloscope),
    vectorscope: Boolean(demand.vectorscope),
    spectrogram: Boolean(demand.spectrogram),
    vumeter: Boolean(demand.vumeter),
    lufsmeter: Boolean(demand.lufsmeter),
    waveform: Boolean(demand.waveform),
  }
}

export class NativeVisualizerTransport {
  private readonly bridge: NativeVisualizerTransportBridge
  private demand: Required<VisualizerConsumerDemand> = { ...EMPTY_DEMAND }
  private sampleRate = 48000
  private activeSessionId: number | null = null
  private capturing = false

  constructor(bridge: NativeVisualizerTransportBridge = defaultBridge) {
    this.bridge = bridge
  }

  setDemand(demand: VisualizerConsumerDemand): void {
    const nextDemand = normalizeDemand(demand)
    if (
      nextDemand.spectrum === this.demand.spectrum
      && nextDemand.oscilloscope === this.demand.oscilloscope
      && nextDemand.vectorscope === this.demand.vectorscope
      && nextDemand.spectrogram === this.demand.spectrogram
      && nextDemand.vumeter === this.demand.vumeter
      && nextDemand.lufsmeter === this.demand.lufsmeter
      && nextDemand.waveform === this.demand.waveform
    ) {
      return
    }

    if (this.bridge.isAvailable()) {
      if (this.demand.oscilloscope && !nextDemand.oscilloscope) {
        this.bridge.oscilloscope.reset()
      }
      if (this.demand.spectrum && !nextDemand.spectrum) {
        this.bridge.spectrum.reset()
      }
      if (this.demand.vectorscope && !nextDemand.vectorscope) {
        this.bridge.vectorscope.reset()
      }
      if (!this.demand.oscilloscope && nextDemand.oscilloscope) {
        this.bridge.oscilloscope.setSampleRate(this.sampleRate)
      }
      if (!this.demand.spectrum && nextDemand.spectrum) {
        this.bridge.spectrum.setSampleRate(this.sampleRate)
      }
      if (!this.demand.vectorscope && nextDemand.vectorscope) {
        this.bridge.vectorscope.setSampleRate(this.sampleRate)
      }
    }

    this.demand = nextDemand
  }

  reset(sessionState: NativeVisualizerTransportSessionState): void {
    this.sampleRate = Math.max(1, Math.floor(sessionState.sampleRate) || 1)
    this.activeSessionId = sessionState.sessionId
    this.capturing = sessionState.capturing

    if (!this.bridge.isAvailable()) {
      return
    }

    this.bridge.oscilloscope.reset()
    this.bridge.spectrum.reset()
    this.bridge.vectorscope.reset()

    if (!sessionState.capturing) {
      return
    }

    if (this.demand.oscilloscope) {
      this.bridge.oscilloscope.setSampleRate(this.sampleRate)
    }
    if (this.demand.spectrum) {
      this.bridge.spectrum.setSampleRate(this.sampleRate)
    }
    if (this.demand.vectorscope) {
      this.bridge.vectorscope.setSampleRate(this.sampleRate)
    }
  }

  handleChunk(
    left: Float32Array,
    right: Float32Array,
    sessionState: Pick<NativeVisualizerTransportSessionState, 'sessionId' | 'channelCount'>,
  ): void {
    if (!this.bridge.isAvailable() || !this.capturing) {
      return
    }
    if (this.activeSessionId === null || sessionState.sessionId !== this.activeSessionId) {
      return
    }

    if (this.demand.oscilloscope) {
      this.bridge.oscilloscope.pushSamples(left)
    }

    if (this.demand.spectrum) {
      this.bridge.spectrum.pushSamples(this.downmixToMono(left, right, sessionState.channelCount))
    }

    if (this.demand.vectorscope) {
      this.bridge.vectorscope.pushSamples(left, right)
    }
  }

  fillLatestSpectrumMagnitudes(output: Float32Array): number {
    if (!this.bridge.isAvailable()) {
      return 0
    }
    return this.bridge.spectrum.fillMagnitudes(output)
  }

  private downmixToMono(left: Float32Array, right: Float32Array, channelCount: number): Float32Array {
    if (channelCount <= 1) {
      return left
    }

    const count = Math.min(left.length, right.length)
    const mono = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      mono[index] = (left[index] + right[index]) * 0.5
    }
    return mono
  }
}

export const nativeVisualizerTransport = new NativeVisualizerTransport()

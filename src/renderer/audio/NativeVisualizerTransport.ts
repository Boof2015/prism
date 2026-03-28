import { oscilloscope, spectrum, vectorscope, isNativeAvailable } from './native'
import type { VisualizerConsumerDemand } from './AudioRouter'

export interface NativeVisualizerTransportChunkMeta {
  sessionId?: number
  channelCount?: number
}

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
    getMagnitudes: () => Float32Array | null
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
    getMagnitudes: () => spectrum.getMagnitudes(),
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
  private sessionId = 0
  private sampleRate = 48000
  private capturing = false
  private hasSpectrumData = false

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
        this.hasSpectrumData = false
      }
      if (this.demand.vectorscope && !nextDemand.vectorscope) {
        this.bridge.vectorscope.reset()
      }
      if (!this.demand.oscilloscope && nextDemand.oscilloscope) {
        this.bridge.oscilloscope.setSampleRate(this.sampleRate)
      }
      if (!this.demand.spectrum && nextDemand.spectrum) {
        this.bridge.spectrum.setSampleRate(this.sampleRate)
        this.hasSpectrumData = false
      }
      if (!this.demand.vectorscope && nextDemand.vectorscope) {
        this.bridge.vectorscope.setSampleRate(this.sampleRate)
      }
    }

    this.demand = nextDemand
  }

  handleChunk(left: Float32Array, right: Float32Array, meta: NativeVisualizerTransportChunkMeta = {}): void {
    if (!this.capturing || !this.bridge.isAvailable()) {
      return
    }

    if (meta.sessionId !== undefined && meta.sessionId !== this.sessionId) {
      return
    }

    if (!this.demand.oscilloscope && !this.demand.spectrum && !this.demand.vectorscope) {
      return
    }

    const effectiveChannelCount = Math.max(1, Math.floor(meta.channelCount ?? 2) || 1)
    const resolvedRight = effectiveChannelCount > 1 && right.length > 0 ? right : left
    const length = Math.min(left.length, resolvedRight.length)
    if (length === 0) {
      return
    }

    const leftSamples = left.length === length ? left : left.subarray(0, length)
    const rightSamples = resolvedRight.length === length ? resolvedRight : resolvedRight.subarray(0, length)

    if (this.demand.oscilloscope) {
      this.bridge.oscilloscope.pushSamples(leftSamples)
    }

    if (this.demand.vectorscope) {
      this.bridge.vectorscope.pushSamples(leftSamples, rightSamples)
    }

    if (this.demand.spectrum) {
      const mono = new Float32Array(length)
      for (let index = 0; index < length; index += 1) {
        mono[index] = (leftSamples[index] + rightSamples[index]) * 0.5
      }
      this.bridge.spectrum.pushSamples(mono)
      this.hasSpectrumData = true
    }
  }

  reset(sessionState: NativeVisualizerTransportSessionState): void {
    this.sessionId = sessionState.sessionId
    this.capturing = sessionState.capturing
    this.sampleRate = Math.max(1, Math.floor(sessionState.sampleRate) || 1)
    this.hasSpectrumData = false

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

  getLatestSpectrumMagnitudes(): Float32Array | null {
    if (!this.bridge.isAvailable() || !this.demand.spectrum || !this.hasSpectrumData) {
      return null
    }

    return this.bridge.spectrum.getMagnitudes()
  }
}

export const nativeVisualizerTransport = new NativeVisualizerTransport()

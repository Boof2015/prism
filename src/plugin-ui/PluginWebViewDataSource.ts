import type { ScopePopoutSessionState } from '../types/popout'
import type { SpectrumAnalyzerDataSource } from '../renderer/visualizers/SpectrumAnalyzer'

type SpectrumStereoChunk = { left: Float32Array; right: Float32Array }

/**
 * `SpectrumAnalyzerDataSource` for the plugin webview.
 *
 * In Electron this source drains raw sample queues from the AudioRouter. In the
 * plugin the DSP runs in C++, so there are no raw samples to drain here — the
 * pending-sample getters return empty. This source's only job is to report the
 * session state (sample rate + whether the host is feeding us frames) so the
 * visualizer maps frequencies correctly and runs its render loop.
 *
 * Mirrors the seam used by ScopePopoutDataSource so the visualizer is unchanged.
 */
export class PluginWebViewDataSource implements SpectrumAnalyzerDataSource {
  private sessionState: ScopePopoutSessionState = {
    sessionId: 1,
    sampleRate: 48000,
    channelCount: 2,
    capturing: false,
    backendKind: null,
  }

  private readonly listeners = new Set<(state: ScopePopoutSessionState) => void>()

  getPendingSpectrumSamples(): Float32Array[] {
    return []
  }

  getPendingSpectrumStereoSamples(): SpectrumStereoChunk[] {
    return []
  }

  getSampleRate(): number {
    return this.sessionState.sampleRate
  }

  isPlaying(): boolean {
    return this.sessionState.capturing
  }

  subscribeToSessionChanges(listener: (state: ScopePopoutSessionState) => void): () => void {
    this.listeners.add(listener)
    listener(this.sessionState)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Called by the bridge when a host frame arrives. */
  setSampleRate(sampleRate: number): void {
    if (sampleRate > 0 && sampleRate !== this.sessionState.sampleRate) {
      this.updateSession({ sampleRate, sessionId: this.sessionState.sessionId + 1 })
    }
  }

  setPlaying(playing: boolean): void {
    if (playing !== this.sessionState.capturing) {
      this.updateSession({ capturing: playing })
    }
  }

  private updateSession(partial: Partial<ScopePopoutSessionState>): void {
    this.sessionState = { ...this.sessionState, ...partial }
    for (const listener of this.listeners) {
      listener(this.sessionState)
    }
  }
}

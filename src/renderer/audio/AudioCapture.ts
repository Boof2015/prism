/**
 * AudioCapture — captures system audio output via Electron's desktopCapturer,
 * with fallback to getUserMedia for virtual audio devices (BlackHole, etc).
 * Feeds captured samples into AudioRouter for distribution to visualizers.
 */

import { audioRouter } from './AudioRouter'

export type CaptureMode = 'system' | 'device'

class AudioCapture {
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private selectedDeviceId: string | null = null
  private captureMode: CaptureMode = 'system'

  /**
   * Start capturing system audio output via desktopCapturer (ScreenCaptureKit on macOS 13+).
   * This captures all system audio without needing BlackHole or any virtual device.
   */
  async startSystemAudio(): Promise<void> {
    this.stop()

    // Get a screen source ID from the main process
    const sources = await window.electronAPI.getDesktopSources()
    if (!sources.length) {
      throw new Error('No desktop sources available for system audio capture')
    }

    // Create AudioContext
    this.audioContext = new AudioContext()
    await this.audioContext.audioWorklet.addModule('./capture-worklet.js')

    // Request system audio via desktop capturer — must include video (Chromium requirement),
    // but we immediately discard the video track
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
        },
      } as unknown as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      } as unknown as MediaTrackConstraints,
    })

    // Drop the video track immediately — we only need audio
    this.stream.getVideoTracks().forEach((track) => track.stop())

    this.wireUpStream()
    this.captureMode = 'system'
  }

  /**
   * Start capturing from a specific audio input device (e.g. BlackHole, microphone).
   * Fallback for when system audio capture isn't available.
   */
  async startDevice(deviceId?: string): Promise<void> {
    this.stop()

    const targetDeviceId = deviceId ?? this.selectedDeviceId

    this.audioContext = new AudioContext()
    await this.audioContext.audioWorklet.addModule('./capture-worklet.js')

    const constraints: MediaStreamConstraints = {
      audio: {
        ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      } as MediaTrackConstraints,
    }

    this.stream = await navigator.mediaDevices.getUserMedia(constraints)

    this.wireUpStream()
    this.captureMode = 'device'

    if (targetDeviceId) {
      this.selectedDeviceId = targetDeviceId
    }
  }

  /**
   * Start capture — uses system audio by default, falls back to device capture.
   */
  async start(deviceId?: string): Promise<void> {
    if (deviceId) {
      return this.startDevice(deviceId)
    }

    try {
      await this.startSystemAudio()
    } catch (err) {
      console.warn('System audio capture failed, falling back to device capture:', err)
      await this.startDevice(deviceId)
    }
  }

  private wireUpStream(): void {
    if (!this.audioContext || !this.stream) return

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)

    this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
    })

    this.workletNode.port.onmessage = (event: MessageEvent<{ left: Float32Array; right: Float32Array }>) => {
      audioRouter.ingestChunk(event.data.left, event.data.right)
    }

    this.sourceNode.connect(this.workletNode)

    audioRouter.setSampleRate(this.audioContext.sampleRate)
    audioRouter.setCapturing(true)
  }

  stop(): void {
    audioRouter.setCapturing(false)
    audioRouter.reset()

    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode.port.onmessage = null
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput')
  }

  getSelectedDeviceId(): string | null {
    return this.selectedDeviceId
  }

  setSelectedDeviceId(id: string | null): void {
    this.selectedDeviceId = id
  }

  getCaptureMode(): CaptureMode {
    return this.captureMode
  }

  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 48000
  }
}

export const audioCapture = new AudioCapture()

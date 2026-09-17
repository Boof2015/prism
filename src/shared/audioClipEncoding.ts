import type { AudioClipDragPayload, AudioClipFormat, RollingAudioSnapshot } from '../types/audioClip'

/** Serialize interleaved samples explicitly in WAV's little-endian byte order. */
export function encodeAudioClipPayload(
  snapshot: RollingAudioSnapshot,
  format: AudioClipFormat,
): AudioClipDragPayload {
  const bytesPerSample = format === 'float32' ? 4 : 2
  const pcmBytes = new Uint8Array(snapshot.pcmSamples.length * bytesPerSample)
  const view = new DataView(pcmBytes.buffer)
  for (let index = 0; index < snapshot.pcmSamples.length; index += 1) {
    const value = snapshot.pcmSamples[index]
    const sample = Number.isFinite(value) ? value : 0
    if (format === 'float32') {
      view.setFloat32(index * bytesPerSample, sample, true)
    } else {
      const clamped = Math.max(-1, Math.min(1, sample))
      const quantized = Math.round(clamped * (clamped < 0 ? 32768 : 32767))
      view.setInt16(index * bytesPerSample, quantized, true)
    }
  }
  return {
    format,
    pcmBytes,
    sampleRate: snapshot.sampleRate,
    channelCount: snapshot.channelCount,
    frameCount: snapshot.frameCount,
  }
}

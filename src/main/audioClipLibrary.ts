import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AudioClipDragPayload } from '../types/audioClip'

const WAV_HEADER_BYTES = 44
const PCM_BITS_PER_SAMPLE = 16
const MAX_SAMPLE_RATE = 384000
const MAX_CLIP_SECONDS = 60

export function validateAudioClipDragPayload(raw: unknown): AudioClipDragPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('The audio clip payload is invalid.')
  }

  const candidate = raw as Partial<AudioClipDragPayload>
  if (!(candidate.pcmBytes instanceof Uint8Array)) {
    throw new Error('The audio clip is missing PCM sample data.')
  }
  if (
    !Number.isSafeInteger(candidate.sampleRate)
    || candidate.sampleRate! < 1
    || candidate.sampleRate! > MAX_SAMPLE_RATE
  ) {
    throw new Error('The audio clip sample rate is invalid.')
  }
  if (candidate.channelCount !== 1 && candidate.channelCount !== 2) {
    throw new Error('The audio clip channel count is invalid.')
  }
  if (
    !Number.isSafeInteger(candidate.frameCount)
    || candidate.frameCount! < 1
    || candidate.frameCount! > candidate.sampleRate! * MAX_CLIP_SECONDS
  ) {
    throw new Error('The audio clip duration is invalid.')
  }

  const expectedBytes = candidate.frameCount! * candidate.channelCount * (PCM_BITS_PER_SAMPLE / 8)
  if (candidate.pcmBytes.byteLength !== expectedBytes) {
    throw new Error('The audio clip PCM data length is invalid.')
  }

  return {
    pcmBytes: candidate.pcmBytes,
    sampleRate: candidate.sampleRate!,
    channelCount: candidate.channelCount,
    frameCount: candidate.frameCount!,
  }
}

export function encodePcm16Wav(payload: AudioClipDragPayload): Buffer {
  const validated = validateAudioClipDragPayload(payload)
  const dataBytes = validated.pcmBytes.byteLength
  const blockAlign = validated.channelCount * (PCM_BITS_PER_SAMPLE / 8)
  const wav = Buffer.allocUnsafe(WAV_HEADER_BYTES + dataBytes)

  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(validated.channelCount, 22)
  wav.writeUInt32LE(validated.sampleRate, 24)
  wav.writeUInt32LE(validated.sampleRate * blockAlign, 28)
  wav.writeUInt16LE(blockAlign, 32)
  wav.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  wav.set(validated.pcmBytes, WAV_HEADER_BYTES)

  return wav
}

export function buildAudioClipBaseName(date: Date): string {
  const timestamp = date.toISOString()
    .replace('T', ' ')
    .replace(/:/g, '-')
    .replace('Z', '')
  return `Prism Clip ${timestamp}`
}

export class AudioClipLibrary {
  constructor(
    private readonly directory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getDirectory(): string {
    return this.directory
  }

  ensureDirectory(): string {
    mkdirSync(this.directory, { recursive: true })
    return this.directory
  }

  writeClip(raw: unknown): string {
    const payload = validateAudioClipDragPayload(raw)
    const wav = encodePcm16Wav(payload)
    this.ensureDirectory()

    const baseName = buildAudioClipBaseName(this.now())
    let suffix = 1
    let filePath = join(this.directory, `${baseName}.wav`)
    while (existsSync(filePath)) {
      suffix += 1
      filePath = join(this.directory, `${baseName} (${suffix}).wav`)
    }

    writeFileSync(filePath, wav, { flag: 'wx' })
    return filePath
  }
}

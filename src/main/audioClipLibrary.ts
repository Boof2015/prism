import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAudioClipFormat, type AudioClipDragPayload } from '../types/audioClip'

const MAX_SAMPLE_RATE = 384000
const MAX_CLIP_SECONDS = 60

export function validateAudioClipDragPayload(raw: unknown): AudioClipDragPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('The audio clip payload is invalid.')
  }

  const candidate = raw as Partial<AudioClipDragPayload>
  if (!isAudioClipFormat(candidate.format)) {
    throw new Error('The audio clip format is invalid.')
  }
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

  const bytesPerSample = candidate.format === 'float32' ? 4 : 2
  const expectedBytes = candidate.frameCount! * candidate.channelCount * bytesPerSample
  if (candidate.pcmBytes.byteLength !== expectedBytes) {
    throw new Error('The audio clip PCM data length is invalid.')
  }

  return {
    format: candidate.format,
    pcmBytes: candidate.pcmBytes,
    sampleRate: candidate.sampleRate!,
    channelCount: candidate.channelCount,
    frameCount: candidate.frameCount!,
  }
}

export function encodeAudioClipWav(payload: AudioClipDragPayload): Buffer {
  const validated = validateAudioClipDragPayload(payload)
  const isFloat = validated.format === 'float32'
  const bitsPerSample = isFloat ? 32 : 16
  const headerBytes = isFloat ? 58 : 44
  const dataBytes = validated.pcmBytes.byteLength
  const blockAlign = validated.channelCount * (bitsPerSample / 8)
  const wav = Buffer.allocUnsafe(headerBytes + dataBytes)

  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(headerBytes - 8 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(isFloat ? 18 : 16, 16)
  wav.writeUInt16LE(isFloat ? 3 : 1, 20)
  wav.writeUInt16LE(validated.channelCount, 22)
  wav.writeUInt32LE(validated.sampleRate, 24)
  wav.writeUInt32LE(validated.sampleRate * blockAlign, 28)
  wav.writeUInt16LE(blockAlign, 32)
  wav.writeUInt16LE(bitsPerSample, 34)
  if (isFloat) {
    wav.writeUInt16LE(0, 36) // No format extension.
    wav.write('fact', 38, 'ascii')
    wav.writeUInt32LE(4, 42)
    wav.writeUInt32LE(validated.frameCount, 46)
  }
  wav.write('data', headerBytes - 8, 'ascii')
  wav.writeUInt32LE(dataBytes, headerBytes - 4)
  wav.set(validated.pcmBytes, headerBytes)

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
    const wav = encodeAudioClipWav(payload)
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

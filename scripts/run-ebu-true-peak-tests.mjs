import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { lufsmeter } = require('../native/build/Release/visualizer_dsp.node')

const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error('Usage: npm run test:lufsmeter-ebu -- /path/to/extracted-ebu-loudness-test-set')
  process.exit(2)
}

async function collectFiles(path) {
  const details = await stat(path)
  if (details.isFile()) return [path]
  if (!details.isDirectory()) return []

  const files = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    files.push(...await collectFiles(join(path, entry.name)))
  }
  return files
}

function decodeWave(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }

  let format = null
  let data = null
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkOffset = offset + 8
    if (chunkOffset + chunkSize > buffer.length) throw new Error(`truncated ${chunkId} chunk`)

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('invalid fmt chunk')
      let formatTag = buffer.readUInt16LE(chunkOffset)
      if (formatTag === 0xfffe && chunkSize >= 40) {
        formatTag = buffer.readUInt16LE(chunkOffset + 24)
      }
      format = {
        formatTag,
        channels: buffer.readUInt16LE(chunkOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkOffset + 4),
        blockAlign: buffer.readUInt16LE(chunkOffset + 12),
        bitsPerSample: buffer.readUInt16LE(chunkOffset + 14),
      }
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkOffset, chunkOffset + chunkSize)
    }
    offset = chunkOffset + chunkSize + (chunkSize % 2)
  }

  if (!format || !data) throw new Error('missing fmt or data chunk')
  if (format.channels < 1 || format.blockAlign < 1 || format.sampleRate < 1) {
    throw new Error('invalid WAVE format')
  }

  const bytesPerSample = Math.ceil(format.bitsPerSample / 8)
  const frameCount = Math.floor(data.length / format.blockAlign)
  const left = new Float32Array(frameCount)
  const right = new Float32Array(frameCount)
  const readSample = (offset) => {
    if (format.formatTag === 3 && format.bitsPerSample === 32) return data.readFloatLE(offset)
    if (format.formatTag !== 1) throw new Error(`unsupported WAVE format tag ${format.formatTag}`)
    if (format.bitsPerSample === 16) return data.readInt16LE(offset) / 0x8000
    if (format.bitsPerSample === 24) return data.readIntLE(offset, 3) / 0x800000
    if (format.bitsPerSample === 32) return data.readInt32LE(offset) / 0x80000000
    throw new Error(`unsupported PCM depth ${format.bitsPerSample}`)
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * format.blockAlign
    left[frame] = readSample(frameOffset)
    right[frame] = format.channels > 1 ? readSample(frameOffset + bytesPerSample) : left[frame]
  }
  return { sampleRate: format.sampleRate, left, right }
}

function expectedDbtp(caseNumber) {
  if (caseNumber >= 15 && caseNumber <= 18) return -6
  if (caseNumber === 19) return 3
  return 0
}

const files = await collectFiles(resolve(sourcePath))
const cases = new Map()
for (const file of files) {
  const match = basename(file).match(/3341[-_ ](1[5-9]|2[0-3])(?:\D|$)/i)
  if (match && /\.wav(?:\.wav)?$/i.test(file)) cases.set(Number(match[1]), file)
}

const missing = []
for (let caseNumber = 15; caseNumber <= 23; caseNumber += 1) {
  if (!cases.has(caseNumber)) missing.push(caseNumber)
}
if (missing.length > 0) {
  console.error(`Could not find EBU Tech 3341 WAV cases: ${missing.join(', ')}`)
  process.exit(2)
}

let failed = false
for (let caseNumber = 15; caseNumber <= 23; caseNumber += 1) {
  const file = cases.get(caseNumber)
  try {
    const wave = decodeWave(await readFile(file))
    lufsmeter.setSampleRate(wave.sampleRate)
    lufsmeter.reset()
    lufsmeter.pushSamples(wave.left, wave.right)
    const actual = lufsmeter.getSnapshot().maxTruePeakDb
    const expected = expectedDbtp(caseNumber)
    const passed = actual >= expected - 0.4 && actual <= expected + 0.2
    console.log(`${passed ? 'PASS' : 'FAIL'}  EBU 3341-${caseNumber}: ${actual.toFixed(3)} dBTP (expected ${expected}, +0.2/-0.4)`)
    failed ||= !passed
  } catch (error) {
    failed = true
    console.error(`FAIL  EBU 3341-${caseNumber}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

process.exit(failed ? 1 : 0)

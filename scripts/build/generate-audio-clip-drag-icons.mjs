import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../..')
const outputDir = join(repoRoot, 'resources', 'drag')
const logicalSize = 32
const supersample = 4
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const colors = {
  outline: [232, 241, 247, 255],
  page: [9, 16, 23, 255],
  fold: [26, 43, 55, 255],
  waveform: [48, 197, 255, 255],
}

const documentOutline = [
  [8.25, 2],
  [18.75, 2],
  [26, 9.25],
  [26, 27],
  [25.7, 28.25],
  [24.7, 29.5],
  [8.25, 29.5],
  [7, 29.2],
  [6, 28.2],
  [6, 4.75],
  [6.3, 3.5],
  [7.05, 2.55],
]

const documentPage = [
  [8.4, 3.7],
  [18.05, 3.7],
  [24.3, 9.95],
  [24.3, 27.1],
  [23.75, 27.8],
  [8.25, 27.8],
  [7.7, 27.15],
  [7.7, 4.55],
]

const documentFold = [
  [19.1, 4.75],
  [23.25, 8.9],
  [19.1, 8.9],
]

const waveformBars = [
  { x: 10.5, y: 16.5, height: 5 },
  { x: 13.25, y: 13.5, height: 11 },
  { x: 16, y: 15, height: 8 },
  { x: 18.75, y: 12.5, height: 13 },
  { x: 21.5, y: 16, height: 6 },
]

function makeCrc32Table() {
  const table = new Uint32Array(256)
  for (let i = 0; i < table.length; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
}

const crc32Table = makeCrc32Table()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function writePng(filePath, width, height, pixels) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1)
    raw[rowOffset] = 0
    pixels.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(6, 9)

  writeFileSync(filePath, Buffer.concat([
    pngSignature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]))
}

function pointInPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi) / (yj - yi)) + xi) {
      inside = !inside
    }
  }
  return inside
}

function setPixel(pixels, width, x, y, color) {
  const offset = ((y * width) + x) * 4
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
  pixels[offset + 3] = color[3]
}

function fillPolygon(pixels, width, height, points, color, scale) {
  const scaledPoints = points.map(([x, y]) => [x * scale, y * scale])
  const xs = scaledPoints.map(([x]) => x)
  const ys = scaledPoints.map(([, y]) => y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, scaledPoints)) {
        setPixel(pixels, width, x, y, color)
      }
    }
  }
}

function fillRoundedRect(pixels, width, height, rect, color, scale) {
  const left = (rect.x - (rect.width / 2)) * scale
  const top = rect.y * scale
  const rectWidth = rect.width * scale
  const rectHeight = rect.height * scale
  const radius = Math.min(rectWidth / 2, rectHeight / 2)
  const right = left + rectWidth
  const bottom = top + rectHeight

  for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(width, Math.ceil(right)); x += 1) {
      const sampleX = x + 0.5
      const sampleY = y + 0.5
      const nearestX = Math.max(left + radius, Math.min(right - radius, sampleX))
      const nearestY = Math.max(top + radius, Math.min(bottom - radius, sampleY))
      const dx = sampleX - nearestX
      const dy = sampleY - nearestY
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        setPixel(pixels, width, x, y, color)
      }
    }
  }
}

function downsample(source, sourceSize, targetSize) {
  const ratio = sourceSize / targetSize
  const target = Buffer.alloc(targetSize * targetSize * 4)

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let alpha = 0
      let red = 0
      let green = 0
      let blue = 0

      for (let sampleY = 0; sampleY < ratio; sampleY += 1) {
        for (let sampleX = 0; sampleX < ratio; sampleX += 1) {
          const sourceOffset = ((((y * ratio) + sampleY) * sourceSize) + (x * ratio) + sampleX) * 4
          const sampleAlpha = source[sourceOffset + 3]
          alpha += sampleAlpha
          red += source[sourceOffset] * sampleAlpha
          green += source[sourceOffset + 1] * sampleAlpha
          blue += source[sourceOffset + 2] * sampleAlpha
        }
      }

      const targetOffset = ((y * targetSize) + x) * 4
      const sampleCount = ratio * ratio
      target[targetOffset + 3] = Math.round(alpha / sampleCount)
      if (alpha > 0) {
        target[targetOffset] = Math.round(red / alpha)
        target[targetOffset + 1] = Math.round(green / alpha)
        target[targetOffset + 2] = Math.round(blue / alpha)
      }
    }
  }

  return target
}

function renderIcon(size) {
  const sourceSize = size * supersample
  const scale = sourceSize / logicalSize
  const source = Buffer.alloc(sourceSize * sourceSize * 4)

  fillPolygon(source, sourceSize, sourceSize, documentOutline, colors.outline, scale)
  fillPolygon(source, sourceSize, sourceSize, documentPage, colors.page, scale)
  fillPolygon(source, sourceSize, sourceSize, documentFold, colors.fold, scale)
  for (const bar of waveformBars) {
    fillRoundedRect(source, sourceSize, sourceSize, {
      ...bar,
      width: 1.7,
    }, colors.waveform, scale)
  }

  return downsample(source, sourceSize, size)
}

mkdirSync(outputDir, { recursive: true })
for (const [filename, size] of [['audio-clip.png', 32], ['audio-clip@2x.png', 64]]) {
  writePng(join(outputDir, filename), size, size, renderIcon(size))
}

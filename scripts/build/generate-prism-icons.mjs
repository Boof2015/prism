import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../..')
const resourcesDir = join(repoRoot, 'resources')
const tempDir = mkdtempSync(join(tmpdir(), 'prism-icons-'))
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const iconBackground = { r: 5, g: 7, b: 10 }
const iconCanvasSize = 1024
const iconBackgroundInsetRatio = 64 / 1024
const iconCornerRadiusRatio = 0.22
const iconSymbolScale = 2.12
const prismLogoCenter = { x: 337.5, y: 270 }

const lowerPath = 'M429.005,240.019c1.742,-1.006 3.718,-1.535 5.729,-1.535c5.527,0 17.412,0 26.401,0c6.328,0 11.459,5.13 11.459,11.459l0,47.969c0,4.094 -2.184,7.877 -5.729,9.923c-29.927,17.278 -167.716,96.831 -188.613,108.895c-1.742,1.006 -3.718,1.535 -5.729,1.535c-9.919,0 -41.456,0 -58.657,0c-6.328,-0 -11.459,-5.13 -11.459,-11.459c0,-9.188 0,-21.759 0,-29.346c-0,-4.094 2.184,-7.877 5.729,-9.923c32.974,-19.038 197.892,-114.253 220.869,-127.519Z'
const upperPath = 'M266.17,121.735c2.011,-0 3.987,0.529 5.729,1.535c17.748,10.247 119.001,68.705 140.796,81.288c2.558,1.477 4.133,4.206 4.133,7.159c0,0.256 0,0.511 0,0.762c0,2.094 -1.121,4.029 -2.938,5.07c-10.641,6.1 -47.292,27.109 -61.53,35.27c-3.541,2.03 -7.893,2.023 -11.428,-0.018c-23.117,-13.347 -109.643,-63.302 -132.798,-76.671c-3.545,-2.047 -5.729,-5.83 -5.729,-9.924c-0,-8.35 -0,-22.847 -0,-33.013c0,-6.328 5.13,-11.459 11.459,-11.459c15.744,0 43.157,0 52.305,0Z'

function ensureCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
  } catch {
    throw new Error(`Missing required command: ${command}`)
  }
}

function resizePng(sourcePath, outputPath, size) {
  execFileSync('sips', ['-z', String(size), String(size), sourcePath, '--out', outputPath], {
    stdio: 'ignore',
  })
}

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

function readPngRgba(filePath) {
  const buffer = readFileSync(filePath)
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${filePath} is not a PNG file.`)
  }

  let offset = pngSignature.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const data = buffer.subarray(dataStart, dataEnd)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data.readUInt8(8)
      colorType = data.readUInt8(9)
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Unsupported PNG format in ${filePath}; expected 8-bit RGBA.`)
  }

  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const pixels = Buffer.alloc(width * height * bytesPerPixel)
  let inputOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset]
    inputOffset += 1
    const row = inflated.subarray(inputOffset, inputOffset + stride)
    inputOffset += stride
    const outputOffset = y * stride
    const previousOffset = (y - 1) * stride

    for (let x = 0; x < stride; x += 1) {
      const raw = row[x]
      const left = x >= bytesPerPixel ? pixels[outputOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[previousOffset + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[previousOffset + x - bytesPerPixel] : 0
      let value = raw

      if (filter === 1) {
        value = raw + left
      } else if (filter === 2) {
        value = raw + up
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2)
      } else if (filter === 4) {
        const predictor = left + up - upLeft
        const pa = Math.abs(predictor - left)
        const pb = Math.abs(predictor - up)
        const pc = Math.abs(predictor - upLeft)
        const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        value = raw + paeth
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter} in ${filePath}.`)
      }

      pixels[outputOffset + x] = value & 0xff
    }
  }

  return { width, height, pixels }
}

function writePngRgba(filePath, width, height, pixels) {
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (stride + 1)
    raw[outputOffset] = 0
    pixels.copy(raw, outputOffset + 1, y * stride, (y + 1) * stride)
  }

  function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii')
    const lengthBuffer = Buffer.alloc(4)
    lengthBuffer.writeUInt32BE(data.length, 0)
    const crcBuffer = Buffer.alloc(4)
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)

  writeFileSync(filePath, Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

function roundedRectCoverage(x, y, width, height, radius) {
  const clampedX = Math.max(radius, Math.min(width - radius, x))
  const clampedY = Math.max(radius, Math.min(height - radius, y))
  const dx = x - clampedX
  const dy = y - clampedY
  return dx * dx + dy * dy <= radius * radius ? 1 : 0
}

function antiAliasedRoundedRectCoverage(pixelX, pixelY, width, height, radius) {
  const samplesPerAxis = 4
  let covered = 0

  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
      const x = pixelX + ((sampleX + 0.5) / samplesPerAxis)
      const y = pixelY + ((sampleY + 0.5) / samplesPerAxis)
      covered += roundedRectCoverage(x, y, width, height, radius)
    }
  }

  return covered / (samplesPerAxis * samplesPerAxis)
}

function restoreIconBackgroundAlpha(filePath) {
  const image = readPngRgba(filePath)
  const { width, height, pixels } = image
  const inset = Math.round(Math.min(width, height) * iconBackgroundInsetRatio)
  const backgroundWidth = width - (inset * 2)
  const backgroundHeight = height - (inset * 2)
  const radius = Math.min(backgroundWidth, backgroundHeight) * iconCornerRadiusRatio

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = antiAliasedRoundedRectCoverage(
        x - inset,
        y - inset,
        backgroundWidth,
        backgroundHeight,
        radius,
      )
      if (coverage >= 1) continue

      const offset = ((y * width) + x) * 4
      const alpha = Math.round(coverage * 255)
      pixels[offset] = iconBackground.r
      pixels[offset + 1] = iconBackground.g
      pixels[offset + 2] = iconBackground.b
      pixels[offset + 3] = alpha
    }
  }

  writePngRgba(filePath, width, height, pixels)
}

function writeIcoFile(outputPath, images) {
  const headerLength = 6
  const entryLength = 16
  const directoryLength = headerLength + (images.length * entryLength)
  const header = Buffer.alloc(directoryLength)

  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let imageOffset = directoryLength
  images.forEach(({ size, buffer }, index) => {
    const offset = headerLength + (index * entryLength)
    header.writeUInt8(size >= 256 ? 0 : size, offset)
    header.writeUInt8(size >= 256 ? 0 : size, offset + 1)
    header.writeUInt8(0, offset + 2)
    header.writeUInt8(0, offset + 3)
    header.writeUInt16LE(1, offset + 4)
    header.writeUInt16LE(32, offset + 6)
    header.writeUInt32LE(buffer.length, offset + 8)
    header.writeUInt32LE(imageOffset, offset + 12)
    imageOffset += buffer.length
  })

  writeFileSync(outputPath, Buffer.concat([header, ...images.map((image) => image.buffer)]))
}

try {
  ensureCommand('qlmanage')
  ensureCommand('sips')
  ensureCommand('iconutil')

  mkdirSync(resourcesDir, { recursive: true })

  const sourceSvgPath = join(tempDir, 'prism-icon-source.svg')
  const backgroundInset = iconCanvasSize * iconBackgroundInsetRatio
  const backgroundSize = iconCanvasSize - (backgroundInset * 2)
  const backgroundRadius = backgroundSize * iconCornerRadiusRatio
  const symbolTranslateX = (iconCanvasSize / 2) - (prismLogoCenter.x * iconSymbolScale)
  const symbolTranslateY = (iconCanvasSize / 2) - (prismLogoCenter.y * iconSymbolScale)
  writeFileSync(sourceSvgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="${backgroundInset}" y="${backgroundInset}" width="${backgroundSize}" height="${backgroundSize}" rx="${backgroundRadius}" fill="#05070a" />
  <g transform="translate(${symbolTranslateX} ${symbolTranslateY}) scale(${iconSymbolScale})">
    <path d="${lowerPath}" fill="#f0f0f0" />
    <path d="${upperPath}" fill="#f0f0f0" />
  </g>
</svg>
`)

  execFileSync('qlmanage', ['-t', '-s', '1024', '-o', tempDir, sourceSvgPath], {
    stdio: 'ignore',
  })

  const masterPngPath = `${sourceSvgPath}.png`
  if (!existsSync(masterPngPath)) {
    throw new Error('Quick Look did not create the source PNG.')
  }

  const resourcePngPath = join(resourcesDir, 'icon.png')
  copyFileSync(masterPngPath, resourcePngPath)
  restoreIconBackgroundAlpha(resourcePngPath)

  const iconsetDir = join(tempDir, 'Prism.iconset')
  mkdirSync(iconsetDir)
  const iconsetEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]

  for (const [filename, size] of iconsetEntries) {
    resizePng(resourcePngPath, join(iconsetDir, filename), size)
  }

  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(resourcesDir, 'icon.icns')], {
    stdio: 'ignore',
  })

  const icoImages = []
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const outputPath = join(tempDir, `icon-${size}.png`)
    resizePng(resourcePngPath, outputPath, size)
    icoImages.push({ size, buffer: readFileSync(outputPath) })
  }
  writeIcoFile(join(resourcesDir, 'icon.ico'), icoImages)
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

import { cpSync, mkdirSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const pluginProducts = [
  ['PrismSpectrum', 'Prism Spectrum'],
  ['PrismOscilloscope', 'Prism Oscilloscope'],
  ['PrismVUMeter', 'Prism VU Meter'],
  ['PrismLUFSMeter', 'Prism Loudness Meter'],
  ['PrismVectorscope', 'Prism Vectorscope'],
  ['PrismSpectrogram', 'Prism Spectrogram'],
  ['PrismWaveform', 'Prism Waveform'],
  ['PrismWaterfall', 'Prism Waterfall'],
  ['PrismBridge', 'Prism Bridge'],
]

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export function stagePlugins({
  buildDir = join(repoRoot, 'plugin/build'),
  destination = join(repoRoot, 'plugin/dist-installer'),
  platform = process.platform,
} = {}) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`)
  const formats = [['VST3', 'vst3'], ['CLAP', 'clap']]
  if (platform === 'darwin') formats.push(['AU', 'component'])
  const products = []
  const requirePath = (path, directory) => {
    const stat = statSync(path, { throwIfNoEntry: false })
    if (!(directory ? stat?.isDirectory() : stat?.isFile())) {
      throw new Error(`Missing plugin ${directory ? 'bundle/directory' : 'file'}: ${path}`)
    }
  }

  // Check everything before replacing a previously staged, working release.
  for (const [format, extension] of formats) {
    for (const [target, product] of pluginProducts) {
      const name = `${product}.${extension}`
      const source = join(buildDir, `${target}_artefacts`, 'Release', format, name)
      requirePath(source, platform === 'darwin' || format !== 'CLAP')
      if (platform === 'darwin') {
        requirePath(join(source, 'Contents/Info.plist'), false)
        requirePath(join(source, 'Contents/MacOS', product), false)
      } else if (platform === 'linux' && format === 'VST3') {
        requirePath(join(source, 'Contents/x86_64-linux'), true)
      }
      products.push({ source, format, name })
    }
  }

  rmSync(destination, { recursive: true, force: true })
  for (const { source, format, name } of products) {
    mkdirSync(join(destination, format), { recursive: true })
    cpSync(source, join(destination, format, name), { recursive: true, preserveTimestamps: true })
  }
  for (const [format, extension] of formats) {
    const count = readdirSync(join(destination, format)).filter((name) => name.endsWith(`.${extension}`)).length
    if (count !== pluginProducts.length) throw new Error(`Expected 9 ${format} plugins, found ${count}`)
    console.log(`Staged ${count} ${format} plugins`)
  }
  if (platform === 'linux') {
    for (const format of ['vst3', 'clap']) {
      const name = `install-${format}.sh`
      cpSync(join(repoRoot, 'resources/installer/linux', name), join(destination, name))
      chmodSync(join(destination, name), 0o755)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) stagePlugins()

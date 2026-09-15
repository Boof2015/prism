import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pluginProducts } from './build/stage-plugins.mjs'

const validator = process.env.CLAP_VALIDATOR_PATH || 'clap-validator'
const buildDir = resolve('plugin/build')
const logDir = join(buildDir, 'clap-validation')
mkdirSync(logDir, { recursive: true })
let failed = false
for (const [target, product] of pluginProducts) {
  const plugin = join(buildDir, `${target}_artefacts/Release/CLAP`, `${product}.clap`)
  // Validator b2f1d9b divides by zero in param-conversions for plugins with
  // zero parameters. All nine Prism products have no automatable parameters;
  // skip only that inapplicable test, retaining every processing/state check.
  const result = spawnSync(validator, ['validate', plugin, '--only-failed', '--exclude', '^param-conversions$'], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `${result.error}\n` : ''}`
  writeFileSync(join(logDir, `${target}.log`), output)
  if (result.status !== 0) {
    failed = true
    console.error(`${product}: CLAP validation failed\n${output}`)
  } else {
    console.log(`${product}: CLAP validation passed\n${output}`)
  }
}
process.exitCode = failed ? 1 : 0

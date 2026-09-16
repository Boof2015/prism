const assert = require('node:assert/strict')
const addon = require(process.argv[2])
for (const key of ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter', 'macosCapture']) {
  assert.ok(addon[key], `Missing native export: ${key}`)
}
assert.equal(addon.macosCapture.getSupport().available, true, 'Native system capture unavailable')
assert.equal(typeof addon.macosCapture.nowMilliseconds(), 'number')
console.log('[latency] Native addon preflight passed in Electron', process.versions.electron, 'ABI', process.versions.modules)

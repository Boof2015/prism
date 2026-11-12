const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
app.setPath('userData', path.join(manifest.output, 'electron-profile'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function totals() {
  return app.getAppMetrics().map(p => ({ pid: p.pid, created: p.creationTime, type: p.type,
    seconds: p.cpu.cumulativeCPUUsage, workingSetKB: p.memory.workingSetSize }))
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 800, show: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  win.webContents.on('render-process-gone', (_event, details) => { throw new Error(JSON.stringify(details)) })
  const results = []
  for (const run of manifest.runs) {
    const config = run.config
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#171a20}canvas{vertical-align:top}${manifest.fonts}</style></head><body><script>
      window.scopeRunConfig=${JSON.stringify(config)};
      window.visualizerAPI=require(${JSON.stringify(manifest.native)});
      for(const name of ['spectrum','oscilloscope','spectrogram','waveform','vectorscope','vumeter','lufsmeter']) window.visualizerAPI[name]?.reset();
      </script><script src=${JSON.stringify(run.bundle)}></script></body></html>`
    const htmlPath = path.join(manifest.output, 'fixture.html')
    fs.writeFileSync(htmlPath, html)
    await win.loadFile(htmlPath)
    let value = await win.webContents.executeJavaScript('window.scopeReady')
    if (config.mode === 'benchmark') {
      const animate = async seconds => win.webContents.executeJavaScript(`(async()=>{
        const start=performance.now(), intervals=[], costs=[];let count=0,previous=start;
        while(performance.now()-start<${seconds * 1000}) {
          const now=performance.now(); intervals.push(now-previous);previous=now;
          window.scopeFixture.tick();costs.push(performance.now()-now);count++;
          await new Promise(r=>setTimeout(r,Math.max(0,start+count*1000/${config.fps}-performance.now())));
        }
        return {count,elapsed:performance.now()-start,p95FrameMs:intervals.sort((a,b)=>a-b)[Math.floor(intervals.length*.95)],
          p95DrawMs:costs.sort((a,b)=>a-b)[Math.floor(costs.length*.95)],...window.scopeFixture.state()};
      })()`)
      await animate(manifest.warmup ?? 2)
      const before = totals(), start = performance.now()
      value = await animate(manifest.seconds ?? 6)
      const elapsed = performance.now() - start, after = totals()
      value.processes = after.map(p => ({ ...p, cpuMsPerSecond: ((p.seconds ?? NaN) -
        (before.find(b => b.pid === p.pid && b.created === p.created)?.seconds ?? 0)) * 1000000 / elapsed }))
      value.cpuMsPerSecond = value.processes.reduce((n, p) => n + p.cpuMsPerSecond, 0)
      value.workingSetMB = after.reduce((n, p) => n + p.workingSetKB / 1024, 0)
      await win.webContents.executeJavaScript('window.scopeFixture.dispose()')
    }
    const result = { id: run.id, variant: run.variant, config, ...value }
    for (const capture of result.captures ?? []) {
      const stem = `${run.id}-${run.variant}-${capture.kind}`
      fs.writeFileSync(path.join(manifest.output, `${stem}.rgba`), Buffer.from(capture.rgba, 'base64'))
      fs.writeFileSync(path.join(manifest.output, `${stem}.png`), Buffer.from(capture.png.split(',')[1], 'base64'))
      delete capture.rgba; delete capture.png
    }
    results.push(result)
    fs.writeFileSync(path.join(manifest.output, manifest.resultName ?? 'results.json'), JSON.stringify({ versions: process.versions, results }, null, 2))
    console.log(JSON.stringify({ id: run.id, variant: run.variant, gpu: value.gpu, cpu: value.cpuMsPerSecond, frames: value.count ?? value.frames }))
    await pause(30)
  }
  win.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })

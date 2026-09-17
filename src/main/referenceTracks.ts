import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReferenceTrackJobs, type NativeReferenceAnalysis } from './referenceTrackJobs'

let nativeAPI: NativeReferenceAnalysis | null = null
function loadNative(): NativeReferenceAnalysis {
  if (nativeAPI) return nativeAPI
  const require = createRequire(import.meta.url)
  const here = dirname(fileURLToPath(import.meta.url))
  for (const path of [join(here, '../../native/build/Release/visualizer_dsp.node'), join(process.resourcesPath, 'native/visualizer_dsp.node')]) {
    try { nativeAPI = require(path).referenceAnalysis as NativeReferenceAnalysis; if (nativeAPI) return nativeAPI } catch { /* try packaged path */ }
  }
  throw new Error('Reference analysis is unavailable. Rebuild or reinstall Prism’s native audio module.')
}

export const referenceTrackJobs = new ReferenceTrackJobs(loadNative, state => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('reference-tracks:state', state)
  }
})

export function registerReferenceTracks(): void {
  ipcMain.handle('reference-tracks:get-state', () => referenceTrackJobs.getState())
  ipcMain.handle('reference-tracks:cancel', () => referenceTrackJobs.cancel())
  ipcMain.handle('reference-tracks:import', (_event, path: unknown) => {
    if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Choose an audio file on disk.')
    referenceTrackJobs.start(path)
  })
  ipcMain.handle('reference-tracks:choose', async event => {
    const generation = referenceTrackJobs.generation
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Load spectrum reference', properties: ['openFile'] as ['openFile'],
      filters: [{ name: 'Audio tracks', extensions: ['wav', 'wave', 'aif', 'aiff', 'aifc', 'flac', 'mp3'] }] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (!result.canceled && result.filePaths[0] && generation === referenceTrackJobs.generation) referenceTrackJobs.start(result.filePaths[0])
  })
  app.on('before-quit', () => referenceTrackJobs.cancel())
}

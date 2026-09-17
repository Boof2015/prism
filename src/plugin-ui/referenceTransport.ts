import { emitToHost, onHostEvent } from './juceBridge'
import { EMPTY_REFERENCE_IMPORT, type SpectrumReferenceImportState, type SpectrumReferenceTransport } from '../types/spectrumReference'

let uploadGeneration = 0
async function request(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!window.__JUCE__?.backend) throw new Error('Reference tracks require the native Spectrum plugin.')
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('The plugin did not respond to the reference request.')) }, 15000)
    const unsubscribe = onHostEvent('prismReferenceResponse', raw => {
      const response = raw as Record<string, unknown>
      if (response.requestId !== requestId) return
      clearTimeout(timeout); unsubscribe()
      if (response.ok) resolve(response)
      else reject(new Error(String(response.error ?? 'Reference import failed.')))
    })
    emitToHost('prismReferenceCommand', { ...payload, action, requestId })
  })
}

export const pluginReferenceTransport: SpectrumReferenceTransport = {
  subscribe: callback => onHostEvent('prismReferenceState', value => callback(value as SpectrumReferenceImportState)),
  getState: async () => {
    if (!window.__JUCE__?.backend) return { ...EMPTY_REFERENCE_IMPORT }
    return (await request('getState')).state as SpectrumReferenceImportState
  },
  choose: async () => { uploadGeneration++; await request('choose') },
  cancel: async () => { uploadGeneration++; await request('cancel') },
  importFile: async file => {
    const generation = ++uploadGeneration
    let uploadId: unknown
    try {
      uploadId = (await request('beginUpload', { name: file.name, size: file.size })).uploadId
      for (let offset = 0; offset < file.size; offset += 262144) {
        if (generation !== uploadGeneration) return
        const bytes = new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer())
        if (generation !== uploadGeneration) return
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        await request('appendUpload', { uploadId, offset, data: btoa(binary) })
      }
      if (generation === uploadGeneration) await request('finishUpload', { uploadId })
    } catch (error) {
      if (generation !== uploadGeneration) return
      if (uploadId) await request('cancelUpload', { uploadId }).catch(() => {})
      throw error
    }
  },
}

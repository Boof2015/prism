import { useMemo, type JSX, type ReactNode } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { SpectrumReferenceProvider } from './SpectrumReference'
import type { SpectrumReferenceTransport } from '../../types/spectrumReference'

export function desktopReferenceTransport(): SpectrumReferenceTransport {
  return window.electronAPI.referenceTracks
}

export default function DesktopReferenceProvider({ children }: { children: ReactNode }): JSX.Element {
  const reference = useSettingsStore(state => state.scopeSettings.spectrum.reference)
  const ownerKey = useSettingsStore(state => state.activeProfileId)
  const update = useSettingsStore(state => state.updateScopeSettings)
  const transport = useMemo(desktopReferenceTransport, [])
  return <SpectrumReferenceProvider reference={reference} ownerKey={ownerKey} transport={transport}
    onChange={next => update('spectrum', { reference: next })}>{children}</SpectrumReferenceProvider>
}

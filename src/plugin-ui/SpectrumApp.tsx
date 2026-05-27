import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { DEFAULT_SCOPE_SETTINGS, type ScopeSettings } from '../types/settings'
import type { ScopeKind } from '../types/scope'
import type { ResolvedSpectrumTheme } from '../types/theme'
import { createBundledThemes, createDefaultTheme, parseThemeFileContent, resolveTheme } from '../shared/themeState'
import ScopeSettingsSection from '../renderer/components/ScopeSettingsSection'
import SpectrumScope from './SpectrumScope'
import { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { emitToHost, onHostEvent } from './juceBridge'

interface SpectrumAppProps {
  dataSource: PluginWebViewDataSource
  nativeAnalyzer: BridgeSpectrumAnalyzer
}

const DEFAULTS = DEFAULT_SCOPE_SETTINGS.spectrum
const DEFAULT_SPECTRUM_THEME = resolveTheme(createDefaultTheme()).spectrum

function mergeSpectrumSettings(raw: unknown): ScopeSettings['spectrum'] {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const parsed = raw as Record<string, unknown>
  const next = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof ScopeSettings['spectrum'])[]) {
    if (key in parsed && typeof parsed[key] === typeof DEFAULTS[key]) {
      ;(next as Record<string, unknown>)[key] = parsed[key]
    }
  }
  return next
}

// Resolve the app's active theme: prefer its on-disk .iro (matches the app
// exactly), fall back to the bundled theme by name, then the default.
function resolveAppSpectrumTheme(themeId: string, themeFile: string): ResolvedSpectrumTheme {
  try {
    if (themeFile) return resolveTheme(parseThemeFileContent(themeFile, themeId || undefined)).spectrum
  } catch {
    // fall through
  }
  if (themeId) {
    const bundled = createBundledThemes().find((theme) => theme.name === themeId)
    if (bundled) return resolveTheme(bundled).spectrum
  }
  return DEFAULT_SPECTRUM_THEME
}

function resolveAppSpectrumSettings(profileJson: string): ScopeSettings['spectrum'] {
  try {
    const parsed = JSON.parse(profileJson) as { scopeSettings?: { spectrum?: unknown } }
    if (parsed?.scopeSettings?.spectrum) return mergeSpectrumSettings(parsed.scopeSettings.spectrum)
  } catch {
    // fall through
  }
  return { ...DEFAULTS }
}

// Prism's settings icon (matches the app's scope chrome).
function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 118 118" width="15" height="15" aria-hidden="true">
      <path d="M104.811 35.1118L102.384 30.9002C100.549 27.7151 99.6313 26.1225 98.0697 25.4874C96.5082 24.8524 94.7421 25.3535 91.2105 26.3557L85.2112 28.0456C82.9564 28.5655 80.5905 28.2706 78.5319 27.2127L76.8755 26.2571C75.1099 25.1263 73.7519 23.4591 73.0002 21.4993L71.3585 16.5955C70.2788 13.3504 69.7389 11.7279 68.4537 10.7998C67.169 9.87175 65.4619 9.87175 62.0478 9.87175H56.5667C53.1531 9.87175 51.446 9.87175 50.1608 10.7998C48.8758 11.7279 48.336 13.3504 47.2564 16.5955L45.6145 21.4993C44.8628 23.4591 43.5048 25.1263 41.7394 26.2571L40.083 27.2127C38.0242 28.2706 35.6585 28.5655 33.4037 28.0456L27.4042 26.3557C23.8724 25.3535 22.1065 24.8524 20.5451 25.4874C18.9836 26.1225 18.066 27.7151 16.2306 30.9002L13.8038 35.1118C12.0834 38.0975 11.2232 39.5903 11.3902 41.1795C11.5571 42.7687 12.7087 44.0493 15.0118 46.6106L20.0811 52.2779C21.3201 53.8464 22.1997 56.58 22.1997 59.0379C22.1997 61.4967 21.3204 64.2294 20.0812 65.7983L15.0118 71.4657C12.7087 74.0273 11.5572 75.3076 11.3902 76.8972C11.2232 78.4862 12.0834 79.9789 13.8038 82.9643L16.2306 87.1759C18.0659 90.361 18.9836 91.954 20.5451 92.5887C22.1065 93.2239 23.8724 92.7229 27.4043 91.7204L33.4035 90.0306C35.6587 89.5104 38.0248 89.8059 40.0839 90.8639L41.74 91.8197C43.5051 92.9506 44.8628 94.6173 45.6143 96.5771L47.2564 101.481C48.336 104.726 48.8758 106.349 50.1608 107.277C51.446 108.205 53.1531 108.205 56.5667 108.205H62.0478C65.4619 108.205 67.169 108.205 68.4537 107.277C69.7389 106.349 70.2788 104.726 71.3585 101.481L73.0007 96.5771C73.7519 94.6173 75.1094 92.9506 76.875 91.8197L78.5309 90.8639C80.59 89.8059 82.9559 89.5104 85.2112 90.0306L91.2105 91.7204C94.7421 92.7229 96.5082 93.2239 98.0697 92.5887C99.6313 91.954 100.549 90.361 102.384 87.1759L104.811 82.9643C106.531 79.9789 107.391 78.4862 107.225 76.8972C107.057 75.3076 105.906 74.0273 103.603 71.4657L98.5334 65.7983C97.2944 64.2294 96.4148 61.4967 96.4148 59.0379C96.4148 56.58 97.2949 53.8464 98.5334 52.2779L103.603 46.6106C105.906 44.0493 107.057 42.7687 107.225 41.1795C107.391 39.5903 106.531 38.0975 104.811 35.1118Z" fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
      <path d="M76.3042 59C76.3042 68.5039 68.5998 76.2083 59.0959 76.2083C49.592 76.2083 41.8877 68.5039 41.8877 59C41.8877 49.4961 49.592 41.7917 59.0959 41.7917C68.5998 41.7917 76.3042 49.4961 76.3042 59Z" fill="none" stroke="currentColor" strokeWidth="8.5" />
    </svg>
  )
}

export default function SpectrumApp({ dataSource, nativeAnalyzer }: SpectrumAppProps): JSX.Element {
  const [settings, setSettings] = useState<ScopeSettings['spectrum']>({ ...DEFAULTS })
  const [spectrumTheme, setSpectrumTheme] = useState<ResolvedSpectrumTheme>(DEFAULT_SPECTRUM_THEME)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const settingsRef = useRef(settings)
  // True once this instance has a per-instance override (user edit or restored
  // DAW state); app defaults must not clobber it.
  const hasOverride = useRef(false)

  // Set settings, apply DSP params on the host, and optionally persist (only for
  // genuine per-instance overrides — see C++ onPrismConfig).
  const applySettings = useCallback((next: ScopeSettings['spectrum'], persist: boolean): void => {
    settingsRef.current = next
    setSettings(next)
    emitToHost('prismConfig', {
      json: persist ? JSON.stringify(next) : '',
      fftSize: next.fftSize,
      smoothing: next.smoothing,
      persist,
    })
  }, [])

  useEffect(() => {
    const unsubRestore = onHostEvent('prismRestoreSettings', (payload) => {
      const json = (payload as { json?: unknown })?.json
      if (typeof json === 'string' && json.length > 0) {
        hasOverride.current = true
        applySettings(mergeSpectrumSettings(JSON.parse(json)), false)
      }
    })

    const unsubDefaults = onHostEvent('prismAppDefaults', (payload) => {
      const p = (payload ?? {}) as { themeId?: string; themeFile?: string; profileJson?: string }
      setSpectrumTheme(resolveAppSpectrumTheme(p.themeId ?? '', p.themeFile ?? ''))
      if (!hasOverride.current) {
        applySettings(resolveAppSpectrumSettings(p.profileJson ?? ''), false)
      }
    })

    emitToHost('prismReady', {})
    return () => {
      unsubRestore()
      unsubDefaults()
    }
  }, [applySettings])

  const handleUpdate = useCallback(<K extends ScopeKind>(_kind: K, partial: Partial<ScopeSettings[K]>): void => {
    hasOverride.current = true
    applySettings({ ...settingsRef.current, ...(partial as Partial<ScopeSettings['spectrum']>) }, true)
  }, [applySettings])

  return (
    <div className="spectrum-app">
      <SpectrumScope
        dataSource={dataSource}
        nativeAnalyzer={nativeAnalyzer}
        settings={settings}
        theme={spectrumTheme}
      />

      <button
        type="button"
        className={`spectrum-app__gear ${settingsOpen ? 'is-active' : ''}`.trim()}
        onClick={() => setSettingsOpen((open) => !open)}
        aria-label="Settings"
        title="Settings"
      >
        <GearIcon />
      </button>

      {settingsOpen && (
        <div className="spectrum-app__settings">
          <ScopeSettingsSection kind="spectrum" settings={settings} onUpdate={handleUpdate} />
        </div>
      )}
    </div>
  )
}

import { create } from 'zustand'
import { SCOPE_KINDS, type ScopeKind } from '../../types/scope'
import type { VectorscopeMode } from '../visualizers/Vectorscope'
import type { SpectrogramClarityMode, SpectrogramScaleMode } from '../../types/spectrogram'
import type { VUMeterMode, VUMeterOrientation } from '../../types/vumeter'
import type { LUFSMeterMode } from '../../types/lufsmeter'

// Per-scope settings (mirrors Astra's AnalyzerProfileScopeSettings)
export interface ScopeSettings {
  spectrum: {
    fftSize: number
    tiltDbPerOctave: number
    heatmap: boolean
    heatmapTiltDbPerOctave: number
    showGrid: boolean
    smoothing: number
    fillGradient: boolean
  }
  oscilloscope: {
    pitchLock: boolean
    underfillEnabled: boolean
    showGrid: boolean
    lineWidth: number
  }
  vectorscope: {
    mode: VectorscopeMode
    multiband: boolean
    showGrid: boolean
    persistence: number
    lineWidth: number
  }
  spectrogram: {
    fftSize: number
    scrollSpeed: number
    clarityMode: SpectrogramClarityMode
    scaleMode: SpectrogramScaleMode
    colorScheme: 'heat' | 'mono'
  }
  vumeter: {
    mode: VUMeterMode
    orientation: VUMeterOrientation
  }
  lufsmeter: {
    mode: LUFSMeterMode
  }
  waveform: {
    scrollSpeed: number
    gainDb: number
    multiband: boolean
  }
}

const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  spectrum: { fftSize: 2048, tiltDbPerOctave: 2.0, heatmap: false, heatmapTiltDbPerOctave: 2.0, showGrid: true, smoothing: 0.9, fillGradient: true },
  oscilloscope: { pitchLock: true, underfillEnabled: false, showGrid: true, lineWidth: 2 },
  vectorscope: { mode: 'lissajous', multiband: false, showGrid: true, persistence: 0.10, lineWidth: 1.5 },
  spectrogram: { fftSize: 2048, scrollSpeed: 2, clarityMode: 'sharper', scaleMode: 'log', colorScheme: 'heat' },
  vumeter: { mode: 'bar', orientation: 'horizontal' },
  lufsmeter: { mode: 'bar' },
  waveform: { scrollSpeed: 1, gainDb: 0, multiband: false },
}

const DEFAULT_VISIBLE: ScopeKind[] = ['spectrum', 'oscilloscope', 'vectorscope', 'vumeter']

const STORAGE_KEY = 'prism:settings'

interface SettingsState {
  scopeOrder: ScopeKind[]
  hiddenScopes: Set<ScopeKind>
  widthWeights: Record<ScopeKind, number>
  scopeSettings: ScopeSettings

  // Derived
  visibleScopes: () => ScopeKind[]

  // Actions
  toggleScope: (kind: ScopeKind) => void
  moveScope: (kind: ScopeKind, direction: 'left' | 'right') => void
  setScopeWidthWeight: (kind: ScopeKind, weight: number) => void
  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => void
}

function loadFromStorage(): Partial<{ scopeOrder: ScopeKind[]; hiddenScopes: ScopeKind[]; widthWeights: Record<ScopeKind, number>; scopeSettings: ScopeSettings }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveToStorage(state: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scopeOrder: state.scopeOrder,
      hiddenScopes: Array.from(state.hiddenScopes),
      widthWeights: state.widthWeights,
      scopeSettings: state.scopeSettings,
    }))
  } catch { /* ignore */ }
}

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && SCOPE_KINDS.includes(value as ScopeKind)
}

function normalizeScopeOrder(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) return [...SCOPE_KINDS]
  const valid = raw.filter(isScopeKind)
  const seen = new Set<ScopeKind>()
  const normalized: ScopeKind[] = []

  for (const kind of valid) {
    if (seen.has(kind)) continue
    seen.add(kind)
    normalized.push(kind)
  }

  for (const kind of SCOPE_KINDS) {
    if (!seen.has(kind)) {
      normalized.push(kind)
    }
  }

  return normalized
}

function normalizeHiddenScopes(raw: unknown): ScopeKind[] {
  if (!Array.isArray(raw)) {
    return SCOPE_KINDS.filter((kind) => !DEFAULT_VISIBLE.includes(kind))
  }
  return raw.filter(isScopeKind)
}

function mergeScopeSettings(raw: unknown): ScopeSettings {
  const parsed = typeof raw === 'object' && raw !== null
    ? raw as Partial<ScopeSettings>
    : {}

  return {
    spectrum: { ...DEFAULT_SCOPE_SETTINGS.spectrum, ...(parsed.spectrum ?? {}) },
    oscilloscope: { ...DEFAULT_SCOPE_SETTINGS.oscilloscope, ...(parsed.oscilloscope ?? {}) },
    vectorscope: { ...DEFAULT_SCOPE_SETTINGS.vectorscope, ...(parsed.vectorscope ?? {}) },
    spectrogram: { ...DEFAULT_SCOPE_SETTINGS.spectrogram, ...(parsed.spectrogram ?? {}) },
    vumeter: { ...DEFAULT_SCOPE_SETTINGS.vumeter, ...(parsed.vumeter ?? {}) },
    lufsmeter: { ...DEFAULT_SCOPE_SETTINGS.lufsmeter, ...(parsed.lufsmeter ?? {}) },
    waveform: { ...DEFAULT_SCOPE_SETTINGS.waveform, ...(parsed.waveform ?? {}) },
  }
}

const stored = loadFromStorage()

const defaultWeights: Record<ScopeKind, number> = {
  spectrum: 1, oscilloscope: 1, vectorscope: 1, spectrogram: 1,
  vumeter: 0.5, lufsmeter: 0.5, waveform: 1,
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  scopeOrder: normalizeScopeOrder(stored.scopeOrder),
  hiddenScopes: new Set<ScopeKind>(
    normalizeHiddenScopes(stored.hiddenScopes)
  ),
  widthWeights: stored.widthWeights ?? { ...defaultWeights },
  scopeSettings: mergeScopeSettings(stored.scopeSettings),

  visibleScopes: () => {
    const { scopeOrder, hiddenScopes } = get()
    return scopeOrder.filter((k) => !hiddenScopes.has(k))
  },

  toggleScope: (kind: ScopeKind) => {
    set((state) => {
      const next = new Set(state.hiddenScopes)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        // Don't allow hiding all scopes
        const visibleCount = state.scopeOrder.filter((k) => !next.has(k)).length
        if (visibleCount <= 1) return state
        next.add(kind)
      }
      const newState = { ...state, hiddenScopes: next }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  moveScope: (kind: ScopeKind, direction: 'left' | 'right') => {
    set((state) => {
      const order = [...state.scopeOrder]
      const idx = order.indexOf(kind)
      if (idx === -1) return state
      const swap = direction === 'left' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= order.length) return state
      ;[order[idx], order[swap]] = [order[swap], order[idx]]
      const newState = { ...state, scopeOrder: order }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  setScopeWidthWeight: (kind: ScopeKind, weight: number) => {
    set((state) => {
      const newState = { ...state, widthWeights: { ...state.widthWeights, [kind]: Math.max(0.1, weight) } }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },

  updateScopeSettings: <K extends ScopeKind>(kind: K, settings: Partial<ScopeSettings[K]>) => {
    set((state) => {
      const newState = {
        ...state,
        scopeSettings: {
          ...state.scopeSettings,
          [kind]: { ...state.scopeSettings[kind], ...settings },
        },
      }
      saveToStorage(newState as SettingsState)
      return newState
    })
  },
}))

import { create } from 'zustand'

export interface ThemePreset {
  name: string
  accent: string
  accentHover: string
  accentGlow: string
  accentRgb: string
}

const PRESETS: Record<string, ThemePreset> = {
  default: {
    name: 'Cyan',
    accent: '#38bdf8',
    accentHover: '#7dd3fc',
    accentGlow: 'rgba(56, 189, 248, 0.3)',
    accentRgb: '56, 189, 248',
  },
  graphite: {
    name: 'Graphite',
    accent: '#4fc3f7',
    accentHover: '#81d4fa',
    accentGlow: 'rgba(79, 195, 247, 0.3)',
    accentRgb: '79, 195, 247',
  },
  midnight: {
    name: 'Midnight',
    accent: '#4f9bff',
    accentHover: '#7eb8ff',
    accentGlow: 'rgba(79, 155, 255, 0.3)',
    accentRgb: '79, 155, 255',
  },
  green: {
    name: 'Green',
    accent: '#4ade80',
    accentHover: '#86efac',
    accentGlow: 'rgba(74, 222, 128, 0.3)',
    accentRgb: '74, 222, 128',
  },
  purple: {
    name: 'Purple',
    accent: '#a78bfa',
    accentHover: '#c4b5fd',
    accentGlow: 'rgba(167, 139, 250, 0.3)',
    accentRgb: '167, 139, 250',
  },
  rose: {
    name: 'Rose',
    accent: '#fb7185',
    accentHover: '#fda4af',
    accentGlow: 'rgba(251, 113, 133, 0.3)',
    accentRgb: '251, 113, 133',
  },
}

export const PRESET_IDS = Object.keys(PRESETS)

const STORAGE_KEY = 'prism:theme'

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

function lightenHex(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + amount)
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + amount)
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

interface ThemeState {
  presetId: string
  customAccent: string | null // null = use preset accent
  accent: string // resolved accent hex

  setPreset: (id: string) => void
  setCustomAccent: (hex: string | null) => void
}

function loadTheme(): { presetId: string; customAccent: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { presetId: 'default', customAccent: null }
}

export function applyAccentToDOM(accent: string): void {
  const rgb = hexToRgb(accent)
  const root = document.documentElement
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-hover', lightenHex(accent, 50))
  root.style.setProperty('--accent-glow', `rgba(${rgb}, 0.3)`)
  root.style.setProperty('--accent-rgb', rgb)
}

const stored = loadTheme()
const initialPreset = PRESETS[stored.presetId] ?? PRESETS.default
const initialAccent = stored.customAccent ?? initialPreset.accent

// Apply immediately on load
applyAccentToDOM(initialAccent)

export const useThemeStore = create<ThemeState>((set) => ({
  presetId: stored.presetId,
  customAccent: stored.customAccent,
  accent: initialAccent,

  setPreset: (id: string) => {
    const preset = PRESETS[id] ?? PRESETS.default
    applyAccentToDOM(preset.accent)
    const state = { presetId: id, customAccent: null, accent: preset.accent }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: id, customAccent: null }))
    set(state)
  },

  setCustomAccent: (hex: string | null) => {
    set((prev) => {
      const preset = PRESETS[prev.presetId] ?? PRESETS.default
      const accent = hex ?? preset.accent
      applyAccentToDOM(accent)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: prev.presetId, customAccent: hex }))
      return { ...prev, customAccent: hex, accent }
    })
  },
}))

export { PRESETS }

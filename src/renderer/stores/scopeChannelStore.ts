import { create } from 'zustand'
import { AUDIO_SCOPE_KINDS, type AudioScopeKind } from '../../types/scope'
import { audioRouter } from '../audio/AudioRouter'

type ScopePairs = Partial<Record<AudioScopeKind, number>>
const STORAGE_KEY = 'prism:scope-channel-pairs'

function loadPairs(): ScopePairs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    const pairs: ScopePairs = {}
    for (const scope of AUDIO_SCOPE_KINDS) {
      const left = raw[scope]
      if (typeof left === 'number' && Number.isInteger(left) && left >= 0 && left < 8 && left % 2 === 0) {
        pairs[scope] = left
        audioRouter.setScopeChannelPair(scope, { left, right: left + 1 })
      }
    }
    return pairs
  } catch {
    return {}
  }
}

interface ScopeChannelState {
  pairs: ScopePairs
  setPair: (scope: AudioScopeKind, left: number | null) => void
}

export const useScopeChannelStore = create<ScopeChannelState>((set, get) => ({
  pairs: loadPairs(),
  setPair: (scope, left) => {
    if (left !== null && (!Number.isInteger(left) || left < 0 || left >= 8 || left % 2 !== 0)) return
    const pairs = { ...get().pairs }
    if (left === null) delete pairs[scope]
    else pairs[scope] = left
    audioRouter.setScopeChannelPair(scope, left === null ? null : { left, right: left + 1 })
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pairs)) } catch { /* Storage may be disabled. */ }
    set({ pairs })
  },
}))

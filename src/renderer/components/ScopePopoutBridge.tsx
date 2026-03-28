import { useEffect, useMemo, useRef } from 'react'
import { audioRouter } from '../audio/AudioRouter'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
} from '../../types/popout'
import { SCOPE_KINDS, SCOPE_LABELS, type ScopeKind } from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'

function buildConsumerDemand(kind: ScopeKind): Record<ScopeKind, boolean> {
  return SCOPE_KINDS.reduce((acc, currentKind) => {
    acc[currentKind] = currentKind === kind
    return acc
  }, {} as Record<ScopeKind, boolean>)
}

function flushScopeAudioBatch(kind: ScopeKind): ScopePopoutAudioBatch {
  switch (kind) {
    case 'spectrum':
      return audioRouter.flushPendingSpectrumSamples()
    case 'oscilloscope':
      return audioRouter.flushPendingOscilloscopeSamples()
    case 'vectorscope':
      return audioRouter.flushPendingVectorscopeSamples()
    case 'spectrogram':
      return audioRouter.flushPendingSpectrogramSamples()
    case 'vumeter':
      return audioRouter.flushPendingVUMeterSamples()
    case 'lufsmeter':
      return audioRouter.flushPendingLUFSMeterSamples()
    case 'waveform':
      return audioRouter.flushPendingWaveformSamples()
  }
}

function toPopoutSessionState(state: ScopePopoutSessionState): ScopePopoutSessionState {
  return {
    sessionId: state.sessionId,
    sampleRate: state.sampleRate,
    channelCount: state.channelCount,
    capturing: state.capturing,
    backendKind: state.backendKind,
  }
}

function isPartialSettings(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default function ScopePopoutBridge(): null {
  const hiddenScopes = useSettingsStore((s) => s.hiddenScopes)
  const scopePopouts = useSettingsStore((s) => s.scopePopouts)
  const scopeSettings = useSettingsStore((s) => s.scopeSettings)
  const popInScope = useSettingsStore((s) => s.popInScope)
  const updatePopoutBounds = useSettingsStore((s) => s.updatePopoutBounds)
  const updateScopeSettings = useSettingsStore((s) => s.updateScopeSettings)
  const accent = useThemeStore((s) => s.accent)

  const activePopoutKinds = useMemo(
    () => SCOPE_KINDS.filter((kind) => scopePopouts[kind]?.poppedOut && !hiddenScopes.has(kind)),
    [hiddenScopes, scopePopouts],
  )
  const activePopoutKindsRef = useRef<ScopeKind[]>(activePopoutKinds)

  useEffect(() => {
    activePopoutKindsRef.current = activePopoutKinds
  }, [activePopoutKinds])

  useEffect(() => {
    const syncState = SCOPE_KINDS.reduce((acc, kind) => {
      acc[kind] = {
        shouldBeOpen: scopePopouts[kind]?.poppedOut === true && !hiddenScopes.has(kind),
        bounds: scopePopouts[kind]?.windowBounds,
      }
      return acc
    }, {} as ScopePopoutSyncStateMap)

    window.electronAPI.syncScopePopouts(syncState)
  }, [hiddenScopes, scopePopouts])

  useEffect(() => {
    for (const kind of activePopoutKinds) {
      const snapshot: ScopePopoutSnapshot = {
        kind,
        label: SCOPE_LABELS[kind],
        accent,
        settings: scopeSettings[kind],
      }
      window.electronAPI.sendScopePopoutSnapshot(snapshot)
    }
  }, [accent, activePopoutKinds, scopeSettings])

  useEffect(() => {
    const sessionState = toPopoutSessionState(audioRouter.getSessionState())
    for (const kind of activePopoutKinds) {
      window.electronAPI.sendScopePopoutSession(kind, sessionState)
    }
  }, [activePopoutKinds])

  useEffect(() => {
    const unsubscribeCloseRequested = window.electronAPI.onScopePopoutCloseRequested((kind) => {
      popInScope(kind)
    })
    const unsubscribeBoundsChanged = window.electronAPI.onScopePopoutBoundsChanged((kind, bounds) => {
      updatePopoutBounds(kind, bounds)
    })
    const unsubscribeSettingsUpdate = window.electronAPI.onScopePopoutSettingsUpdate((kind, partial) => {
      if (!isPartialSettings(partial)) return
      updateScopeSettings(kind, partial as Partial<ScopeSettings[typeof kind]>)
    })
    const unsubscribeReady = window.electronAPI.onScopePopoutReady((kind) => {
      const nextHiddenScopes = useSettingsStore.getState().hiddenScopes
      const nextPopouts = useSettingsStore.getState().scopePopouts
      if (!nextPopouts[kind]?.poppedOut || nextHiddenScopes.has(kind)) return

      window.electronAPI.sendScopePopoutSnapshot({
        kind,
        label: SCOPE_LABELS[kind],
        accent: useThemeStore.getState().accent,
        settings: useSettingsStore.getState().scopeSettings[kind],
      })
      window.electronAPI.sendScopePopoutSession(kind, toPopoutSessionState(audioRouter.getSessionState()))
    })

    return () => {
      unsubscribeCloseRequested()
      unsubscribeBoundsChanged()
      unsubscribeSettingsUpdate()
      unsubscribeReady()
    }
  }, [popInScope, updatePopoutBounds, updateScopeSettings])

  useEffect(() => {
    for (const kind of SCOPE_KINDS) {
      const consumerId = `popout:${kind}`
      if (activePopoutKinds.includes(kind)) {
        audioRouter.setVisualizerConsumerDemand(consumerId, buildConsumerDemand(kind))
      } else {
        audioRouter.clearVisualizerConsumerDemand(consumerId)
      }
    }

    return () => {
      for (const kind of SCOPE_KINDS) {
        audioRouter.clearVisualizerConsumerDemand(`popout:${kind}`)
      }
    }
  }, [activePopoutKinds])

  useEffect(() => {
    let frameId = 0

    const flushFrame = (): void => {
      for (const kind of activePopoutKindsRef.current) {
        const batch = flushScopeAudioBatch(kind)
        if (batch.length > 0) {
          window.electronAPI.sendScopePopoutAudio(kind, batch)
        }
      }
      frameId = window.requestAnimationFrame(flushFrame)
    }

    if (activePopoutKinds.length > 0) {
      frameId = window.requestAnimationFrame(flushFrame)
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [activePopoutKinds])

  useEffect(() => {
    return audioRouter.subscribeToSessionChanges((state) => {
      const nextSessionState = toPopoutSessionState(state)
      for (const kind of activePopoutKindsRef.current) {
        window.electronAPI.sendScopePopoutSession(kind, nextSessionState)
      }
    })
  }, [])

  return null
}

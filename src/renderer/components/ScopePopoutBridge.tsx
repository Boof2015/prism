import { useEffect, useMemo, useRef } from 'react'
import { audioRouter } from '../audio/AudioRouter'
import { usePerformanceStore } from '../stores/performanceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore } from '../stores/themeStore'
import { getRendererWindowCapabilities } from '../windowCapabilities'
import { FrameScheduler } from '../visualizers/frameScheduler'
import type {
  ScopePopoutAudioBatch,
  ScopePopoutSessionState,
  ScopePopoutSnapshot,
  ScopePopoutSyncStateMap,
} from '../../types/popout'
import {
  AUDIO_SCOPE_KINDS,
  SCOPE_KINDS,
  SCOPE_LABELS,
  isAudioScopeKind,
  type AudioScopeKind,
  type ScopeKind,
} from '../../types/scope'
import type { ScopeSettings } from '../../types/settings'

function buildConsumerDemand(kind: AudioScopeKind): Record<AudioScopeKind, boolean> {
  return AUDIO_SCOPE_KINDS.reduce((acc, currentKind) => {
    acc[currentKind] = currentKind === kind
    return acc
  }, {} as Record<AudioScopeKind, boolean>)
}

function flushScopeAudioBatch(kind: AudioScopeKind, scopeSettings: ScopeSettings): ScopePopoutAudioBatch {
  switch (kind) {
    case 'spectrum':
      return scopeSettings.spectrum.showSideLine
        ? audioRouter.flushPendingSpectrumStereoSamples()
        : audioRouter.flushPendingSpectrumSamples()
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
      return scopeSettings.waveform.mode === 'stereo'
        ? audioRouter.flushPendingWaveformStereoSamples()
        : audioRouter.flushPendingWaveformSamples()
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
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const frameTarget = usePerformanceStore((s) => s.frameTarget)

  const activePopoutKinds = useMemo(
    () => SCOPE_KINDS.filter((kind) => scopePopouts[kind]?.poppedOut && !hiddenScopes.has(kind)),
    [hiddenScopes, scopePopouts],
  )
  const flushScheduler = useMemo(() => new FrameScheduler({ frameTarget }), [])
  const activePopoutKindsRef = useRef<ScopeKind[]>(activePopoutKinds)
  const sessionStateRef = useRef(audioRouter.getSessionState())
  const supportsGeometryPersistence = getRendererWindowCapabilities().supportsGeometryPersistence

  useEffect(() => {
    flushScheduler.setFrameTarget(frameTarget)
  }, [flushScheduler, frameTarget])

  useEffect(() => {
    activePopoutKindsRef.current = activePopoutKinds
  }, [activePopoutKinds])

  useEffect(() => {
    const syncState = SCOPE_KINDS.reduce((acc, kind) => {
      acc[kind] = {
        shouldBeOpen: scopePopouts[kind]?.poppedOut === true && !hiddenScopes.has(kind),
        bounds: supportsGeometryPersistence
          ? scopePopouts[kind]?.windowBounds
          : undefined,
      }
      return acc
    }, {} as ScopePopoutSyncStateMap)

    window.electronAPI.syncScopePopouts(syncState)
  }, [hiddenScopes, scopePopouts, supportsGeometryPersistence])

  useEffect(() => {
    for (const kind of activePopoutKinds) {
      const snapshot: ScopePopoutSnapshot = {
        kind,
        label: SCOPE_LABELS[kind],
        interfaceTheme: activeTheme.interface,
        scopeTheme: activeTheme[kind],
        settings: scopeSettings[kind],
      }
      window.electronAPI.sendScopePopoutSnapshot(snapshot)
    }
  }, [activePopoutKinds, activeTheme, scopeSettings])

  useEffect(() => {
    const sessionState = toPopoutSessionState(audioRouter.getSessionState())
    for (const kind of activePopoutKinds) {
      if (!isAudioScopeKind(kind)) continue
      window.electronAPI.sendScopePopoutSession(kind, sessionState)
    }
  }, [activePopoutKinds])

  useEffect(() => {
    const unsubscribeCloseRequested = window.electronAPI.onScopePopoutCloseRequested((kind) => {
      popInScope(kind)
    })
    const unsubscribeBoundsChanged = window.electronAPI.onScopePopoutBoundsChanged((kind, bounds) => {
      if (!supportsGeometryPersistence) return
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
        interfaceTheme: useThemeStore.getState().activeTheme.interface,
        scopeTheme: useThemeStore.getState().activeTheme[kind],
        settings: useSettingsStore.getState().scopeSettings[kind],
      })
      if (isAudioScopeKind(kind)) {
        window.electronAPI.sendScopePopoutSession(kind, toPopoutSessionState(audioRouter.getSessionState()))
      }
    })

    return () => {
      unsubscribeCloseRequested()
      unsubscribeBoundsChanged()
      unsubscribeSettingsUpdate()
      unsubscribeReady()
    }
  }, [popInScope, supportsGeometryPersistence, updatePopoutBounds, updateScopeSettings])

  useEffect(() => {
    for (const kind of AUDIO_SCOPE_KINDS) {
      const consumerId = `popout:${kind}`
      if (activePopoutKinds.includes(kind)) {
        audioRouter.setVisualizerConsumerDemand(consumerId, buildConsumerDemand(kind))
      } else {
        audioRouter.clearVisualizerConsumerDemand(consumerId)
      }
    }

    return () => {
      for (const kind of AUDIO_SCOPE_KINDS) {
        audioRouter.clearVisualizerConsumerDemand(`popout:${kind}`)
      }
    }
  }, [activePopoutKinds])

  useEffect(() => {
    let unsubscribeFlush: (() => void) | null = null

    const flushFrame = (): void => {
      if (!sessionStateRef.current.capturing || activePopoutKindsRef.current.length === 0) {
        return
      }

      for (const kind of activePopoutKindsRef.current) {
        if (!isAudioScopeKind(kind)) continue
        const batch = flushScopeAudioBatch(kind, useSettingsStore.getState().scopeSettings)
        if (batch.length > 0) {
          window.electronAPI.sendScopePopoutAudio(kind, batch)
        }
      }
    }

    const syncFlushLoop = (): void => {
      const shouldRun = sessionStateRef.current.capturing && activePopoutKindsRef.current.length > 0
      if (!shouldRun) {
        if (unsubscribeFlush) {
          unsubscribeFlush()
          unsubscribeFlush = null
        }
        return
      }

      if (!unsubscribeFlush) {
        unsubscribeFlush = flushScheduler.subscribe(flushFrame)
      }
    }

    sessionStateRef.current = audioRouter.getSessionState()
    const unsubscribeSession = audioRouter.subscribeToSessionChanges((state) => {
      sessionStateRef.current = state
      syncFlushLoop()
    })
    syncFlushLoop()

    return () => {
      if (unsubscribeFlush) {
        unsubscribeFlush()
      }
      unsubscribeSession()
    }
  }, [activePopoutKinds, flushScheduler])

  useEffect(() => {
    return audioRouter.subscribeToSessionChanges((state) => {
      const nextSessionState = toPopoutSessionState(state)
      for (const kind of activePopoutKindsRef.current) {
        if (!isAudioScopeKind(kind)) continue
        window.electronAPI.sendScopePopoutSession(kind, nextSessionState)
      }
    })
  }, [])

  return null
}

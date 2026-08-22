import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LinkedAnalysisEnd,
  LinkedAnalysisMessage,
  LinkedAnalysisProbe,
} from '../types/analysis'

export function reduceLinkedAnalysisProbe(
  current: LinkedAnalysisProbe | null,
  message: LinkedAnalysisMessage,
): LinkedAnalysisProbe | null {
  if (message.active) return message
  return current?.interactionId === message.interactionId ? null : current
}

export interface LinkedAnalysisSession {
  probe: LinkedAnalysisProbe | null
  publish: (message: LinkedAnalysisMessage) => void
}

export function useLinkedAnalysis(enabled: boolean): LinkedAnalysisSession {
  const [probe, setProbe] = useState<LinkedAnalysisProbe | null>(null)
  const enabledRef = useRef(enabled)
  const localProbeRef = useRef<LinkedAnalysisProbe | null>(null)
  const pendingProbeRef = useRef<LinkedAnalysisProbe | null>(null)
  const sendFrameRef = useRef<number | null>(null)
  enabledRef.current = enabled

  const cancelPendingFrame = useCallback((): void => {
    if (sendFrameRef.current !== null) {
      window.cancelAnimationFrame(sendFrameRef.current)
      sendFrameRef.current = null
    }
    pendingProbeRef.current = null
  }, [])

  const publish = useCallback((message: LinkedAnalysisMessage): void => {
    if (!enabledRef.current) return
    setProbe((current) => reduceLinkedAnalysisProbe(current, message))

    if (!message.active) {
      if (localProbeRef.current?.interactionId !== message.interactionId) return
      cancelPendingFrame()
      localProbeRef.current = null
      window.electronAPI.sendLinkedAnalysisMessage(message)
      return
    }

    const isNewInteraction = localProbeRef.current?.interactionId !== message.interactionId
    localProbeRef.current = message
    if (isNewInteraction) {
      cancelPendingFrame()
      window.electronAPI.sendLinkedAnalysisMessage(message)
      return
    }

    pendingProbeRef.current = message
    if (sendFrameRef.current !== null) return
    sendFrameRef.current = window.requestAnimationFrame(() => {
      sendFrameRef.current = null
      const pending = pendingProbeRef.current
      pendingProbeRef.current = null
      if (pending && enabledRef.current) {
        window.electronAPI.sendLinkedAnalysisMessage(pending)
      }
    })
  }, [cancelPendingFrame])

  useEffect(() => {
    return window.electronAPI.onLinkedAnalysisMessage((message) => {
      if (!enabledRef.current) return
      setProbe((current) => reduceLinkedAnalysisProbe(current, message))
    })
  }, [])

  useEffect(() => {
    if (enabled) return
    const localProbe = localProbeRef.current
    cancelPendingFrame()
    localProbeRef.current = null
    setProbe(null)
    if (localProbe) {
      const end: LinkedAnalysisEnd = {
        active: false,
        interactionId: localProbe.interactionId,
        sourceKind: localProbe.sourceKind,
      }
      window.electronAPI.sendLinkedAnalysisMessage(end)
    }
  }, [cancelPendingFrame, enabled])

  useEffect(() => {
    return () => {
      const localProbe = localProbeRef.current
      cancelPendingFrame()
      if (localProbe) {
        window.electronAPI.sendLinkedAnalysisMessage({
          active: false,
          interactionId: localProbe.interactionId,
          sourceKind: localProbe.sourceKind,
        })
      }
    }
  }, [cancelPendingFrame])

  return { probe: enabled ? probe : null, publish }
}

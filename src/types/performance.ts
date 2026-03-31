export const VISUALIZER_FRAME_TARGETS = [10, 30, 60, 120, 144, 'display-sync'] as const

export type VisualizerFrameTarget = typeof VISUALIZER_FRAME_TARGETS[number]

export interface PerformanceMemorySnapshot {
  capturedAt: number
  appMb: number
  mainMb: number
  rendererMb: number
  rendererPrivateMb: number | null
  gpuMb: number
  utilityMb: number
  jsHeapUsedMb: number | null
  jsHeapLimitMb: number | null
}

export function isVisualizerFrameTarget(value: unknown): value is VisualizerFrameTarget {
  return VISUALIZER_FRAME_TARGETS.includes(value as VisualizerFrameTarget)
}

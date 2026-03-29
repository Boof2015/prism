import type { AstraNowPlayingSnapshot } from '../../types/astra'

export interface AstraPlaybackProgress {
  currentTime: number
  duration: number
  progress: number
}

export function getAstraPlaybackProgress(
  snapshot: AstraNowPlayingSnapshot | null,
  nowMs = Date.now(),
): AstraPlaybackProgress {
  if (!snapshot) {
    return {
      currentTime: 0,
      duration: 0,
      progress: 0,
    }
  }

  const duration = Math.max(0, snapshot.duration)
  const baseCurrentTime = Math.max(0, snapshot.currentTime)
  const elapsedSeconds = snapshot.playbackState === 'playing'
    ? Math.max(0, (nowMs - snapshot.updatedAt) / 1000)
    : 0
  const currentTime = duration > 0
    ? Math.min(duration, baseCurrentTime + elapsedSeconds)
    : baseCurrentTime + elapsedSeconds
  const progress = duration > 0
    ? Math.max(0, Math.min(1, currentTime / duration))
    : 0

  return {
    currentTime,
    duration,
    progress,
  }
}

export function formatAstraTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
  }

  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

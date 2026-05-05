export type VUMeterMode = 'needle' | 'bar'
export type VUMeterOrientation = 'horizontal' | 'vertical'
export type VUMeterNeedleChannels = 'stereo' | 'combined'

export const VU_METER_MODES: readonly VUMeterMode[] = ['needle', 'bar']
export const VU_METER_ORIENTATIONS: readonly VUMeterOrientation[] = ['horizontal', 'vertical']
export const VU_METER_NEEDLE_CHANNELS: readonly VUMeterNeedleChannels[] = ['stereo', 'combined']

export const DEFAULT_VU_METER_MODE: VUMeterMode = 'bar'
export const DEFAULT_VU_METER_ORIENTATION: VUMeterOrientation = 'horizontal'
export const DEFAULT_VU_METER_NEEDLE_CHANNELS: VUMeterNeedleChannels = 'stereo'

export function isVUMeterMode(value: unknown): value is VUMeterMode {
  return typeof value === 'string' && VU_METER_MODES.includes(value as VUMeterMode)
}

export function isVUMeterOrientation(value: unknown): value is VUMeterOrientation {
  return typeof value === 'string' && VU_METER_ORIENTATIONS.includes(value as VUMeterOrientation)
}

export function isVUMeterNeedleChannels(value: unknown): value is VUMeterNeedleChannels {
  return typeof value === 'string' && VU_METER_NEEDLE_CHANNELS.includes(value as VUMeterNeedleChannels)
}

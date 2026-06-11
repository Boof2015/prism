export type WindowDisplayServer = 'other' | 'x11' | 'wayland' | 'unknown'

export interface WindowCapabilities {
  displayServer: WindowDisplayServer
  useNativeDragRegions: boolean
  supportsProgrammaticReposition: boolean
  supportsGeometryPersistence: boolean
  supportsBlurredBackground: boolean
}

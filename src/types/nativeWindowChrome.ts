export interface NativeWindowChromeAPI {
  // Strips the visible native frame/shadow from a frameless WS_THICKFRAME window
  // while preserving native snapping and edge resize. Returns false if the handle
  // was invalid or the subclass could not be installed. Windows-only; a no-op
  // elsewhere.
  applyFlatFrame: (nativeWindowHandle: Buffer) => boolean
}

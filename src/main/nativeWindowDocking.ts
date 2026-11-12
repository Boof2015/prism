import type { NativeWindowDockingAPI } from '../types/windowDocking'

export function loadNativeWindowDockingApi(): NativeWindowDockingAPI | null {
  // Disabled on Windows: repeated SHAppBarMessage registration/position updates
  // can make Explorer continuously rebuild the taskbar and desktop work area.
  // Keep the implementation available for later repair, but never load it in
  // a normal Prism process until that lifecycle is proven stable.
  return null
}

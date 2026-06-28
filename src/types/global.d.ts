import type { DesktopApi } from '../../electron/preload/index'
import type { DesktopOverlayApi } from '../../electron/preload/overlay'

declare global {
  interface Window {
    desktop: DesktopApi
    desktopOverlay?: DesktopOverlayApi
  }
}

export {}

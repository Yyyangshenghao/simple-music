import { create } from 'zustand'
import type { WindowState } from '../types/ipc'

// 只读 store：状态由主进程通过 useDesktopBridge 推送。
interface WindowStore extends WindowState {
  setState(state: WindowState): void
}

const INITIAL: WindowState = {
  isMaximized: false,
  isNativeFullScreen: false,
  isHtmlFullScreen: false,
  isWindowFullScreen: false,
  isFullScreen: false,
  isMinimized: false,
  isVisible: true,
  isFocused: true,
  isPrimaryDisplay: true,
  hasDisplayOnLeft: false,
  hasDisplayOnRight: false,
  displayBounds: null
}

export const useWindowStore = create<WindowStore>((set) => ({
  ...INITIAL,
  setState(state) {
    set(state)
  }
}))

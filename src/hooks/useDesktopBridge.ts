import { useEffect } from 'react'
import { useWindowStore } from '../stores/window'
import { initGameModeSync } from '../lib/game-mode-sync'

// 订阅主窗口状态；播放命令由播放运行时接收。
export function useDesktopBridge(): void {
  useEffect(() => {
    const d = window.desktop
    if (!d) return

    const offState = d.onStateChange((state) => useWindowStore.getState().setState(state))
    const independentPlayback = typeof d.playbackRequest === 'function'
    const stopGameMode = independentPlayback ? initGameModeSync() : undefined

    // 初始拉一次窗口状态
    void d.getState().then((state) => useWindowStore.getState().setState(state))

    return () => {
      offState()
      stopGameMode?.()
    }
  }, [])
}

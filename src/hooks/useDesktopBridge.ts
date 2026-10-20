import { useEffect } from 'react'
import { useWindowStore } from '../stores/window'
import { initGameModeSync } from '../lib/game-mode-sync'
import { useTrackActionsStore } from '../stores/track-actions'

// 订阅主窗口状态；播放命令由播放运行时接收。
export function useDesktopBridge(): void {
  useEffect(() => {
    const d = window.desktop
    if (!d) return

    const offState = d.onStateChange((state) => useWindowStore.getState().setState(state))
    const independentPlayback = typeof d.playbackRequest === 'function'
    const stopGameMode = independentPlayback ? initGameModeSync() : undefined
    const offAddToPlaylist = d.onMiniPlayerAddToPlaylist?.((track) => {
      useTrackActionsStore.getState().openQuickAdd(track, {
        x: window.innerWidth / 2 - 140,
        y: window.innerHeight / 2 - 180,
        width: 0,
        height: 0
      })
    })

    // 初始拉一次窗口状态
    void d.getState().then((state) => useWindowStore.getState().setState(state))

    return () => {
      offState()
      stopGameMode?.()
      offAddToPlaylist?.()
    }
  }, [])
}

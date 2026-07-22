import { useEffect } from 'react'
import { useWindowStore } from '../stores/window'
import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'

// 订阅主进程推送（窗口状态 / 全局快捷键），写入对应 store。
export function useDesktopBridge(): void {
  useEffect(() => {
    const d = window.desktop
    if (!d) return

    const offState = d.onStateChange((state) => useWindowStore.getState().setState(state))

    // 初始拉一次窗口状态
    void d.getState().then((state) => useWindowStore.getState().setState(state))

    const offHotkey = d.onHotkey(({ action }) => {
      const player = usePlayerStore.getState()
      const playlist = usePlaylistStore.getState()
      switch (action) {
        case 'play-pause':
          player.toggle()
          break
        case 'next':
          playlist.next()
          break
        case 'prev':
          playlist.prev()
          break
        case 'volume-up':
          player.setVolume(Math.min(1, player.volume + 0.05))
          break
        case 'volume-down':
          player.setVolume(Math.max(0, player.volume - 0.05))
          break
        default:
          break
      }
    })

    const offMiniPlayerControl = d.onMiniPlayerControl(({ action, value }) => {
      const player = usePlayerStore.getState()
      const playlist = usePlaylistStore.getState()
      switch (action) {
        case 'play-pause':
          player.toggle()
          break
        case 'next':
          playlist.next()
          break
        case 'prev':
          playlist.prev()
          break
        case 'seek':
          if (typeof value === 'number') player.seek(value)
          break
        case 'volume':
          if (typeof value === 'number') player.setVolume(Math.min(1, Math.max(0, value)))
          break
        case 'sync-off':
          // 主进程已自行收起迷你条(回到大播放器/退居托盘),这里只把设置开关落回,勿再回调主进程
          useSettingsStore.getState().setMiniPlayerEnabled(false)
          break
        default:
          break
      }
    })

    return () => {
      offState()
      offHotkey()
      offMiniPlayerControl()
    }
  }, [])
}

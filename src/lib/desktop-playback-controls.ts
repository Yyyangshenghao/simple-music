import { usePlayerStore } from '../stores/player'
import { stepPlayback } from './playback-controls'
import { useSettingsStore } from '../stores/settings'
import { useVisualStore } from '../stores/visual'

let stopDesktopControls: (() => void) | undefined

/** 托盘与迷你条共用主进程命令通道，不依赖 React 界面监听。 */
export function initDesktopPlaybackControls(): () => void {
  if (stopDesktopControls) return stopDesktopControls
  const desktop = window.desktop
  if (!desktop) return () => {}
  let disposed = false
  const offControls = desktop.onMiniPlayerControl(({ action, value }) => {
    if (disposed) return
    const player = usePlayerStore.getState()
    switch (action) {
      case 'play-pause':
        player.toggle()
        break
      case 'next':
        stepPlayback(1)
        break
      case 'prev':
        stepPlayback(-1)
        break
      case 'seek':
        if (typeof value === 'number') player.seek(value)
        break
      case 'volume':
        if (typeof value === 'number') player.setVolume(Math.min(1, Math.max(0, value)))
        break
      case 'volume-up':
        player.setVolume(Math.min(1, player.volume + 0.05))
        break
      case 'volume-down':
        player.setVolume(Math.max(0, player.volume - 0.05))
        break
      case 'desktop-lyrics': {
        const visual = useVisualStore.getState()
        visual.updateFx({ desktopLyrics: !visual.fx.desktopLyrics })
        break
      }
      case 'sync-off':
        // 主进程已收起迷你条，只落回设置，不再次回调主进程。
        useSettingsStore.getState().setMiniPlayerEnabled(false)
        break
    }
  })
  stopDesktopControls = () => {
    if (disposed) return
    disposed = true
    offControls()
    stopDesktopControls = undefined
  }
  return stopDesktopControls
}

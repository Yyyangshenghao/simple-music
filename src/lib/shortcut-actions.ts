import { usePlayerStore } from '../stores/player'
import { stepPlayback } from './playback-controls'
import { useLikesStore } from '../stores/likes'
import { useVisualStore } from '../stores/visual'
import { useSettingsStore } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import { useNavigationStore } from '../stores/navigation'
import { useGameModeStore } from '../stores/game-mode'
import type { ShortcutAction } from './shortcuts'

/** 应用内与全局快捷键共用播放器原有动作，保留各音源的播放和红心边界。 */
export function runShortcutAction(action: ShortcutAction): void {
  const player = usePlayerStore.getState()
  switch (action) {
    case 'settings': {
      if (useGameModeStore.getState().enabled) {
        void useGameModeStore.getState().configure({ enabled: false })
      }
      const navigation = useNavigationStore.getState()
      if (navigation.currentView !== 'settings') navigation.navigateTo('settings')
      break
    }
    case 'play-pause':
      player.toggle()
      break
    case 'prev':
      stepPlayback(-1)
      break
    case 'next':
      stepPlayback(1)
      break
    case 'volume-up':
      player.setVolume(Math.min(1, player.volume + 0.05))
      break
    case 'volume-down':
      player.setVolume(Math.max(0, player.volume - 0.05))
      break
    case 'like': {
      const track = player.currentTrack
      const likes = useLikesStore.getState()
      if (!track) return
      if (!likes.supports(track)) {
        useToastStore.getState().show('当前歌曲暂不支持喜欢，请检查音源与登录状态')
        return
      }
      void likes.ensureChecked(track).then(() => {
        if (usePlayerStore.getState().currentTrack === track) return likes.toggleLike(track)
      }).catch(() => useToastStore.getState().show('喜欢歌曲失败，请稍后重试'))
      break
    }
    case 'desktop-lyrics': {
      const visual = useVisualStore.getState()
      visual.updateFx({ desktopLyrics: !visual.fx.desktopLyrics })
      break
    }
    case 'mini-player': {
      const settings = useSettingsStore.getState()
      const enabled = !settings.miniPlayerEnabled
      settings.setMiniPlayerEnabled(enabled)
      void window.desktop?.setMiniPlayerEnabled(enabled, settings.miniPlayerWidth)
      break
    }
  }
}

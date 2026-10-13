import { startPlaybackCore, flushListeningReports } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { initProviderStore } from '../stores/providers'
import { initProviderAuthFailureSync } from '../stores/provider-auth'
import { initRecentPlaysTracking } from '../stores/recent'
import { initPlaybackPersistence } from './playback-persistence'
import { initMediaSession } from './media-session'
import { initTraySync } from './tray-sync'
import { initDesktopPlaybackControls } from './desktop-playback-controls'
import { initGlobalShortcuts } from './global-shortcuts'
import { initGameModeSync } from './game-mode-sync'
import { initMiniPlayerSync } from './mini-player-sync'
import { useGameModeStore } from '../stores/game-mode'
import { initLyricsClock } from './lyrics-clock'
import { initLyricsLoader } from './lyrics-loader'
import { initDesktopLyricsSync } from './desktop-lyrics-sync'

let stopRuntime: (() => void) | undefined

/** 每个渲染宿主只启动一次；React 挂载/卸载不拥有播放生命周期，释放后不重启该核心。 */
export function startPlaybackRuntime(): () => void {
  if (stopRuntime) return stopRuntime
  useSettingsStore.getState().loadFromLocal()
  const stopProviders = initProviderStore()
  const stopAuth = initProviderAuthFailureSync()
  const stopCore = startPlaybackCore()
  const stopRecent = initRecentPlaysTracking()
  const stopPersistence = initPlaybackPersistence()
  const stopLyricsClock = initLyricsClock()
  const stopLyricsLoader = initLyricsLoader()
  const stopDesktopLyrics = initDesktopLyricsSync()
  const stopDesktopControls = initDesktopPlaybackControls()
  const stopShortcuts = initGlobalShortcuts()
  const stopMiniPlayer = initMiniPlayerSync()
  const stopGameMode = initGameModeSync(() => {
    // 开窗 IPC 会退出游戏模式；只有初值先完成且期间没有模式广播时恢复一次。
    const { miniPlayerEnabled, miniPlayerWidth } = useSettingsStore.getState()
    if (miniPlayerEnabled && !useGameModeStore.getState().enabled) void window.desktop?.setMiniPlayerEnabled(true, miniPlayerWidth).catch(() => {})
  })
  // 初始展示读取已经恢复的暂停态，不先向系统发布空状态。
  const stopTray = initTraySync()
  const stopMedia = initMediaSession()
  const stopListeningFlush = window.desktop?.onFlushListeningReports(flushListeningReports)
  let stopped = false
  stopRuntime = () => {
    if (stopped) return
    stopped = true
    // 最后存档在音频与会话释放前完成；取消待写定时器，避免退出后回写。
    stopPersistence()
    stopRecent()
    stopLyricsLoader()
    stopLyricsClock()
    stopDesktopLyrics()
    stopMiniPlayer()
    stopGameMode()
    stopDesktopControls()
    stopShortcuts()
    stopTray()
    stopMedia()
    stopListeningFlush?.()
    stopCore()
    stopAuth()
    stopProviders()
  }
  return stopRuntime
}

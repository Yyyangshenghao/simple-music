import { startPlaybackCore, flushListeningReports } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { initProviderStore } from '../stores/providers'
import { initProviderAuthFailureSync } from '../stores/provider-auth'
import { initRecentPlaysTracking } from '../stores/recent'
import { initPlaybackPersistence } from './playback-persistence'
import { initMediaSession } from './media-session'
import { initTraySync } from './tray-sync'

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
    stopTray()
    stopMedia()
    stopListeningFlush?.()
    stopCore()
    stopAuth()
    stopProviders()
  }
  return stopRuntime
}

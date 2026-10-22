import type { StoreApi } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useShuangeStore } from '../stores/shuange'
import { useSleepTimerStore } from '../stores/sleep-timer'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { useLyricsStore } from '../stores/lyrics'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { useRecentPlaysStore } from '../stores/recent'
import { useLikesStore } from '../stores/likes'
import { useAppleMusicConnection } from '../stores/apple-music-connection'
import { useVisualStore } from '../stores/visual'
import { useAmbientStore } from '../stores/ambient'
import { useShortcutStore } from '../stores/shortcuts'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { runShortcutAction } from './shortcut-actions'
import { isShortcutAction } from './shortcuts'
import { completeMusicProviderLogin } from './provider-login'
import { logoutMusicProvider } from './provider-logout'
import { expireProviderAccount } from '../stores/provider-auth'
import { providerAccountSession } from './provider-account-session'
import { isProviderId } from '../providers/types'
import { setPlaybackShortcutBlocked } from './playback-host-observation'

export type PlaybackStore = StoreApi<Record<string, unknown>>

// 只在后台启动这些 store 的副作用；主界面保留同样的 hook 作为只读投影。
export const playbackStores = {
  player: usePlayerStore, playlist: usePlaylistStore, shuange: useShuangeStore,
  sleep: useSleepTimerStore, settings: useSettingsStore, providers: useProviderStore,
  lyrics: useLyricsStore, lyricSources: useLyricsSourceStore, downloads: useOfflineCacheStore, recent: useRecentPlaysStore,
  likes: useLikesStore, apple: useAppleMusicConnection, visual: useVisualStore,
  ambient: useAmbientStore, shortcuts: useShortcutStore, navigation: useNavigationStore,
  toast: useToastStore,
  controls: createStore(() => ({
    cancelLyricsSelection() {
      const state = useLyricsSourceStore.getState()
      if (state.candidateToken) state.cancelSelection(state.candidateToken)
    },
    shortcut(action: unknown) {
      if (typeof action !== 'string' || !isShortcutAction(action)) throw new Error('不支持的快捷键命令')
      runShortcutAction(action)
    },
    setShortcutBlocked(blocked: unknown) { setPlaybackShortcutBlocked(blocked === true) },
    loginCookie(source: unknown, cookie: unknown) {
      if ((source !== 'netease' && source !== 'qq') || typeof cookie !== 'string') throw new Error('无效的登录参数')
      return completeMusicProviderLogin(source, cookie)
    },
    logout(source: unknown) {
      if (source !== 'netease' && source !== 'qq') throw new Error('无效的音源')
      return logoutMusicProvider(source)
    },
    expireAccount(source: unknown, message: unknown, epoch: unknown) {
      if (!isProviderId(source) || typeof message !== 'string' || epoch !== providerAccountSession(source)) return
      expireProviderAccount(source, new Error(message))
    },
  })),
} as unknown as Record<string, PlaybackStore>

// 显式命令白名单，不允许通过 IPC 调用引擎、存档恢复或任意对象属性。
export const remoteActions: Record<string, readonly string[]> = {
  player: ['play', 'pause', 'stop', 'toggle', 'seek', 'setVolume', 'setQuality', 'setRate', 'loadTrack', 'preferSourceOnce'],
  playlist: ['loadUserPlaylists', 'setCurrentPlaylist', 'setQueue', 'clearQueue', 'addToQueue', 'addManyToQueue', 'moveQueueItem', 'playNextInQueue', 'removeQueueItem', 'ensureQueueDetails', 'playAt', 'next', 'prev', 'toggleShelf', 'setShelfMode'],
  shuange: ['enter', 'refresh', 'leave', 'next', 'prev', 'playFullCurrent', 'notInterestedCurrent', 'toggleLike', 'loadIndex'],
  sleep: ['start', 'setFinishTrack', 'cancel'],
  settings: ['setHotkeys', 'setLocalHotkeys', 'setGlobalHotkeysEnabled', 'setMediaKeysEnabled', 'resetShortcuts', 'setNeteaseLoggedIn', 'setQQLoggedIn', 'setNeteaseProfile', 'setQQProfile', 'setShelfShowPodcasts', 'setShelfMergeCollections', 'setLiveBackgroundKeep', 'setLyricsPanelMode', 'setLyrics3dEffect', 'setLyrics3dStyle', 'setLyricsOverlayBlur', 'setLyricsStage3d', 'setLyrics3dParams', 'resetLyrics3dParams', 'setLyricsFontScale', 'setLyricsLayout', 'resetLyricsLayout', 'setLyricsShowTranslation', 'setLyricsShowRoma', 'setLyricsAmllFallback', 'setLyricsKugouFallback', 'setLyricsGuestSource', 'setLyricsAmllHost', 'setLyricsPlayerStyle', 'setThemeMode', 'setContentLayout', 'setContentGutter', 'setAudioQuality', 'setPlayMode', 'setFontFamily', 'setFontFamilyCjk', 'setLyricsFontFamily', 'setLyricsFontFamilyCjk', 'setLyrics3dFontFamily', 'setLyrics3dFontFamilyCjk', 'setPerformance', 'applyPerformancePreset', 'setMiniPlayerEnabled', 'setMiniPlayerWidth', 'setMiniPlayerAppearance'],
  providers: ['setEnabled', 'setPlaybackOrder', 'setPreferOriginSource', 'setMultiSourceFallback', 'setSourceBadgeMode', 'setContentSource', 'setAccountState', 'setPlaybackAvailability'],
  lyrics: ['setOffsetSec', 'updateLayout', 'setDesktopLyricsEnabled'],
  lyricSources: ['queryCandidates', 'cancelSelection', 'chooseSource', 'setDefaultSource', 'clearRemembered'],
  downloads: ['ensure', 'ensureMany', 'save', 'saveMany', 'setPaused', 'setQueueOpen', 'loadDownloadDir', 'setDownloadDir', 'setPinned', 'deleteLocal', 'cancelSave', 'dismissJob', 'invalidate'],
  recent: ['clear'], likes: ['ensureChecked', 'toggleLike', 'resolveUnlike'],
  apple: ['refresh', 'connect', 'disconnect'],
  visual: ['setPreset', 'updateFx', 'setPerformanceMode', 'setBackgroundMode', 'loadArchive'],
  ambient: [], shortcuts: ['setRecording'],
  navigation: ['navigateTo', 'updateArtistPageState', 'updateSearchPageState', 'requestSettingsMusic', 'consumeSettingsMusicRequest', 'requestSettingsLyrics', 'consumeSettingsLyricsRequest', 'goBack', 'goForward'],
  toast: ['show', 'dismiss'],
  controls: ['shortcut', 'setShortcutBlocked', 'loginCookie', 'logout', 'expireAccount', 'cancelLyricsSelection'],
}

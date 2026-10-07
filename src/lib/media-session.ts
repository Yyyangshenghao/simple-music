import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

/** 系统媒体集成:向 macOS 控制中心/媒体键/耳机线控暴露曲目信息与播放控制。 */

const POSITION_SYNC_MS = 1000

function updateMetadata(track: Track | null): void {
  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.name,
    artist: track.artist,
    album: typeof track.album === 'string' ? track.album : undefined,
    artwork: track.cover ? [{ src: track.cover }] : []
  })
}

function syncPositionState(): void {
  const { currentTrack, position, duration, status, rate } = usePlayerStore.getState()
  navigator.mediaSession.playbackState = !currentTrack ? 'none'
    : status === 'playing' || status === 'loading' ? 'playing' : 'paused'
  try {
    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) {
      navigator.mediaSession.setPositionState()
      return
    }
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: rate
    })
  } catch {
    /* 参数瞬时越界(切歌间隙)时忽略 */
  }
}

let initialized = false

/** 启动时调用一次;环境不支持 mediaSession 时静默跳过。 */
export function initMediaSession(): void {
  if (initialized || !('mediaSession' in navigator)) return
  initialized = true

  const ms = navigator.mediaSession
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => usePlayerStore.getState().play(),
    pause: () => usePlayerStore.getState().pause(),
    previoustrack: () => usePlaylistStore.getState().prev(),
    nexttrack: () => usePlaylistStore.getState().next(),
    stop: () => {
      usePlayerStore.getState().pause()
      usePlayerStore.getState().seek(0)
    },
    seekto: (d) => {
      if (typeof d.seekTime === 'number') usePlayerStore.getState().seek(d.seekTime)
    }
  }
  const applyEnabled = () => {
    const enabled = useSettingsStore.getState().mediaKeysEnabled
    for (const action of Object.keys(handlers) as MediaSessionAction[]) {
      const handler = handlers[action]!
      try {
        // 部分平台不支持 stop 等动作；不影响其他媒体键。
        // null 会恢复浏览器对 HTML audio 的默认控制，关闭时用空处理器阻止默认播放。
        ms.setActionHandler(action, (details) => {
          if (useSettingsStore.getState().mediaKeysEnabled) handler(details)
        })
      } catch { /* unsupported action */ }
    }
    if (enabled) {
      updateMetadata(usePlayerStore.getState().currentTrack)
      syncPositionState()
    } else {
      ms.metadata = null
      ms.playbackState = 'none'
    }
  }
  applyEnabled()
  useSettingsStore.subscribe((state, previous) => {
    if (state.mediaKeysEnabled !== previous.mediaKeysEnabled) applyEnabled()
  })

  let lastPositionSync = 0
  usePlayerStore.subscribe((s, prev) => {
    if (!useSettingsStore.getState().mediaKeysEnabled) return
    if (s.currentTrack !== prev.currentTrack) updateMetadata(s.currentTrack)
    if (s.currentTrack !== prev.currentTrack || s.status !== prev.status || s.duration !== prev.duration) {
      syncPositionState()
      lastPositionSync = Date.now()
      return
    }
    if (s.position !== prev.position && Date.now() - lastPositionSync >= POSITION_SYNC_MS) {
      syncPositionState()
      lastPositionSync = Date.now()
    }
  })
}

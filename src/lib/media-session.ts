import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
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
  const { position, duration, status } = usePlayerStore.getState()
  if (!Number.isFinite(duration) || duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1
    })
  } catch {
    /* 参数瞬时越界(切歌间隙)时忽略 */
  }
  navigator.mediaSession.playbackState = status === 'playing' || status === 'loading' ? 'playing' : 'paused'
}

let initialized = false

/** 启动时调用一次;环境不支持 mediaSession 时静默跳过。 */
export function initMediaSession(): void {
  if (initialized || !('mediaSession' in navigator)) return
  initialized = true

  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => usePlayerStore.getState().play())
  ms.setActionHandler('pause', () => usePlayerStore.getState().pause())
  ms.setActionHandler('previoustrack', () => usePlaylistStore.getState().prev())
  ms.setActionHandler('nexttrack', () => usePlaylistStore.getState().next())
  ms.setActionHandler('seekto', (d) => {
    if (typeof d.seekTime === 'number') usePlayerStore.getState().seek(d.seekTime)
  })

  // 恢复态启动时先同步一次,之后跟随 store 变化
  updateMetadata(usePlayerStore.getState().currentTrack)
  syncPositionState()

  let lastPositionSync = 0
  usePlayerStore.subscribe((s, prev) => {
    if (s.currentTrack !== prev.currentTrack) updateMetadata(s.currentTrack)
    if (s.status !== prev.status || s.duration !== prev.duration) {
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

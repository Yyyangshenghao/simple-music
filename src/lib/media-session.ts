import { usePlayerStore } from '../stores/player'
import { stepPlayback } from './playback-controls'
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

let stopMediaSession: (() => void) | undefined

/** 由播放宿主启停；环境不支持 mediaSession 时静默跳过。 */
export function initMediaSession(): () => void {
  if (stopMediaSession) return stopMediaSession
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => {}

  const ms = navigator.mediaSession
  let stopped = false
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => usePlayerStore.getState().play(),
    pause: () => usePlayerStore.getState().pause(),
    previoustrack: () => stepPlayback(-1),
    nexttrack: () => stepPlayback(1),
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
          if (!stopped && useSettingsStore.getState().mediaKeysEnabled) handler(details)
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
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.mediaKeysEnabled !== previous.mediaKeysEnabled) applyEnabled()
  })

  let lastPositionSync = 0
  const stopPlayer = usePlayerStore.subscribe((s, prev) => {
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
  stopMediaSession = () => {
    if (stopped) return
    stopped = true
    stopSettings()
    stopPlayer()
    for (const action of Object.keys(handlers) as MediaSessionAction[]) {
      try { ms.setActionHandler(action, null) } catch { /* unsupported action */ }
    }
    ms.metadata = null
    ms.playbackState = 'none'
    try { ms.setPositionState() } catch { /* unsupported position state */ }
    stopMediaSession = undefined
  }
  return stopMediaSession
}

import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import type { Track } from '../types/domain'

/** 播放状态持久化:队列/当前曲/进度/音量落 localStorage,重启恢复为暂停态断点续播。 */

const STORAGE_KEY = 'simplemusic-playback'
/** 播放中进度落盘的最小间隔。 */
const POSITION_SAVE_MS = 5000

interface PersistedPlayback {
  queue: Track[]
  queueIndex: number
  /** 秒。 */
  position: number
  volume: number
}

/** 序列化时剥掉已过期的解析 URL;播放时会重新走 getTrackUrl。 */
function stripUrl(track: Track): Track {
  if (!track.url) return track
  const { url: _url, ...rest } = track
  return rest as Track
}

/** 兜底占位:仅保留恢复播放必需字段(QQ 需要 mid),体积最小。 */
function toPlaceholder(track: Track): Track {
  return {
    provider: track.provider,
    source: track.source,
    type: track.type,
    id: track.id,
    name: track.name,
    artist: track.artist,
    artists: [],
    duration: track.duration,
    cover: track.cover,
    mid: track.mid,
    pending: true
  }
}

export function savePlayback(): void {
  if (typeof localStorage === 'undefined') return
  const { queue, queueIndex } = usePlaylistStore.getState()
  const { position, volume } = usePlayerStore.getState()
  const data: PersistedPlayback = { queue: queue.map(stripUrl), queueIndex, position, volume }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 超出配额:降级为占位曲目(仅 id 等必需字段),恢复后播到再补详情
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, queue: queue.map(toPlaceholder) }))
    } catch {
      /* 仍失败则放弃本次落盘 */
    }
  }
}

export function restorePlayback(): void {
  if (typeof localStorage === 'undefined') return
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  let data: Partial<PersistedPlayback>
  try {
    data = JSON.parse(raw) as Partial<PersistedPlayback>
  } catch {
    return
  }
  const volume = typeof data.volume === 'number' ? Math.max(0, Math.min(1, data.volume)) : null
  if (volume != null) usePlayerStore.setState({ volume })

  const queue = Array.isArray(data.queue) ? data.queue : []
  const queueIndex = typeof data.queueIndex === 'number' ? data.queueIndex : -1
  const track = queue[queueIndex]
  if (!track) return
  usePlaylistStore.setState({ queue, queueIndex, shuffleOrder: [] })
  const position = typeof data.position === 'number' && data.position > 0 ? data.position : 0
  // 恢复为暂停态:不解析 URL 不自动播;点播放时 player.play() 检测到引擎无源,按断点重新加载
  usePlayerStore.setState({
    currentTrack: track,
    source: track.source,
    status: 'paused',
    position,
    duration: (track.duration ?? 0) / 1000
  })
}

let timer: ReturnType<typeof setTimeout> | null = null
let timerDeadline = Infinity

/** 合并落盘:已有更早的待写任务则跳过,避免高频事件抖动。 */
function scheduleSave(delayMs: number): void {
  const deadline = Date.now() + delayMs
  if (timer != null && timerDeadline <= deadline) return
  if (timer != null) clearTimeout(timer)
  timerDeadline = deadline
  timer = setTimeout(() => {
    timer = null
    timerDeadline = Infinity
    savePlayback()
  }, delayMs)
}

let initialized = false

/** 启动时调用:恢复上次播放状态,并订阅后续变化持续落盘。重复调用无效果(防 StrictMode 双跑)。 */
export function initPlaybackPersistence(): void {
  if (initialized) return
  initialized = true
  restorePlayback()

  usePlayerStore.subscribe((s, prev) => {
    if (s.status === 'paused' && prev.status === 'playing') scheduleSave(0)
    else if (s.volume !== prev.volume) scheduleSave(800)
    else if (s.status === 'playing' && s.position !== prev.position) scheduleSave(POSITION_SAVE_MS)
  })
  usePlaylistStore.subscribe((s, prev) => {
    if (s.queue !== prev.queue || s.queueIndex !== prev.queueIndex) scheduleSave(500)
  })
  window.addEventListener('beforeunload', savePlayback)
}

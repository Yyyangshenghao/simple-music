import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import type { Track } from '../types/domain'
import { isValidPermutation } from './queue-display'

/** 播放状态持久化:队列/当前曲/进度/音量落 localStorage,重启恢复为暂停态断点续播。 */

export const PLAYBACK_STORAGE_KEY = 'simplemusic-playback'
export const PLAYBACK_STORAGE_SCHEMA = 2
/** 播放中进度落盘的最小间隔。 */
const POSITION_SAVE_MS = 5000

interface PersistedPlayback {
  schema: typeof PLAYBACK_STORAGE_SCHEMA
  queue: Track[]
  queueIndex: number
  shuffleOrder?: number[]
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

// store 使用不可变队列；只保留当前队列的序列化结果，进度落盘复用它。
let serializedQueue: {
  queue: Track[]
  full: string
  compact?: string
} | null = null
let serializedOrder: { order: number[]; length: number; json?: string } | null = null

export function savePlayback(): void {
  if (typeof localStorage === 'undefined') return
  const { queue, queueIndex, shuffleOrder } = usePlaylistStore.getState()
  const { position, volume } = usePlayerStore.getState()
  const data = {
    schema: PLAYBACK_STORAGE_SCHEMA,
    queueIndex,
    position,
    volume,
  }
  try {
    if (serializedQueue?.queue !== queue) {
      serializedQueue = { queue, full: JSON.stringify(queue.map(stripUrl)) }
    }
    if (serializedOrder?.order !== shuffleOrder || serializedOrder.length !== queue.length) {
      serializedOrder = {
        order: shuffleOrder,
        length: queue.length,
        json: isValidPermutation(shuffleOrder, queue.length) ? JSON.stringify(shuffleOrder) : undefined
      }
    }
    const fields = JSON.stringify(data).slice(0, -1)
    const orderField = serializedOrder.json ? `,"shuffleOrder":${serializedOrder.json}` : ''
    const serialize = (queueJson: string) => `${fields},"queue":${queueJson}${orderField}}`
    try {
      localStorage.setItem(PLAYBACK_STORAGE_KEY, serialize(serializedQueue.full))
    } catch {
      // 超出配额时保留原有占位降级；同一队列不重复序列化。
      serializedQueue.compact ??= JSON.stringify(queue.map(toPlaceholder))
      localStorage.setItem(PLAYBACK_STORAGE_KEY, serialize(serializedQueue.compact))
    }
  } catch {
    /* 序列化或占位落盘仍失败则放弃本次保存 */
  }
}

export function restorePlayback(): void {
  if (typeof localStorage === 'undefined') return
  const raw = localStorage.getItem(PLAYBACK_STORAGE_KEY)
  if (!raw) return
  let data: Partial<PersistedPlayback>
  try {
    data = JSON.parse(raw) as Partial<PersistedPlayback>
  } catch {
    return
  }
  if (data.schema !== undefined && data.schema !== PLAYBACK_STORAGE_SCHEMA) return
  const volume = typeof data.volume === 'number' && Number.isFinite(data.volume)
    ? Math.max(0, Math.min(1, data.volume))
    : null
  if (volume != null) usePlayerStore.setState({ volume })

  const rawQueue = Array.isArray(data.queue) ? data.queue : []
  const rawQueueIndex = typeof data.queueIndex === 'number' && Number.isInteger(data.queueIndex)
    ? data.queueIndex
    : -1
  const rawTrack = rawQueue[rawQueueIndex]
  const queue = rawQueue.filter((track): track is Track => {
    if (!track || typeof track !== 'object') return false
    if (track.source !== 'netease' && track.source !== 'qq' && track.source !== 'apple' && track.source !== 'local') return false
    return track.provider === track.source
      && track.id !== undefined
      && track.id !== null
      && typeof track.type === 'string'
      && typeof track.name === 'string'
      && typeof track.artist === 'string'
      && Array.isArray(track.artists)
  })
  const queueIndex = queue.indexOf(rawTrack as Track)
  const track = queue[queueIndex]
  if (!track) return
  const shuffleOrder = rawQueue.length === queue.length
    && Array.isArray(data.shuffleOrder)
    && isValidPermutation(data.shuffleOrder, queue.length)
    ? data.shuffleOrder : []
  usePlaylistStore.setState({ queue, queueIndex, queueContextId: null, shuffleOrder })
  const position = typeof data.position === 'number' && data.position > 0 ? data.position : 0
  // 恢复为暂停态:不解析 URL 不自动播;点播放时 player.play() 检测到引擎无源,按断点重新加载
  usePlayerStore.setState({
    currentTrack: track,
    source: track.source,
    actualSource: null,
    resolvedTrack: null,
    resolution: null,
    playbackAttempts: [],
    currentQuality: null,
    contextId: null,
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
    if (s.queue !== prev.queue || s.queueIndex !== prev.queueIndex || s.shuffleOrder !== prev.shuffleOrder) scheduleSave(500)
  })
  window.addEventListener('beforeunload', savePlayback)
}

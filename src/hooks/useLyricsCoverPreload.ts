import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { getQueueStep } from '../lib/queue-state'
import { LYRICS_COVER_PX } from '../lib/image-size'
import { preloadTracks, releasePreloadWindow } from '../lib/track-preload'
import type { PlayMode, Track } from '../types/domain'

interface QueueWindowState {
  queue: Track[]
  queueIndex: number
  shuffleOrder: number[]
}

/**
 * 歌词页切上/下一首时会立刻展示的相邻曲目；刷歌上下文的队列不是实际走序，不预热邻居。
 *
 * @param state 播放队列
 * @param playMode 当前播放模式
 * @param contextId 当前播放上下文
 */
export function lyricsCoverNeighbors(state: QueueWindowState, playMode: PlayMode, contextId: unknown): Track[] {
  if (String(contextId ?? '').startsWith('shuange:')) return []
  const { queue, queueIndex, shuffleOrder } = state
  if (queueIndex < 0 || queue.length < 2) return []
  // 洗牌序失效时 getQueueStep 会临时生成随机序，与宿主真实走序对不上，宁可不预热
  if (playMode === 'shuffle' && shuffleOrder.length !== queue.length) return []
  const targets: Track[] = []
  for (const dir of [1, -1] as const) {
    const t = queue[getQueueStep(state, playMode, dir).index]
    if (t && t !== queue[queueIndex] && !targets.includes(t)) targets.push(t)
  }
  return targets
}

/**
 * 预热歌词页大尺寸封面：当前曲目与前后曲目各一张，打开歌词页或在页内切歌时不再出现空白封面。
 * 播放队列跑在隐藏的播放宿主里，宿主不预热图片，所以由可见界面按歌词页尺寸单独维护一个窗口。
 *
 * @param enabled 主窗口可见且未进入游戏模式
 */
export function useLyricsCoverPreload(enabled: boolean): void {
  const current = usePlayerStore((s) => s.currentTrack)
  const contextId = usePlayerStore((s) => s.contextId)
  const queue = usePlaylistStore((s) => s.queue)
  const queueIndex = usePlaylistStore((s) => s.queueIndex)
  const shuffleOrder = usePlaylistStore((s) => s.shuffleOrder)
  const playMode = useSettingsStore((s) => s.playMode)
  useEffect(() => {
    if (!enabled) {
      releasePreloadWindow('lyrics')
      return
    }
    const neighbors = lyricsCoverNeighbors({ queue, queueIndex, shuffleOrder }, playMode, contextId)
    preloadTracks(neighbors, 'standard', current, { owner: 'lyrics', coverPx: LYRICS_COVER_PX, deferUrls: true })
  }, [enabled, current, contextId, queue, queueIndex, shuffleOrder, playMode])
  useEffect(() => () => releasePreloadWindow('lyrics'), [])
}

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { getQueueStep } from '../lib/queue-state'
import { DOCK_COVER_PX, LYRICS_COVER_PX } from '../lib/image-size'
import { preloadTracks, releasePreloadWindow } from '../lib/track-preload'
import type { PlayMode, Track } from '../types/domain'

/** 播放栏小图在前（高优先级），歌词页大图在后（低优先级）。 */
const COVER_SIZES = [DOCK_COVER_PX, LYRICS_COVER_PX]
/** 与宿主相邻预载一致：切歌落定后再取邻居，不和当前曲目的封面与起播抢网络。 */
const NEIGHBOR_DELAY_MS = 1000

interface QueueWindowState {
  queue: Track[]
  queueIndex: number
  shuffleOrder: number[]
}

function sameTrack(a: Track, b: Track | undefined): boolean {
  return !!b && a.source === b.source && String(a.id) === String(b.id) && a.cover === b.cover
}

/**
 * 切上/下一首时会立刻展示的相邻曲目；刷歌上下文的队列不是实际走序，不预热邻居。
 *
 * @param state 播放队列
 * @param playMode 当前播放模式
 * @param contextId 当前播放上下文
 */
export function nowPlayingNeighbors(state: QueueWindowState, playMode: PlayMode, contextId: unknown): Track[] {
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
 * 预热播放栏与歌词页封面：当前曲目立即取，前后曲目延后取，切歌或打开歌词页时不再出现空白封面。
 * 播放队列跑在隐藏的播放宿主里，宿主不预热图片，所以由可见界面单独维护一个窗口。
 *
 * @param enabled 主窗口可见且未进入游戏模式
 */
export function useNowPlayingCoverPreload(enabled: boolean): void {
  const current = usePlayerStore((s) => s.currentTrack)
  const contextId = usePlayerStore((s) => s.contextId)
  const queue = usePlaylistStore((s) => s.queue)
  const queueIndex = usePlaylistStore((s) => s.queueIndex)
  const shuffleOrder = usePlaylistStore((s) => s.shuffleOrder)
  const playMode = useSettingsStore((s) => s.playMode)
  // 已预热的邻居；队列快照换了引用但邻居没变时直接沿用，不清掉再重取
  const warmedRef = useRef<Track[]>([])
  useEffect(() => {
    if (!enabled) {
      warmedRef.current = []
      releasePreloadWindow('nowPlaying')
      return
    }
    const options = { owner: 'nowPlaying' as const, coverPx: COVER_SIZES, deferUrls: true }
    const neighbors = nowPlayingNeighbors({ queue, queueIndex, shuffleOrder }, playMode, contextId)
    const warmed = warmedRef.current
    if (neighbors.length === warmed.length && neighbors.every((t, i) => sameTrack(t, warmed[i]))) {
      preloadTracks(neighbors, 'standard', current, options)
      return
    }
    // 先只保留当前曲目；邻居等切歌落定后补上，快速连点只保留最后一次
    warmedRef.current = []
    preloadTracks([], 'standard', current, options)
    if (!neighbors.length) return
    const timer = setTimeout(() => {
      warmedRef.current = neighbors
      preloadTracks(neighbors, 'standard', current, options)
    }, NEIGHBOR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, current, contextId, queue, queueIndex, shuffleOrder, playMode])
  useEffect(() => () => releasePreloadWindow('nowPlaying'), [])
}

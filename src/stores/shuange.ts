import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { computeHighlightOffset, type HighlightRange } from '../lib/highlight-offset'
import { usePlayerStore } from './player'
import { usePlaylistStore } from './playlist'
import { useNavigationStore } from './navigation'
import type { Track } from '../types/domain'

const CLIP_SEC = 20
const OFFSET_CACHE_MAX = 200

interface ShuangeSnapshot {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  queueContextId: unknown
  position: number
  volume: number
}

interface ShuangeStore {
  active: boolean
  feed: Track[]
  index: number
  offset: HighlightRange | null
  loading: boolean
  error: string | null
  enter(): Promise<void>
  leave(): void
  next(): Promise<void>
  prev(): Promise<void>
  playFullCurrent(): void
  loadIndex(i: number): Promise<void>
}

const offsetCache = new Map<string, HighlightRange>()
function cacheKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}
function rememberOffset(key: string, range: HighlightRange): void {
  if (offsetCache.has(key)) offsetCache.delete(key) // 重新插到末尾,保 LRU 顺序
  offsetCache.set(key, range)
  while (offsetCache.size > OFFSET_CACHE_MAX) {
    const first = offsetCache.keys().next().value
    if (first === undefined) break
    offsetCache.delete(first)
  }
}

async function ensureOffset(track: Track): Promise<HighlightRange> {
  const key = cacheKey(track)
  const cached = offsetCache.get(key)
  if (cached) return cached
  let range: HighlightRange
  try {
    const lines = await serviceFor(track.source).getLyrics(track)
    range = computeHighlightOffset(lines ?? [], track.duration ?? 0, CLIP_SEC)
  } catch {
    range = computeHighlightOffset([], track.duration ?? 0, CLIP_SEC)
  }
  rememberOffset(key, range)
  return range
}

let snapshot: ShuangeSnapshot | null = null

function takeSnapshot(): ShuangeSnapshot {
  const p = usePlayerStore.getState()
  const pl = usePlaylistStore.getState()
  return {
    currentTrack: p.currentTrack ?? null,
    queue: pl.queue,
    queueIndex: pl.queueIndex,
    queueContextId: pl.queueContextId,
    position: p.position ?? 0,
    volume: p.volume ?? 0.8,
  }
}

export const useShuangeStore = create<ShuangeStore>((set, get) => ({
  active: false,
  feed: [],
  index: -1,
  offset: null,
  loading: false,
  error: null,

  async enter() {
    snapshot = takeSnapshot()
    set({ active: true, feed: [], index: -1, offset: null, loading: true, error: null })
    try {
      const { useSettingsStore } = await import('./settings')
      const svc = serviceFor(useSettingsStore.getState().activeSource)
      const songs = (await svc.getDailySongs?.()) ?? []
      if (!songs.length) {
        set({ loading: false, error: '暂时没有推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, loading: false, error: null })
      await get().loadIndex(0)
    } catch (e) {
      set({ loading: false, error: (e as Error)?.message || '加载失败' })
    }
  },

  async loadIndex(i) {
    const { feed } = get()
    const track = feed[i]
    if (!track) return
    set({ index: i, loading: true, offset: null })
    const range = await ensureOffset(track)
    set({ offset: range, loading: false })
    void usePlayerStore.getState().loadTrack(track, { startAt: range.startSec, contextId: `shuange:${String(track.id)}` })
  },

  async next() {
    const { feed, index } = get()
    if (index + 1 < feed.length) {
      await get().loadIndex(index + 1)
      return
    }
    // feed 耗尽:用 recommend/playlists 补
    await appendMoreFeed(get, set)
    const after = get()
    if (index + 1 < after.feed.length) await get().loadIndex(index + 1)
  },

  async prev() {
    const { index } = get()
    if (index > 0) await get().loadIndex(index - 1)
  },

  playFullCurrent() {
    const { feed, index } = get()
    const rest = feed.slice(index)
    if (!rest.length) return
    const snap = snapshot
    snapshot = null
    set({ active: false })
    // 交还原队列:用 feed 剩余作新队列从当前曲起播(整曲)
    usePlaylistStore.getState().setQueue(rest, 0)
    useNavigationStore.getState().navigateTo('explore')
    void snap // 快照不再恢复
  },

  leave() {
    const snap = snapshot
    snapshot = null
    set({ active: false })
    if (!snap) return
    // 恢复原队列(暂停态):setState 不触发 playAt 自动开播
    usePlaylistStore.setState({
      queue: snap.queue,
      queueIndex: snap.queueIndex,
      queueContextId: snap.queueContextId,
    })
    if (snap.currentTrack) {
      void usePlayerStore.getState().loadTrack(snap.currentTrack, { startAt: snap.position, contextId: snap.queueContextId })
        .then(() => usePlayerStore.getState().pause())
    }
  },
}))

// feed 补充:拉个性化歌单 → 取首个骨架追加曲目
async function appendMoreFeed(get: () => ShuangeStore, set: (p: Partial<ShuangeStore>) => void): Promise<void> {
  try {
    const { useSettingsStore } = await import('./settings')
    const svc = serviceFor(useSettingsStore.getState().activeSource)
    const pls = await svc.getRecommendPlaylists?.(0)
    if (!pls?.length) return
    const skel = await svc.getPlaylistSkeleton(pls[0].id)
    const more = skel.tracks.filter((t) => t && t.id)
    if (more.length) set({ feed: [...get().feed, ...more] })
  } catch {
    // 补充失败静默;next 会原地不动
  }
}

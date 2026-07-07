import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore, registerTrackEndedHandler } from './player'
import { useSettingsStore } from './settings'
import { serviceFor } from '../lib/service-registry'
import type { Playlist, Track, ShelfMode } from '../types/domain'

interface UserPlaylistsResponse {
  playlists?: Playlist[]
}

/** pending 占位曲目:先按 id 补详情;失败则去掉 pending 标记凭 id 兜底直接播(网易播放 URL 只需 id)。 */
async function resolvePending(track: Track): Promise<Track> {
  try {
    const [full] = await serviceFor(track.source).getTracksByIds([track.id])
    if (full) return full
  } catch {
    /* 详情失败走兜底 */
  }
  return { ...track, pending: false, name: track.name || '未知曲目' }
}

/** Fisher-Yates 洗牌出 [0, n) 的随机排列。 */
function shuffledIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

interface PlaylistStore {
  playlists: Playlist[]
  currentPlaylist: Playlist | null
  queue: Track[]
  queueIndex: number
  /** 随机模式的洗牌排列(队列下标序列);长度与 queue 不一致时懒重建。 */
  shuffleOrder: number[]
  shelfVisible: boolean
  shelfMode: ShelfMode
  loadUserPlaylists(): Promise<void>
  setCurrentPlaylist(p: Playlist | null): void
  setQueue(tracks: Track[], startIndex?: number): void
  addToQueue(track: Track): void
  playAt(index: number): void
  next(): void
  prev(): void
  /** 自然播完的走序:单曲循环原地重播,其余同 next()。 */
  handleTrackEnded(): void
  toggleShelf(): void
  setShelfMode(mode: ShelfMode): void
}

/** 按播放模式算 next/prev 的目标下标;随机模式沿洗牌排列循环走,长度失配时懒重建。 */
function stepIndex(
  s: Pick<PlaylistStore, 'queue' | 'queueIndex' | 'shuffleOrder'>,
  set: (partial: Partial<PlaylistStore>) => void,
  dir: 1 | -1
): number {
  const len = s.queue.length
  if (!len) return -1
  if (useSettingsStore.getState().playMode !== 'shuffle') {
    return (s.queueIndex + dir + len) % len
  }
  let order = s.shuffleOrder
  if (order.length !== len) {
    order = shuffledIndices(len)
    set({ shuffleOrder: order })
  }
  const pos = order.indexOf(s.queueIndex)
  return order[(pos + dir + len) % len]
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  queue: [],
  queueIndex: -1,
  shuffleOrder: [],
  shelfVisible: false,
  shelfMode: 'dynamic',

  async loadUserPlaylists() {
    try {
      const res = await api.get<UserPlaylistsResponse>('/api/user/playlists')
      set({ playlists: res.playlists ?? [] })
    } catch {
      set({ playlists: [] })
    }
  },

  setCurrentPlaylist(p) {
    set({ currentPlaylist: p })
  },

  setQueue(tracks, startIndex = 0) {
    set({ queue: tracks, queueIndex: -1, shuffleOrder: shuffledIndices(tracks.length) })
    if (tracks.length) get().playAt(startIndex)
  },

  addToQueue(track) {
    set((s) => ({ queue: [...s.queue, track] }))
  },

  playAt(index) {
    const track = get().queue[index]
    if (!track) return
    set({ queueIndex: index })
    if (!track.pending) {
      void usePlayerStore.getState().loadTrack(track)
      return
    }
    void resolvePending(track).then((resolved) => {
      const { queue, queueIndex } = get()
      // 等待补详情期间用户已切歌/换队列:丢弃
      if (queueIndex !== index || String(queue[index]?.id) !== String(track.id)) return
      const nextQueue = [...queue]
      nextQueue[index] = resolved
      set({ queue: nextQueue })
      void usePlayerStore.getState().loadTrack(resolved)
    })
  },

  next() {
    get().playAt(stepIndex(get(), set, +1))
  },

  prev() {
    get().playAt(stepIndex(get(), set, -1))
  },

  handleTrackEnded() {
    if (useSettingsStore.getState().playMode === 'one') {
      const player = usePlayerStore.getState()
      if (!player.currentTrack) return
      player.seek(0)
      player.play()
      return
    }
    get().next()
  },

  toggleShelf() {
    set((s) => ({ shelfVisible: !s.shelfVisible }))
  },

  setShelfMode(mode) {
    set({ shelfMode: mode })
  }
}))

// 自然播完后的走序(列表循环/随机切下一首,单曲循环原地重播)
registerTrackEndedHandler(() => usePlaylistStore.getState().handleTrackEnded())

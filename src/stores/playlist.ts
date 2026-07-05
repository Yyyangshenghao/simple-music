import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore } from './player'
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

interface PlaylistStore {
  playlists: Playlist[]
  currentPlaylist: Playlist | null
  queue: Track[]
  queueIndex: number
  shelfVisible: boolean
  shelfMode: ShelfMode
  loadUserPlaylists(): Promise<void>
  setCurrentPlaylist(p: Playlist | null): void
  setQueue(tracks: Track[], startIndex?: number): void
  addToQueue(track: Track): void
  playAt(index: number): void
  next(): void
  prev(): void
  toggleShelf(): void
  setShelfMode(mode: ShelfMode): void
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  queue: [],
  queueIndex: -1,
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
    set({ queue: tracks, queueIndex: -1 })
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
    const { queue, queueIndex } = get()
    if (!queue.length) return
    get().playAt((queueIndex + 1) % queue.length)
  },

  prev() {
    const { queue, queueIndex } = get()
    if (!queue.length) return
    get().playAt((queueIndex - 1 + queue.length) % queue.length)
  },

  toggleShelf() {
    set((s) => ({ shelfVisible: !s.shelfVisible }))
  },

  setShelfMode(mode) {
    set({ shelfMode: mode })
  }
}))

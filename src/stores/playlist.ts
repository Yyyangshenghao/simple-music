import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore } from './player'
import type { Playlist, Track, ShelfMode } from '../types/domain'

interface UserPlaylistsResponse {
  playlists?: Playlist[]
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
    set({ queue: tracks, queueIndex: tracks.length ? startIndex : -1 })
    const track = tracks[startIndex]
    if (track) void usePlayerStore.getState().loadTrack(track)
  },

  addToQueue(track) {
    set((s) => ({ queue: [...s.queue, track] }))
  },

  playAt(index) {
    const track = get().queue[index]
    if (!track) return
    set({ queueIndex: index })
    void usePlayerStore.getState().loadTrack(track)
  },

  next() {
    const { queue, queueIndex } = get()
    if (!queue.length) return
    const idx = (queueIndex + 1) % queue.length
    set({ queueIndex: idx })
    void usePlayerStore.getState().loadTrack(queue[idx])
  },

  prev() {
    const { queue, queueIndex } = get()
    if (!queue.length) return
    const idx = (queueIndex - 1 + queue.length) % queue.length
    set({ queueIndex: idx })
    void usePlayerStore.getState().loadTrack(queue[idx])
  },

  toggleShelf() {
    set((s) => ({ shelfVisible: !s.shelfVisible }))
  },

  setShelfMode(mode) {
    set({ shelfMode: mode })
  }
}))

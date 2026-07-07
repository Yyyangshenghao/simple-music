import { create } from 'zustand'
import { usePlayerStore } from './player'
import type { Track } from '../types/domain'

/** 本地曲目级播放历史:不依赖登录、跨音源,localStorage 持久化,上限 200 条按 source+id 去重。 */

const STORAGE_KEY = 'simplemusic-recent-plays'
const MAX_ITEMS = 200

export interface RecentPlay {
  track: Track
  playedAt: number
}

function keyOf(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

function loadFromLocal(): RecentPlay[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentPlay[]
    return Array.isArray(data) ? data.filter((it) => it?.track) : []
  } catch {
    return []
  }
}

interface RecentPlaysStore {
  items: RecentPlay[]
  record(track: Track): void
  clear(): void
}

export const useRecentPlaysStore = create<RecentPlaysStore>((set, get) => ({
  items: loadFromLocal(),

  record(track) {
    // 落盘剥掉临时解析 URL
    const { url: _url, ...rest } = track
    const entry: RecentPlay = { track: rest as Track, playedAt: Date.now() }
    const items = [entry, ...get().items.filter((it) => keyOf(it.track) !== keyOf(track))].slice(0, MAX_ITEMS)
    set({ items })
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
      } catch {
        /* 超配额放弃本次落盘 */
      }
    }
  },

  clear() {
    set({ items: [] })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }
}))

// 开始加载新曲目(status 'loading' 与 currentTrack 同时置入)时记录;
// 重启恢复(status 'paused')不重复记录。
usePlayerStore.subscribe((s, prev) => {
  if (s.currentTrack && s.currentTrack !== prev.currentTrack && s.status === 'loading') {
    useRecentPlaysStore.getState().record(s.currentTrack)
  }
})

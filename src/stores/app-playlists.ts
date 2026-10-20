import { create } from 'zustand'
import type { Track } from '../types/domain'

export const APP_PLAYLISTS_KEY = 'simplemusic-app-playlists'

/** 应用歌单独立于平台歌单和临时播放队列，不具有平台 source。 */
export interface AppPlaylist {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tracks: Track[]
  roamKey?: string
}

type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface RemovedAppPlaylistTrack {
  track: Track
  index: number
}

interface AppPlaylistsStore {
  items: AppPlaylist[]
  error: string
  reload(): void
  create(name: string, tracks?: Track[]): string
  saveRoam(name: string, tracks: Track[], key: string): string
  rename(id: string, name: string): void
  remove(id: string): void
  addTracks(id: string, tracks: Track[]): number
  removeTracks(id: string, keys: string[]): RemovedAppPlaylistTrack[]
  restoreTracks(id: string, removed: RemovedAppPlaylistTrack[]): number
  moveTrack(id: string, key: string, direction: -1 | 1): void
  /** 移到指定下标，越界时贴边。 */
  moveTrackTo(id: string, key: string, target: number): void
}

export function appPlaylistTrackKey(track: Pick<Track, 'source' | 'id'>): string {
  return `${track.source}:${String(track.id)}`
}

function savedTrack(track: Track): Track {
  // 音频每次播放重新解析；本地封面只存存在标记，读取时按当前端口/token 重建。
  const { url: _url, ...metadata } = track
  return { ...metadata, id: String(track.id), provider: track.source, cover: track.source === 'local' ? (track.cover ? 'local-cover' : undefined) : track.cover }
}

function validTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const track = value as Track
  return ['netease', 'qq', 'apple', 'local'].includes(track.source)
    && (typeof track.id === 'string' || typeof track.id === 'number') && String(track.id).length > 0
    && typeof track.type === 'string' && typeof track.name === 'string' && typeof track.artist === 'string'
    && Array.isArray(track.artists) && track.artists.every(artist => artist && typeof artist.name === 'string')
}

function uniqueTracks(tracks: Track[]): Track[] {
  const known = new Set<string>()
  return tracks.filter(track => {
    if (!validTrack(track)) throw new Error('曲目信息不完整，无法保存')
    const key = appPlaylistTrackKey(track)
    if (known.has(key)) return false
    known.add(key)
    return true
  }).map(savedTrack)
}

function playlistName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请输入歌单名称')
  if (trimmed.length > 80) throw new Error('歌单名称不能超过 80 个字符')
  return trimmed
}

function readArchive(storage: ArchiveStorage): AppPlaylist[] {
  const raw = storage.getItem(APP_PLAYLISTS_KEY)
  if (raw === null) return []
  const archive = JSON.parse(raw)
  if (archive?.version !== 1 || !Array.isArray(archive.items)) throw new Error('Invalid archive')
  const ids = new Set<string>()
  for (const item of archive.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name.trim()
      || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)
      || !Array.isArray(item.tracks) || !item.tracks.every(validTrack)) throw new Error('Invalid playlist')
    if (item.roamKey !== undefined && typeof item.roamKey !== 'string') throw new Error('Invalid roam key')
    ids.add(item.id)
    const keys = item.tracks.map(appPlaylistTrackKey)
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate tracks')
  }
  // 旧同步关联已停用；读取不改写存档，正常保存时仅保留聚合歌单数据。
  return archive.items.map((item: AppPlaylist) => ({
    id: item.id, name: item.name, createdAt: item.createdAt, updatedAt: item.updatedAt,
    tracks: item.tracks.map(savedTrack), ...(item.roamKey === undefined ? {} : { roamKey: item.roamKey }),
  }))
}

export function createAppPlaylistsStore(storage: () => ArchiveStorage, newId: () => string = () => crypto.randomUUID()) {
  return create<AppPlaylistsStore>((set, get) => {
    function load() {
      try { return { items: readArchive(storage()), error: '' } }
      catch { return { items: [], error: '应用歌单读取失败，原存档已保留。请重试读取。' } }
    }
    function persist(items: AppPlaylist[]) {
      if (get().error) throw new Error(get().error)
      // 先落盘再发布新快照；配额不足时保留原有内容，调用方不能得到假成功。
      try {
        const raw = JSON.stringify({ version: 1, items })
        const snapshot = JSON.parse(raw).items as AppPlaylist[]
        storage().setItem(APP_PLAYLISTS_KEY, raw)
        set({ items: snapshot })
      } catch { throw new Error('应用歌单保存失败，请检查可用空间后重试') }
    }
    function find(id: string): AppPlaylist {
      if (get().error) throw new Error(get().error)
      const item = get().items.find(item => item.id === id)
      if (!item) throw new Error('这个应用歌单已被删除，请重新选择')
      return item
    }
    function update(id: string, tracks: Track[]) {
      persist(get().items.map(item => item.id === id ? { ...item, tracks, updatedAt: Date.now() } : item))
    }
    return {
      ...load(),
      reload() { set(load()) },
      create(name, tracks = []) {
        const item: AppPlaylist = { id: newId(), name: playlistName(name), tracks: uniqueTracks(tracks), createdAt: Date.now(), updatedAt: Date.now() }
        persist([...get().items, item])
        return item.id
      },
      saveRoam(name, tracks, key) {
        const existing = get().items.find(item => item.roamKey === key)
        if (existing) return existing.id
        const item: AppPlaylist = { id: newId(), name: playlistName(name), tracks: uniqueTracks(tracks), createdAt: Date.now(), updatedAt: Date.now(), roamKey: key }
        persist([...get().items, item])
        return item.id
      },
      rename(id, name) {
        find(id)
        const nextName = playlistName(name)
        persist(get().items.map(item => item.id === id ? { ...item, name: nextName, updatedAt: Date.now() } : item))
      },
      remove(id) { find(id); persist(get().items.filter(item => item.id !== id)) },
      addTracks(id, tracks) {
        const item = find(id)
        const next = uniqueTracks([...item.tracks, ...tracks])
        const added = next.length - item.tracks.length
        if (added) update(id, next)
        return added
      },
      removeTracks(id, keys) {
        const item = find(id)
        const keysToRemove = new Set(keys)
        const removed = item.tracks.flatMap((track, index) => keysToRemove.has(appPlaylistTrackKey(track)) ? [{ track, index }] : [])
        if (removed.length) update(id, item.tracks.filter(track => !keysToRemove.has(appPlaylistTrackKey(track))))
        return removed
      },
      restoreTracks(id, removed) {
        const item = find(id)
        const next = [...item.tracks]
        const known = new Set(next.map(appPlaylistTrackKey))
        let restored = 0
        for (const { track, index } of [...removed].sort((a, b) => a.index - b.index)) {
          const key = appPlaylistTrackKey(track)
          if (known.has(key)) continue
          next.splice(Math.min(index, next.length), 0, savedTrack(track))
          known.add(key)
          restored++
        }
        if (restored) update(id, next)
        return restored
      },
      moveTrack(id, key, direction) {
        const item = find(id)
        const index = item.tracks.findIndex(track => appPlaylistTrackKey(track) === key)
        const target = index + direction
        if (index < 0 || target < 0 || target >= item.tracks.length) return
        const next = [...item.tracks]
        ;[next[index], next[target]] = [next[target], next[index]]
        update(id, next)
      },
      moveTrackTo(id, key, target) {
        const item = find(id)
        const index = item.tracks.findIndex(track => appPlaylistTrackKey(track) === key)
        const clamped = Math.max(0, Math.min(item.tracks.length - 1, target))
        if (index < 0 || index === clamped) return
        const next = [...item.tracks]
        const [moved] = next.splice(index, 1)
        next.splice(clamped, 0, moved)
        update(id, next)
      },
    }
  })
}

export const useAppPlaylistsStore = createAppPlaylistsStore(() => localStorage)

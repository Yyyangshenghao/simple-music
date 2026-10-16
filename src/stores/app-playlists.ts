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
  neteaseSync?: Record<string, { playlistId: string; syncedContent?: string; syncedAt?: number }>
  qqSync?: Record<string, { playlistId: string; syncedContent?: string; syncedAt?: number }>
}

type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem'>

interface AppPlaylistsStore {
  items: AppPlaylist[]
  error: string
  reload(): void
  create(name: string, tracks?: Track[]): string
  saveRoam(name: string, tracks: Track[], key: string): string
  recordNeteaseSync(id: string, accountId: string, link: NonNullable<AppPlaylist['neteaseSync']>[string]): void
  recordQQSync(id: string, accountId: string, link: NonNullable<AppPlaylist['qqSync']>[string]): void
  rename(id: string, name: string): void
  remove(id: string): void
  addTracks(id: string, tracks: Track[]): number
  removeTracks(id: string, keys: string[]): void
  moveTrack(id: string, key: string, direction: -1 | 1): void
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
    for (const links of [item.neteaseSync, item.qqSync]) {
      if (links !== undefined && (!links || typeof links !== 'object' || Array.isArray(links)
        || Object.entries(links).some(([accountId, value]) => {
          const link = value as NonNullable<AppPlaylist['neteaseSync']>[string]
          return !/^[1-9]\d*$/.test(accountId) || !link || typeof link.playlistId !== 'string' || !/^[1-9]\d*$/.test(link.playlistId)
            || (link.syncedContent !== undefined && typeof link.syncedContent !== 'string')
            || (link.syncedAt !== undefined && !Number.isFinite(link.syncedAt))
        }))) throw new Error('Invalid sync link')
    }
    ids.add(item.id)
    const keys = item.tracks.map(appPlaylistTrackKey)
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate tracks')
  }
  return archive.items.map((item: AppPlaylist) => ({ ...item, tracks: item.tracks.map(savedTrack) }))
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
      recordNeteaseSync(id, accountId, link) {
        const item = find(id)
        if (!/^[1-9]\d*$/.test(accountId) || !/^[1-9]\d*$/.test(link.playlistId)) throw new Error('网易云歌单关联无效')
        persist(get().items.map(current => current.id === id ? { ...item, neteaseSync: { ...item.neteaseSync, [accountId]: link } } : current))
      },
      recordQQSync(id, accountId, link) {
        const item = find(id)
        if (!/^[1-9]\d*$/.test(accountId) || !/^[1-9]\d*$/.test(link.playlistId)) throw new Error('QQ 音乐歌单关联无效')
        persist(get().items.map(current => current.id === id ? { ...item, qqSync: { ...item.qqSync, [accountId]: link } } : current))
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
        const removed = new Set(keys)
        const next = item.tracks.filter(track => !removed.has(appPlaylistTrackKey(track)))
        if (next.length !== item.tracks.length) update(id, next)
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
    }
  })
}

export const useAppPlaylistsStore = createAppPlaylistsStore(() => localStorage)

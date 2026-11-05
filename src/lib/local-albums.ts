import type { Track } from '../types/domain'

export interface LocalAlbum {
  key: string
  name: string
  artist: string
  cover: string
  tracks: Track[]
}

function localAlbumArtist(track: Track): string {
  const tagged = typeof track.albumArtist === 'string' ? track.albumArtist.trim() : ''
  return tagged || track.artist.trim()
}

function localAlbumKey(track: Track): string {
  return JSON.stringify([track.album?.trim() || '', localAlbumArtist(track)])
}

/** 只对本机索引分组，键不作为在线专辑 ID 或文件读取地址。 */
export function groupLocalAlbums(tracks: Track[]): LocalAlbum[] {
  const albums = new Map<string, LocalAlbum>()
  for (const track of tracks) {
    const key = localAlbumKey(track)
    const existing = albums.get(key)
    if (existing) {
      existing.tracks.push(track)
      if (!existing.cover && track.cover) existing.cover = track.cover
    } else {
      albums.set(key, {
        key,
        name: track.album?.trim() || '未分类',
        artist: localAlbumArtist(track) || '未知艺人',
        cover: track.cover || '',
        tracks: [track],
      })
    }
  }
  return [...albums.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')
    || a.artist.localeCompare(b.artist, 'zh-Hans-CN-u-co-pinyin'))
}

export function localTracksInAlbum(tracks: Track[], albumKey: string): Track[] {
  return tracks.filter(track => localAlbumKey(track) === albumKey)
}

export function matchesLocalMusic(track: Track, keyword: string): boolean {
  const query = keyword.trim().toLowerCase()
  return !query || [track.name, track.artist, localAlbumArtist(track), track.album ?? ''].some(value => value.toLowerCase().includes(query))
}

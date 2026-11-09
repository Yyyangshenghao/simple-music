import { describe, expect, it } from 'vitest'
import type { Track } from '../types/domain'
import { groupLocalAlbums, localTracksInAlbum, matchesLocalMusic } from './local-albums'

function song(id: string, album: string | undefined, artist = '音乐人'): Track {
  return { source: 'local', provider: 'local', type: 'local', id, name: `歌曲 ${id}`, artist, album, artists: [] }
}

describe('本地专辑分组', () => {
  it('同名不同艺人分开，清理标签两侧空白并从已有歌曲选封面', () => {
    const tracks = [song('1', ' 夜行 '), { ...song('2', '夜行'), cover: '/api/local/cover?id=2' }, song('3', '夜行', '另一位音乐人')]
    const albums = groupLocalAlbums(tracks)
    expect(albums).toHaveLength(2)
    const album = albums.find(item => item.artist === '音乐人')!
    expect(album.name).toBe('夜行')
    expect(album.tracks).toEqual(tracks.slice(0, 2))
    expect(album.cover).toBe('/api/local/cover?id=2')
  })

  it('缺少专辑标签按艺人归为未分类，不与真实同名专辑混合', () => {
    const albums = groupLocalAlbums([song('1', undefined), song('2', '  '), song('3', '未分类')])
    expect(albums).toHaveLength(2)
    expect(albums.map(album => album.tracks.length).sort()).toEqual([1, 2])
    expect(albums[0].key).not.toBe(albums[1].key)
  })

  it('优先专辑艺人合并合辑，旧索引与空标签仍按单曲艺人分组', () => {
    const tracks = [
      { ...song('1', '一路同行', '歌手甲'), albumArtist: ' 合辑艺人 ' },
      { ...song('2', '一路同行', '歌手乙'), albumArtist: '合辑艺人' },
      song('3', '一路同行', '歌手甲'),
      { ...song('4', '一路同行', '歌手甲'), albumArtist: '  ' },
      { ...song('5', '一路同行', '歌手乙'), albumArtist: { name: '无效标签' } },
    ]
    const albums = groupLocalAlbums(tracks)
    expect(albums).toHaveLength(3)
    const compilation = albums.find(album => album.artist === '合辑艺人')!
    expect(compilation.tracks.map(track => track.id)).toEqual(['1', '2'])
    expect(localTracksInAlbum(tracks, compilation.key).map(track => track.id)).toEqual(['1', '2'])
    expect(albums.find(album => album.artist === '歌手甲')!.tracks.map(track => track.id)).toEqual(['3', '4'])
    expect(matchesLocalMusic(tracks[0], '合辑艺人')).toBe(true)
  })

  it('组内播放使用当前过滤和排序结果，不混入其他专辑歌曲', () => {
    const tracks = [song('1', '夜行'), song('2', '夜行'), song('3', '日光')]
    const key = groupLocalAlbums(tracks).find(album => album.name === '夜行')!.key
    const filtered = tracks.filter(track => matchesLocalMusic(track, '歌曲 2')).reverse()
    expect(localTracksInAlbum(filtered, key).map(track => track.id)).toEqual(['2'])
    expect(localTracksInAlbum(tracks, key).map(track => track.id)).toEqual(['1', '2'])
  })

  it('可以按专辑标签搜索，并保留传入曲目及其本地地址', () => {
    const track = { ...song('1', 'Night Walk'), url: '/api/local/audio?id=1' }
    expect(matchesLocalMusic(track, ' night ')).toBe(true)
    expect(matchesLocalMusic(track, 'missing')).toBe(false)
    expect(groupLocalAlbums([track])[0].tracks[0]).toBe(track)
  })
})

import { describe, expect, it } from 'vitest'
import type { Playlist } from '../../types/domain'
import { mergeAlbumDetail } from './album-detail'

const album: Playlist = {
  id: 'album-a', provider: 'qq', source: 'qq', type: 'album', name: '原专辑',
  cover: 'https://example.com/cover.jpg', trackCount: 5, playCount: 0,
  creator: '原歌手', tag: '专辑', description: '原简介',
}

describe('mergeAlbumDetail', () => {
  it('补全当前专辑展示信息，但不以 meta 的未知曲目数覆盖已知数量', () => {
    const detail = {
      ...album, name: '完整专辑名', creator: '完整歌手名',
      tag: '2025-08-30 · 唱片公司', description: '完整简介', trackCount: 0,
    }
    expect(mergeAlbumDetail(album, detail)).toEqual({ ...detail, trackCount: 5 })
  })

  it('详情缺字段或请求失败时保留原摘要', () => {
    expect(mergeAlbumDetail(album, null)).toBe(album)
    expect(mergeAlbumDetail(album, {
      ...album, name: '', cover: '', creator: '', tag: '', description: '', trackCount: 0,
    })).toEqual(album)
  })

  it('切换专辑、来源或内容类型后不显示旧详情', () => {
    const anotherAlbum = { ...album, id: 'album-b' }
    const anotherSource: Playlist = { ...album, source: 'netease' }
    const ordinaryPlaylist: Playlist = { ...album, type: 'playlist' }
    for (const current of [anotherAlbum, anotherSource, ordinaryPlaylist]) {
      expect(mergeAlbumDetail(current, album)).toBe(current)
    }
    expect(mergeAlbumDetail(album, ordinaryPlaylist)).toBe(album)
  })

  it('按字符串统一比较 ID', () => {
    expect(mergeAlbumDetail({ ...album, id: 123 }, { ...album, id: '123', name: '新名称' }).name)
      .toBe('新名称')
  })
})

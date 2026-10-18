import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaylistCard } from './PlaylistCard'
import type { Playlist } from '../../types/domain'

const h = vi.hoisted(() => ({ count: undefined as number | undefined }))
vi.mock('../../hooks/useLazyPlaylist', () => ({ getCachedPlaylistTrackCount: () => h.count }))
beforeEach(() => { h.count = undefined })

const playlist: Playlist = {
  provider: 'apple', source: 'apple', type: 'playlist', id: 'p.favorite', name: '喜爱歌曲',
  cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music',
}

describe('PlaylistCard', () => {
  it('尚未读取详情时标明平台统计，不把摘要当作完整列表数量', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, provider: 'netease', source: 'netease', trackCount: 864 }} onClick={() => {}} />)
    expect(html).toContain('平台统计 864 首')
    expect(html).toContain('打开后按实际读取的歌曲列表计数')
  })

  it('读取详情后卡片及可访问名称采用列表数量，保留不可播曲目计数', () => {
    h.count = 870
    const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCount: 864 }} onClick={() => {}} />)
    expect(html).toContain('870 首')
    expect(html).toContain('aria-label="歌单：喜爱歌曲，870 首"')
    expect(html).not.toContain('864 首')
    expect(html).not.toContain('平台统计')
  })

  it('已读取的空列表优先于旧摘要，专辑数量不加歌单平台统计文案', () => {
    h.count = 0
    const empty = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCount: 9 }} onClick={() => {}} />)
    expect(empty).toContain('0 首')
    expect(empty).not.toContain('9 首')
    h.count = undefined
    const album = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, type: 'album', trackCount: 12 }} onClick={() => {}} />)
    expect(album).toContain('12 首')
    expect(album).not.toContain('平台统计')
  })

  it('曲目数未知时不显示误导性的 0 首，已确认空歌单仍显示 0 首', () => {
    const unknown = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCountKnown: false }} onClick={() => {}} />)
    expect(unknown).toContain('查看歌曲')
    expect(unknown).not.toContain('0 首')
    const empty = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCountKnown: true }} onClick={() => {}} />)
    expect(empty).toContain('0 首')
  })

  it('显式隐藏辅助文字时只保留卡片标题', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={playlist} meta="" onClick={() => {}} />)
    expect(html.match(/<p\b/g)).toHaveLength(1)
    expect(html).not.toContain('0 首')
    expect(html).toContain('aria-label="歌单：喜爱歌曲"')
  })

  it('QQ 我喜欢的专辑封面叠加红心，歌单改名后仍保留', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, source: 'qq', provider: 'qq', id: 'qq-liked:201', name: '收藏歌曲', cover: 'https://example.com/album.jpg' }} onClick={() => {}} />)
    expect(html).toContain('src="https://example.com/album.jpg"')
    expect(html).toContain('data-kind="liked-cover-overlay"')
  })

  it('名称相似的普通 QQ 歌单和其他平台不叠加红心', () => {
    for (const entry of [
      { ...playlist, source: 'qq' as const, provider: 'qq' as const, id: 123, name: '我喜欢的跑步歌单' },
      { ...playlist, id: 'qq-liked:201' },
    ]) {
      const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...entry, cover: 'https://example.com/album.jpg' }} onClick={() => {}} />)
      expect(html).not.toContain('data-kind="liked-cover-overlay"')
    }
  })

  it('QQ 我喜欢缺图时保留现有占位封面，不重复叠加红心', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, source: 'qq', provider: 'qq', id: 'qq-liked:201', name: '我喜欢' }} onClick={() => {}} />)
    expect(html).toContain('data-kind="favorite"')
    expect(html).not.toContain('data-kind="liked-cover-overlay"')
  })
})

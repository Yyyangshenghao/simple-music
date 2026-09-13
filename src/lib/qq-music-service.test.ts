import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}))

import { QQMusicService } from './qq-music-service'

beforeEach(() => {
  apiGet.mockReset()
})

describe('QQMusicService.getLyrics', () => {
  it('只把真实 qqId 作为歌词接口的数字 id', async () => {
    apiGet.mockResolvedValue({ lines: [] })
    const track = {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: '003a1B2c',
      qqId: 123456,
      mid: '003a1B2c',
      name: '测试歌曲',
      artist: '测试歌手',
      artists: [],
    } as Track

    await new QQMusicService().getLyrics(track)

    expect(apiGet).toHaveBeenCalledWith('/api/qq/lyric', {
      id: 123456,
      mid: '003a1B2c',
    })
  })
})

describe('QQMusicService QQ 标识契约', () => {
  it('相似歌曲只传真实数字 qqId', async () => {
    const track: Track = { provider: 'qq', source: 'qq', type: 'qq', id: 'song-mid', qqId: '5105986', name: '歌曲', artist: '', artists: [] }
    apiGet.mockResolvedValue({ songs: [track] })
    await expect(new QQMusicService().getSimilarTracks(track)).resolves.toEqual([track])
    expect(apiGet).toHaveBeenCalledWith('/api/qq/song/similar', { songid: 5105986 })
  })

  it('相关歌单换一批传上一批 ID，不把字符串 0 当 hasMore', async () => {
    const track: Track = { provider: 'qq', source: 'qq', type: 'qq', id: 'song-mid', qqId: 5105986, name: '歌曲', artist: '', artists: [] }
    apiGet.mockResolvedValue({ playlists: [], hasMore: '0' })
    await expect(new QQMusicService().getRelatedPlaylists(track, ['123', '456']))
      .resolves.toEqual({ playlists: [], hasMore: false })
    expect(apiGet).toHaveBeenCalledWith('/api/qq/song/related-playlists', { songid: 5105986, previousIds: '123,456' })
  })

  it('缺少 qqId 时不靠 MID 猜数字，也不发相关内容请求', async () => {
    const track: Track = { provider: 'qq', source: 'qq', type: 'qq', id: 'mid123', name: '歌曲', artist: '', artists: [] }
    await expect(new QQMusicService().getSimilarTracks(track)).resolves.toEqual([])
    await expect(new QQMusicService().getRelatedPlaylists(track)).resolves.toEqual({ playlists: [], hasMore: false })
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('热词只请求热词接口，不批量搜索歌曲', async () => {
    apiGet.mockResolvedValue({ keywords: ['测试歌曲', '测试歌手'] })
    await expect(new QQMusicService().getSearchHotkeys()).resolves.toEqual(['测试歌曲', '测试歌手'])
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/api/qq/search/hotkeys')
  })

  it('热词结果缺失时回退为空数组', async () => {
    apiGet.mockResolvedValue({})
    await expect(new QQMusicService().getSearchHotkeys()).resolves.toEqual([])
  })

  it('读取稳定的“我喜欢”歌单入口', async () => {
    const playlist = {
      provider: 'qq',
      source: 'qq',
      type: 'playlist',
      id: 'qq-liked:201',
      name: '我喜欢的音乐',
      cover: '',
      trackCount: 0,
      playCount: 0,
      creator: 'QQ 音乐',
    }
    apiGet.mockResolvedValue({ playlist })

    await expect(new QQMusicService().getLikedPlaylist()).resolves.toEqual(playlist)
    expect(apiGet).toHaveBeenCalledWith('/api/qq/liked/playlist')
  })

  it('歌手详情只用 singer MID 作为路由参数', async () => {
    apiGet.mockResolvedValue({
      artist: { id: 'artist-mid', mid: 'artist-mid', name: '测试歌手', avatar: '', source: 'qq' },
    })

    await new QQMusicService().getArtistDetail('artist-mid')

    expect(apiGet).toHaveBeenCalledWith('/api/qq/artist/detail', { mid: 'artist-mid' })
  })

  it('相似歌手只用 singer MID 请求并保留 QQ 来源', async () => {
    apiGet.mockResolvedValue({
      artists: [{ id: 'similar-mid', mid: 'similar-mid', name: '相似歌手', avatar: '', source: 'qq' }],
    })

    await expect(new QQMusicService().getSimilarArtists('artist-mid')).resolves.toEqual([
      expect.objectContaining({ id: 'similar-mid', source: 'qq' }),
    ])
    expect(apiGet).toHaveBeenCalledWith('/api/qq/artist/similar', { mid: 'artist-mid', limit: 10 })
  })

  it('按专辑 MID 读取补全后的专辑信息', async () => {
    const playlist = {
      provider: 'qq',
      source: 'qq',
      type: 'album',
      id: 'album-mid',
      name: '测试专辑',
      cover: '',
      trackCount: 12,
      playCount: 0,
      creator: '测试歌手',
    }
    apiGet.mockResolvedValue({ playlist })

    await expect(new QQMusicService().getAlbumDetail('album-mid')).resolves.toEqual(playlist)
    expect(apiGet).toHaveBeenCalledWith('/api/qq/album/detail', { mid: 'album-mid' })
  })

  it('歌曲搜索保持现有接口并请求 20 条结果', async () => {
    apiGet.mockResolvedValue({ songs: [] })

    await new QQMusicService().searchTracks('测试')

    expect(apiGet).toHaveBeenCalledWith('/api/qq/search', { keywords: '测试', limit: 20 })
  })

  it.each(['123456', 'qq-liked:201', 'qq-toplist:62'])('歌单详情原样传递入口 id：%s', async (id) => {
    apiGet.mockResolvedValue({
      trackIds: ['song-mid'],
      tracks: [{ id: 'song-mid' }],
    })

    const skeleton = await new QQMusicService().getPlaylistSkeleton(id)

    expect(apiGet).toHaveBeenCalledWith('/api/qq/playlist/tracks', { id })
    expect(skeleton.trackIds).toEqual(['song-mid'])
  })
})

describe('QQMusicService 排行榜', () => {
  it('读取榜单分组并保留空结果语义', async () => {
    const groups = [{ title: '巅峰榜', entries: [] }]
    apiGet.mockResolvedValue({ groups })

    await expect(new QQMusicService().getToplists()).resolves.toEqual(groups)
    expect(apiGet).toHaveBeenCalledWith('/api/qq/toplist')
  })

  it('用榜单虚拟 id 补拉 Top3 预览', async () => {
    const preview = [{ name: '歌曲 A', artist: '歌手 A' }]
    apiGet.mockResolvedValue({ preview })

    await expect(new QQMusicService().getToplistPreview('qq-toplist:62')).resolves.toEqual(preview)
    expect(apiGet).toHaveBeenCalledWith('/api/qq/toplist/preview', { id: 'qq-toplist:62' })
  })
})

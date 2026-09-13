import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleQQRelatedPlaylists, handleQQSimilarSongs, parseQQRelatedId } from './qq-client'

// 2026-08-30 匿名响应的脱敏子集；新版分组结构另据 QQMusicApi 响应模型核验。
const track = { id: 95272, mid: 'song-mid', name: '相似歌曲', interval: 227,
  singer: [{ id: 4286, mid: 'singer-mid', name: '测试歌手' }],
  album: { mid: 'album-mid', name: '测试专辑' }, file: { media_mid: 'file-mid' } }
const playlist = { tid: 7749905894, songNum: 133, title: '相关歌单',
  cover: '//example.com/cover.jpg', creator: '测试创建者', playCnt: '12' }

function mockResponse(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ status: 200,
    text: async () => JSON.stringify({ code: 0, related: { code: 0, data } }) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('QQ 相关内容', () => {
  it('只接受安全的正整数 ID', () => {
    expect(parseQQRelatedId(' 5105986 ')).toBe(5105986)
    for (const value of [null, '', 'song5105986mid', '1e3', '0x10', -1, 0, 1.2, true, {}, '9007199254740993']) {
      expect(parseQQRelatedId(value)).toBeNull()
    }
  })

  it('相似歌曲兼容平铺/分组，保留标识语义并去重排除自身', async () => {
    const fetchMock = mockResponse({ retcode: 0, vecSong: [{ track }], vecSongNew: [{
      title_template: '更多', songs: [{ track }, { track: { ...track, id: 2, mid: 'new-mid' } },
        { track: { ...track, id: 5105986, mid: 'seed-mid' } }, { track: { name: '缺 MID' } }],
    }] })
    const songs = await handleQQSimilarSongs(5105986)
    expect(songs.map((song) => song.id)).toEqual(['song-mid', 'new-mid'])
    expect(songs[0]).toMatchObject({ source: 'qq', id: 'song-mid', mid: 'song-mid', qqId: 95272,
      mediaMid: 'file-mid', duration: 227000, artists: [{ id: 'singer-mid', qqArtistId: 4286 }] })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Cookie).toBeFalsy()
    expect(JSON.parse(init.body).related).toEqual({ module: 'music.recommend.TrackRelationServer',
      method: 'GetSimilarSongs', param: { songid: 5105986 } })
  })

  it('旧列表为空时仍读取新版相似歌曲', async () => {
    mockResponse({ vecSong: [], vecSongNew: [{ songs: [{ track }] }] })
    expect(await handleQQSimilarSongs(5105986)).toHaveLength(1)
  })

  it('相关歌单保留曲目数，并回传上一批 ID 排除重复', async () => {
    const fetchMock = mockResponse({ retcode: 0, vecPlaylist: [playlist, { ...playlist, tid: 99 }],
      vecPlaylistNew: [{ playlists: [playlist, { ...playlist, tid: 100 }] }], hasMore: 1 })
    const page = await handleQQRelatedPlaylists(5105986, [99])
    expect(page.hasMore).toBe(true)
    expect(page.playlists.map((item) => item.id)).toEqual(['7749905894', '100'])
    expect(page.playlists[0]).toMatchObject({ provider: 'qq', source: 'qq', type: 'playlist',
      name: '相关歌单', trackCount: 133, playCount: 12, creator: '测试创建者', cover: 'https://example.com/cover.jpg' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).related.param).toEqual({ songid: 5105986, vecPlaylist: [99] })
  })

  it('仅新版相关歌单也可用，字符串 0 不误判为还有更多', async () => {
    mockResponse({ vecPlaylist: [], vecPlaylistNew: [{ playlists: [playlist] }], hasMore: '0' })
    const page = await handleQQRelatedPlaylists(5105986)
    expect(page.playlists).toHaveLength(1)
    expect(page.hasMore).toBe(false)
  })

  it('上游只重复上一批时停止换一批', async () => {
    mockResponse({ vecPlaylist: [playlist], hasMore: 1 })
    expect(await handleQQRelatedPlaylists(5105986, [7749905894])).toEqual({ playlists: [], hasMore: false })
  })

  it('无效入参不发请求', async () => {
    const fetchMock = mockResponse({})
    await expect(handleQQSimilarSongs(0)).rejects.toThrow('INVALID_QQ_SONG_ID')
    await expect(handleQQRelatedPlaylists(1, [-1])).rejects.toThrow('INVALID_QQ_PLAYLIST_IDS')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{}, { code: 1, related: { code: 0 } }, { related: { code: 1 } },
    { related: { code: 0, data: { retcode: 1 } } }])('上游业务失败抛错：%j', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify(response) }))
    await expect(handleQQSimilarSongs(5105986)).rejects.toThrow('QQ_RELATED_CONTENT_FAILED')
    await expect(handleQQRelatedPlaylists(5105986)).rejects.toThrow('QQ_RELATED_CONTENT_FAILED')
  })
})

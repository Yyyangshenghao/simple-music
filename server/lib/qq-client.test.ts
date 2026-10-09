import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  handleQQArtistDetail,
  handleQQArtistSearch,
  handleQQArtistSimilar,
  handleQQAlbumDetail,
  handleQQLikedPlaylist,
  handleQQLyric,
  handleQQPlaylistTracks,
  handleQQSearch,
  handleQQSearchHotkeys,
  handleQQSongUrl,
  handleQQToplistPreview,
  handleQQToplists,
  handleQQUserPlaylists,
  getQQLoginInfo,
  isQQLikedPlaylistReference,
  isQQToplistReference,
  pickQQImageUrl,
  pickQQPlaylistCover,
  qqPlaylistReference,
  qqAuthErrorStatus,
} from './qq-client'

const LOGGED_IN_COOKIE = 'uin=12345; qm_keyst=some-key-value'

describe('QQ 登录昵称', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('不把其他 QQ 账号的 ptnick 当作当前账号昵称', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: {} }),
    }))
    const info = await getQQLoginInfo('login_type=2; wxuin=12345; qm_keyst=some-key-value; ptnick_67890=其他账号')
    expect(info.nickname).toBe('')
  })

  it('保留当前 QQ 账号对应的 ptnick 昵称', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: {} }),
    }))
    const info = await getQQLoginInfo('uin=12345; qm_keyst=some-key-value; ptnick_12345=我的昵称')
    expect(info.nickname).toBe('我的昵称')
  })

  it('不把无账号标识的 nick Cookie 直接当成 QQ 音乐用户名', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: {} }),
    }))
    const info = await getQQLoginInfo('uin=12345; qm_keyst=some-key-value; nick=412e4d')
    expect(info.nickname).toBe('')
  })

  it('优先使用 QQ 音乐资料接口返回的昵称', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: { creator: { nick: '正确昵称' } } }),
    }))
    const info = await getQQLoginInfo('uin=12345; qm_keyst=some-key-value; nick=412e4d')
    expect(info.nickname).toBe('正确昵称')
  })
})

describe('handleQQSearchHotkeys', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('按实测响应只取 query，去重保序且不使用跳转字段或登录凭据', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify({
      code: 0,
      hotkeys: { code: 0, data: { ret_code: 0, vec_hotkey: [
        // 2026-08-30 匿名响应字段结构，内容脱敏。
        { query: ' 测试歌曲 ', title: '展示标题', score: '1616861', jump_url: 'https://example.com', description: '正在热搜' },
        { query: '测试歌曲' }, { query: '测试歌手' }, { query: '  ' }, { title: '不能搜索的推广' },
        { query: { unexpected: true } },
      ] } },
    }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(handleQQSearchHotkeys()).resolves.toEqual(['测试歌曲', '测试歌手'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Cookie).toBeFalsy()
    const request = JSON.parse(init.body)
    expect(request.hotkeys).toEqual({
      module: 'music.musicsearch.HotkeyService', method: 'GetHotkeyForQQMusicMobile',
      param: { search_id: expect.stringMatching(/^\d+$/) },
    })
  })

  it('只返回前 10 个有效热词', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify({
      hotkeys: { code: 0, data: { vec_hotkey: Array.from({ length: 30 }, (_, i) => ({ query: `热词${i}` })) } },
    }) }))
    await expect(handleQQSearchHotkeys()).resolves.toEqual(Array.from({ length: 10 }, (_, i) => `热词${i}`))
  })

  it.each([
    {}, { code: 1, hotkeys: { code: 0 } }, { hotkeys: { code: 1 } },
    { hotkeys: { code: 0, data: { ret_code: 1 } } },
  ])('上游错误不伪装成成功：%j', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify(response) }))
    await expect(handleQQSearchHotkeys()).rejects.toThrow('QQ_SEARCH_HOTKEYS_FAILED')
  })

  it('空热词列表保持为空', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify({
      hotkeys: { code: 0, data: { vec_hotkey: [] } },
    }) }))
    await expect(handleQQSearchHotkeys()).resolves.toEqual([])
  })
})

describe('pickQQImageUrl', () => {
  it('跳过相对查询串并使用后续有效封面', () => {
    expect(pickQQImageUrl('?n=1', '//y.gtimg.cn/music/photo_new/cover.jpg?n=1'))
      .toBe('https://y.gtimg.cn/music/photo_new/cover.jpg?n=1')
  })

  it('没有有效地址时返回空字符串', () => {
    expect(pickQQImageUrl('?n=1', '', undefined)).toBe('')
  })

  it('歌单自身缺图时使用首首有封面的歌曲', () => {
    expect(pickQQPlaylistCover(
      { logo: '?n=1' },
      [{ cover: '' }, { cover: 'https://y.qq.com/music/photo_new/first-valid.jpg' }]
    )).toBe('https://y.qq.com/music/photo_new/first-valid.jpg')
  })
})

describe('handleQQLyric identifiers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('不会把字母数字混合的 mid 抽取成错误 songID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ lyric: { data: { lyric: '[00:00.00]正确歌词' } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await handleQQLyric(LOGGED_IN_COOKIE, '003a1B2c', '003a1B2c')

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.lyric.param).toEqual({ songMID: '003a1B2c' })
  })

  it('真实数字 qqId 仍会作为 songID 发送', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ lyric: { data: { lyric: '[00:00.00]正确歌词' } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await handleQQLyric(LOGGED_IN_COOKIE, '003a1B2c', '123456')

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.lyric.param).toEqual({ songMID: '003a1B2c', songID: 123456 })
  })
})

describe('QQ 标识与歌单详情契约', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('识别普通歌单、我喜欢和榜单的稳定 id', () => {
    expect(qqPlaylistReference('123456')).toEqual({ kind: 'playlist', id: '123456' })
    expect(qqPlaylistReference('qq-liked:201')).toEqual({ kind: 'liked', id: '201' })
    expect(qqPlaylistReference('qq-toplist:62')).toEqual({ kind: 'toplist', id: '62' })
    expect(isQQLikedPlaylistReference('qq-liked:201')).toBe(true)
    expect(isQQLikedPlaylistReference('qq-liked:not-a-dirid')).toBe(false)
    expect(isQQToplistReference('qq-toplist:62')).toBe(true)
    expect(isQQToplistReference('qq-toplist:')).toBe(false)
    expect(isQQToplistReference('qq-toplist:not-a-number')).toBe(false)
  })

  it('歌手和歌曲映射统一使用 MID，并单独保留数字 QQ id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        singer: {
          code: 0,
          data: {
            singer_info: { id: 99, mid: 'artist-mid', name: '测试歌手' },
            singer_brief: '公开的歌手简介',
            songlist: [{
              track_info: {
                id: 123,
                mid: 'song-mid',
                name: '测试歌曲',
                singer: [{ id: 99, mid: 'artist-mid', name: '测试歌手' }],
                album: { mid: 'album-mid', name: '测试专辑' },
                file: { media_mid: 'media-mid' },
              },
            }],
          },
        },
      }),
    }))

    const result = await handleQQArtistDetail('', 'artist-mid', 36)
    const artist = result.artist as Record<string, unknown>
    const song = (result.songs as Record<string, unknown>[])[0]

    expect(artist).toMatchObject({ id: 'artist-mid', mid: 'artist-mid', qqArtistId: 99, description: '公开的歌手简介' })
    expect(song).toMatchObject({ id: 'song-mid', mid: 'song-mid', qqId: 123, mediaMid: 'media-mid' })
    expect(song.artists).toEqual([
      { id: 'artist-mid', mid: 'artist-mid', qqArtistId: 99, name: '测试歌手' },
    ])
  })

  it('相似歌手只传 singerMid，并按 MID 去重映射', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        similarSinger: {
          code: 0,
          data: {
            singerlist: [
              { singerId: 1, singerMid: 'artist-mid', singerName: '当前歌手', singerPic: 'https://y.qq.com/self.jpg' },
              { singerId: 2, singerMid: 'similar-mid', singerName: '相似歌手', singerPic: '//y.qq.com/similar.jpg' },
              { singerId: 2, singerMid: 'similar-mid', singerName: '重复歌手' },
              { singerId: 3, singerName: '缺少 MID' },
            ],
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQArtistSimilar('', 'artist-mid', 10)

    expect(result.artists).toEqual([{
      provider: 'qq',
      source: 'qq',
      id: 'similar-mid',
      mid: 'similar-mid',
      qqArtistId: 2,
      name: '相似歌手',
      avatar: 'https://y.qq.com/similar.jpg',
    }])
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.similarSinger).toEqual({
      module: 'music.SimilarSingerSvr',
      method: 'GetSimilarSingerList',
      param: { singerMid: 'artist-mid', number: 10 },
    })
  })

  it.each([
    {},
    { similarSinger: { code: 1 } },
    { code: 1, similarSinger: { code: 0, data: { singerlist: [] } } },
  ])('相似歌手上游失败抛错，不返回成功空列表：%j', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(response),
    }))
    await expect(handleQQArtistSimilar('', 'artist-mid', 10)).rejects.toThrow('QQ_ARTIST_SIMILAR_FAILED')
  })

  it('相似歌手成功空结果仍保持空列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ similarSinger: { code: 0, data: { singerlist: [] } } }),
    }))
    await expect(handleQQArtistSimilar('', 'artist-mid', 10)).resolves.toMatchObject({ artists: [] })
  })

  it('专辑详情映射发行信息和简介，不把 albumDuration 当作曲目数', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        albumInfo: {
          code: 0,
          data: {
            basicInfo: {
              albumID: 123,
              albumMid: 'album-mid',
              albumName: '测试专辑',
              publishDate: '2025-08-30',
              desc: '专辑简介',
              albumDuration: 12,
            },
            company: { ID: 9, name: '测试唱片公司' },
            singer: {
              singerList: [
                { singerID: 1, mid: 'artist-a', name: '歌手 A' },
                { singerID: 2, mid: 'artist-b', name: '歌手 B' },
              ],
            },
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQAlbumDetail('', ' album-mid ')

    expect(result.playlist).toEqual({
      provider: 'qq',
      source: 'qq',
      type: 'album',
      id: 'album-mid',
      qqAlbumId: 123,
      name: '测试专辑',
      cover: 'https://y.qq.com/music/photo_new/T002R300x300M000album-mid.jpg?max_age=2592000',
      trackCount: 0,
      playCount: 0,
      creator: '歌手 A / 歌手 B',
      tag: '2025-08-30 · 测试唱片公司',
      description: '专辑简介',
    })
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.albumInfo).toEqual({
      module: 'music.musichallAlbum.AlbumInfoServer',
      method: 'GetAlbumDetail',
      param: { albumMId: 'album-mid' },
    })
  })

  it.each([{}, { albumInfo: { code: 1 } }, { albumInfo: { code: 0, data: {} } }])(
    '专辑详情缺失或失败时不伪造空白专辑：%j',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify(response),
      }))
      await expect(handleQQAlbumDetail('', 'album-mid')).resolves.toMatchObject({ playlist: null })
    }
  )

  it('空白专辑 MID 不发上游请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(handleQQAlbumDetail('', '  ')).resolves.toMatchObject({ playlist: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('普通歌单通过新详情接口分页取全，保持歌曲顺序与标识语义', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body))
      const offset = request.playlist.param.song_begin
      const track = offset === 0
        ? { id: 1, mid: 'song-a', name: '歌曲 A' }
        : { id: 2, mid: 'song-b', name: '歌曲 B' }
      return Promise.resolve({
        status: 200,
        text: async () => JSON.stringify({
          playlist: {
            code: 0,
            data: {
              dirinfo: { title: '测试歌单', total_song_num: 2 },
              songlist: [{
                ...track,
                singer: [{ id: 9, mid: 'artist-mid', name: '测试歌手' }],
                album: { mid: 'album-mid', name: '测试专辑' },
                file: { media_mid: `media-${track.id}` },
              }],
              total_song_num: 2,
              hasmore: offset === 0 ? 1 : 0,
            },
          },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQPlaylistTracks('', '123456')

    expect(result.trackIds).toEqual(['song-a', 'song-b'])
    expect((result.tracks as Record<string, unknown>[]).map((track) => track.id)).toEqual(['song-a', 'song-b'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(firstRequest.playlist).toMatchObject({
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: { disstid: 123456, dirid: 0, song_begin: 0 },
    })
  })

  it('普通账号歌单以数字 disstid 请求，避免上游参数错误', async () => {
    const fetchMock = vi.fn().mockImplementation((_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body))
      const numeric = request.playlist.param.disstid === 7799808010
      return Promise.resolve({ status: 200, text: async () => JSON.stringify({ playlist: {
        code: numeric ? 0 : 10004,
        message: numeric ? '' : 'param error',
        data: { dirinfo: { title: '账号歌单' }, songlist: [{ id: 1, mid: 'song-mid', name: '歌曲' }], hasmore: 0 },
      } }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await handleQQPlaylistTracks(LOGGED_IN_COOKIE, '7799808010')
    expect(result.trackIds).toEqual(['song-mid'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['not-a-number', '1e3', '0', '-1', '9007199254740993'])('非法普通歌单 id 不访问上游：%s', async (id) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(handleQQPlaylistTracks(LOGGED_IN_COOKIE, id)).rejects.toThrow('Invalid QQ playlist id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未登录读取“我喜欢”时不访问上游', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQPlaylistTracks('', 'qq-liked:201')

    expect(result).toMatchObject({ loggedIn: false, tracks: [], trackIds: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未登录读取“我喜欢”入口时返回登录空状态且不访问上游', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQLikedPlaylist('')

    expect(result).toEqual({ loggedIn: false, provider: 'qq', playlist: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('空的“我喜欢”仍返回可打开的稳定歌单入口', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        playlist: {
          code: 0,
          data: {
            dirinfo: { title: '我喜欢的音乐', total_song_num: 0, logo: '//y.qq.com/liked.jpg' },
            songlist: [],
            total_song_num: 0,
            hasmore: 0,
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQLikedPlaylist(LOGGED_IN_COOKIE)

    expect(result).toMatchObject({
      loggedIn: true,
      provider: 'qq',
      playlist: {
        id: 'qq-liked:201',
        name: '我喜欢的音乐',
        cover: 'https://y.qq.com/liked.jpg',
        trackCount: 0,
        type: 'playlist',
      },
    })
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.playlist.param).toMatchObject({ disstid: 0, dirid: 201, song_begin: 0, song_num: 1 })
  })

  it('“我喜欢”上游明确返回登录失效时归一为 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        playlist: { code: 1000, message: 'login expired' },
      }),
    }))

    const error = await handleQQLikedPlaylist(LOGGED_IN_COOKIE).catch((reason) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('AUTH_EXPIRED')
    expect(qqAuthErrorStatus(error)).toBe(403)
  })

  it('账号歌单把“我喜欢”映射为同一虚拟 id 并去重', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const url = String(input)
      let body: Record<string, unknown> = {}
      if (url.includes('fcg_user_created_diss')) {
        body = {
          data: {
            disslist: [
              { dissid: 201, dirid: 201, diss_name: '我喜欢' },
              { dissid: 123, dirid: 123, diss_name: '我喜欢的跑步歌单' },
            ],
          },
        }
      } else if (url.includes('fcg_get_profile_order_asset')) {
        body = { data: { cdlist: [{ dissid: 456, dirid: 201, diss_name: '我喜欢的音乐' }] } }
      }
      return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQUserPlaylists(LOGGED_IN_COOKIE)
    const playlists = result.playlists as Record<string, unknown>[]

    expect(playlists.filter((playlist) => playlist.id === 'qq-liked:201')).toHaveLength(1)
    expect(playlists.map((playlist) => playlist.id)).toContain('123')
    expect(playlists.every((playlist) => playlist.type === 'playlist')).toBe(true)
  })

  it.each(['album', 'empty', 'failed'] as const)('账号歌单缺少我喜欢封面时补取首曲专辑图：%s', async (outcome) => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const url = String(input)
      let body: Record<string, unknown> = {}
      if (url.includes('fcg_user_created_diss')) {
        body = { data: { disslist: [
          { dissid: 201, dirid: 201, diss_name: '收藏歌曲', song_cnt: 162 },
          { dissid: 123, diss_name: '普通歌单', logo: '//y.qq.com/normal.jpg' },
        ] } }
      } else if (url.includes('musicu.fcg')) {
        if (outcome === 'failed') return Promise.reject(new Error('cover unavailable'))
        body = { playlist: { code: 0, data: {
          dirinfo: { title: '我喜欢', total_song_num: 162 },
          songlist: outcome === 'album' ? [{ mid: 'song-mid', name: '首曲', album: { mid: 'album-mid' } }] : [],
        } } }
      }
      return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQUserPlaylists(LOGGED_IN_COOKIE)
    const playlists = result.playlists as Record<string, unknown>[]

    expect(playlists[0]).toMatchObject({
      id: 'qq-liked:201', type: 'playlist', name: '收藏歌曲', trackCount: 162,
      cover: outcome === 'album' ? 'https://y.qq.com/music/photo_new/T002R300x300M000album-mid.jpg?max_age=2592000' : '',
    })
    expect(playlists[1]).toMatchObject({ id: '123', type: 'playlist', cover: 'https://y.qq.com/normal.jpg' })
    const detailCall = fetchMock.mock.calls.find(([url]) => String(url).includes('musicu.fcg'))
    expect(detailCall).toBeDefined()
    expect(JSON.parse(String(detailCall![1]?.body)).playlist.param).toMatchObject({ dirid: 201, song_num: 1 })
  })

  it('我喜欢已有列表封面时保留封面且不追加详情请求', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve({
      status: 200,
      text: async () => JSON.stringify(String(input).includes('fcg_user_created_diss')
        ? { data: { disslist: [{ dissid: 201, dirid: 201, diss_name: '我喜欢', logo: '//y.qq.com/liked.jpg' }] } }
        : {}),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQUserPlaylists(LOGGED_IN_COOKIE)

    expect((result.playlists as Record<string, unknown>[])[0]).toMatchObject({
      id: 'qq-liked:201', type: 'playlist', cover: 'https://y.qq.com/liked.jpg',
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('musicu.fcg'))).toBe(false)
  })

  it('歌单中的合法重复歌曲保持原始位置和数量', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        playlist: {
          code: 0,
          data: {
            dirinfo: { title: '重复歌曲歌单', total_song_num: 2 },
            songlist: [1, 2].map((id) => ({
              id,
              mid: 'same-song-mid',
              name: '同一首歌',
              singer: [{ id: 9, mid: 'artist-mid', name: '测试歌手' }],
            })),
            total_song_num: 2,
            hasmore: 0,
          },
        },
      }),
    }))

    const result = await handleQQPlaylistTracks('', '123456')

    expect(result.trackIds).toEqual(['same-song-mid', 'same-song-mid'])
  })

  it('榜单虚拟 id 只把 topId 传给榜单详情接口', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        toplist: {
          code: 0,
          data: {
            data: { title: '流行指数榜', totalNum: 1 },
            songInfoList: [{
              id: 3,
              mid: 'song-top',
              name: '榜单歌曲',
              singer: [{ id: 9, mid: 'artist-mid', name: '测试歌手' }],
              album: { mid: 'album-mid', name: '测试专辑' },
              file: { media_mid: 'media-top' },
            }],
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQPlaylistTracks('', 'qq-toplist:62')

    expect(result.trackIds).toEqual(['song-top'])
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.toplist.param).toMatchObject({ topId: 62, offset: 0 })
  })
})

describe('handleQQSearch 正式歌曲搜索', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('只发送一次特殊信封请求并映射完整歌曲标识', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        'music.search.SearchCgiService': {
          code: 0,
          data: {
            body: {
              song: {
                list: [{
                  id: 123,
                  mid: 'song-mid',
                  name: '测试歌曲',
                  singer: [{ id: 99, mid: 'artist-mid', name: '测试歌手' }],
                  album: { mid: 'album-mid', name: '测试专辑' },
                  file: { media_mid: 'media-mid' },
                  interval: 180,
                  pay: { pay_play: 1 },
                }],
              },
            },
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const songs = await handleQQSearch('', '周杰伦', 99)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(Object.keys(request)).toEqual(['music.search.SearchCgiService'])
    expect(request['music.search.SearchCgiService']).toEqual({
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { search_type: 0, query: '周杰伦', page_num: 1, num_per_page: 20 },
    })
    expect(songs[0]).toMatchObject({
      id: 'song-mid',
      mid: 'song-mid',
      qqId: 123,
      mediaMid: 'media-mid',
      duration: 180000,
      fee: 1,
    })
    expect(songs[0].artists).toEqual([
      { id: 'artist-mid', mid: 'artist-mid', qqArtistId: 99, name: '测试歌手' },
    ])
  })

  it('歌手缺少 MID 时仍保留展示名，但不伪造可导航歌手', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        'music.search.SearchCgiService': {
          code: 0,
          data: {
            body: {
              song: {
                list: [{
                  id: 123,
                  mid: 'song-mid',
                  name: '测试歌曲',
                  singer: [{ id: 99, mid: '', name: '仅有名称的歌手' }],
                }],
              },
            },
          },
        },
      }),
    }))

    const songs = await handleQQSearch('', '测试', 20)

    expect(songs[0]).toMatchObject({
      artist: '仅有名称的歌手',
      artists: [{ id: null, name: '仅有名称的歌手' }],
    })
    expect(songs[0].artistId).toBeUndefined()
  })

  it('合作曲完整保留混合 MID 歌手，并仅用有效 MID 导航', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        'music.search.SearchCgiService': { code: 0, data: { body: { song: { list: [{
          mid: 'song-mid', name: '合作曲', singer: [
            { mid: '', name: '无 MID 歌手' },
            { mid: 'artist-mid', name: '有 MID 歌手' },
          ],
        }] } } } },
      }),
    }))
    const [song] = await handleQQSearch('', '合作曲', 20)
    expect(song).toMatchObject({
      artist: '无 MID 歌手 / 有 MID 歌手',
      artists: [{ id: null, name: '无 MID 歌手' }, { id: 'artist-mid', name: '有 MID 歌手' }],
      artistId: 'artist-mid', artistMid: 'artist-mid',
    })
  })

  it('空关键词不访问上游，空结果保持空数组', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        'music.search.SearchCgiService': {
          code: 0,
          data: { body: { song: { list: [] } } },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(handleQQSearch('', '   ', 20)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(handleQQSearch('', '无结果', 20)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('按歌曲 MID 去重并保持上游顺序', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        'music.search.SearchCgiService': {
          code: 0,
          data: {
            body: {
              song: {
                list: [
                  { id: 1, mid: 'song-a', name: '歌曲 A' },
                  { id: 2, mid: 'song-a', name: '歌曲 A 重复项' },
                  { id: 3, mid: 'song-b', name: '歌曲 B' },
                ],
              },
            },
          },
        },
      }),
    }))

    const songs = await handleQQSearch('', '测试', 20)

    expect(songs.map((song) => song.id)).toEqual(['song-a', 'song-b'])
  })
})

describe.each([
  { label: '歌曲', search: handleQQSearch, kind: 'song', item: { mid: 'song-mid', name: '测试歌曲' } },
  { label: '歌手', search: handleQQArtistSearch, kind: 'singer', item: { singerMID: 'artist-mid', singerName: '测试歌手' } },
])('QQ $label 搜索上游错误', ({ search, kind, item }) => {
  const module = 'music.search.SearchCgiService'
  const response = (json: unknown) => ({ status: 200, text: async () => JSON.stringify(json) })
  const success = () => response({ code: 0, [module]: { code: 0, data: { body: { [kind]: { list: [item] } } } } })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([
    { code: 0, [module]: { code: 2001 } },
    { code: 2001 },
  ])('2001 响应 %j 稍后重试一次并恢复结果', async (failure) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValueOnce(response(failure)).mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    const pending = search('', '测试', 5)
    await vi.advanceTimersByTimeAsync(299)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body)
  })

  it('持续 2001 最多请求五次，保留错误码且不再等待', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 0, [module]: { code: 2001 } }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = expect(search('', '测试', 5)).rejects.toThrow('2001')
    await vi.advanceTimersByTimeAsync(1200)
    await pending
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('前四次 2001，第五次成功仍返回结果', async () => {
    vi.useFakeTimers()
    const failure = response({ code: 0, [module]: { code: 2001 } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    const pending = search('', '测试', 5)
    await vi.advanceTimersByTimeAsync(1200)
    await expect(pending).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it.each([
    { code: 10000, [module]: { code: 0 } },
    { code: 0, [module]: { code: 10000 } },
    { code: 0 },
  ])('其他失败 %j 不重试，也不伪装为空结果', async (failure) => {
    const fetchMock = vi.fn().mockResolvedValue(response(failure))
    vi.stubGlobal('fetch', fetchMock)
    await expect(search('', '测试', 5)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('网络失败直接报错，不额外重试', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(search('', '测试', 5)).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('合法空结果不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 0, [module]: { code: 0, data: { body: { [kind]: { list: [] } } } } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(search('', '测试', 5)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('QQ 音乐排行榜', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('映射 GetAll 分组、榜单虚拟 id 与上游自带 Top3', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        toplists: {
          code: 0,
          data: {
            group: [{
              groupName: '巅峰榜',
              toplist: [{
                topId: 62,
                title: '飙升榜',
                frontPicUrl: 'https://y.qq.com/toplist-62.jpg',
                songNum: 100,
                intro: '榜单定义<br> 每日更新<br/> 按涨幅排序',
                updateTime: '刚刚更新',
                song: [
                  { title: '歌曲 A', singerName: '歌手 A' },
                  { title: '歌曲 B', singerName: '歌手 B' },
                  { title: '歌曲 C', singerName: '歌手 C' },
                  { title: '歌曲 D', singerName: '歌手 D' },
                ],
              }],
            }],
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQToplists('')
    const groups = result.groups as Array<Record<string, unknown>>
    const entry = (groups[0].entries as Array<Record<string, unknown>>)[0]

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.toplists).toEqual({
      module: 'music.musicToplist.Toplist',
      method: 'GetAll',
      param: {},
    })
    expect(groups[0].title).toBe('巅峰榜')
    expect(entry.playlist).toMatchObject({
      provider: 'qq',
      source: 'qq',
      type: 'playlist',
      id: 'qq-toplist:62',
      name: '飙升榜',
      trackCount: 100,
      description: '榜单定义\n每日更新\n按涨幅排序',
    })
    expect(entry.updateFrequency).toBe('刚刚更新')
    expect(entry.preview).toEqual([
      { name: '歌曲 A', artist: '歌手 A' },
      { name: '歌曲 B', artist: '歌手 B' },
      { name: '歌曲 C', artist: '歌手 C' },
    ])
  })

  it('缺少 GetAll 预览时只补拉榜单详情前三首', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        toplist: {
          code: 0,
          data: {
            songInfoList: [
              { mid: 'song-a', name: '歌曲 A', singer: [{ mid: 'artist-a', name: '歌手 A' }] },
              { mid: 'song-b', name: '歌曲 B', singer: [{ mid: 'artist-b', name: '歌手 B' }] },
              { mid: 'song-c', name: '歌曲 C', singer: [{ mid: 'artist-c', name: '歌手 C' }] },
            ],
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleQQToplistPreview('', 'qq-toplist:62')

    expect(result.preview).toEqual([
      { name: '歌曲 A', artist: '歌手 A' },
      { name: '歌曲 B', artist: '歌手 B' },
      { name: '歌曲 C', artist: '歌手 C' },
    ])
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.toplist.param).toEqual({ topId: 62, offset: 0, num: 3, withTags: true })
  })

  it('畸形榜单虚拟 id 不访问上游', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(handleQQToplistPreview('', 'qq-toplist:')).resolves.toMatchObject({
      error: 'INVALID_QQ_TOPLIST_ID',
      preview: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function mockVkeyResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [{ purl: '', result: 104003, msg: '', tips: '', ...overrides }],
            sip: ['https://ws.stream.qqmusic.qq.com/'],
          },
        },
      }),
  }
}

describe('handleQQSongUrl restriction classification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flags a fee-tagged (VIP) song as paid_required instead of generic copyright_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockVkeyResponse()))
    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'standard', '1')
    expect(res.playable).toBe(false)
    expect((res.restriction as { category: string }).category).toBe('paid_required')
  })

  it('keeps copyright_unavailable for the same upstream code when the track has no fee flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockVkeyResponse()))
    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'standard', '0')
    expect(res.playable).toBe(false)
    expect((res.restriction as { category: string }).category).toBe('copyright_unavailable')
  })

  it('按音质优先级和 sip 顺序返回有限的多个播放地址', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              { filename: 'M500somemid.mp3', purl: 'standard.mp3' },
              { filename: 'M800somemid.mp3', purl: 'exhigh.mp3' },
            ],
            sip: ['https://cdn-a.test/', 'https://cdn-b.test/'],
          },
        },
      }),
    }))

    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'exhigh', '0')
    expect(res.url).toBe('https://cdn-a.test/exhigh.mp3')
    expect(res.candidates).toEqual([
      expect.objectContaining({ url: 'https://cdn-a.test/exhigh.mp3', level: 'exhigh' }),
      expect.objectContaining({ url: 'https://cdn-b.test/exhigh.mp3', level: 'exhigh' }),
      expect.objectContaining({ url: 'https://cdn-a.test/standard.mp3', level: 'standard' }),
      expect.objectContaining({ url: 'https://cdn-b.test/standard.mp3', level: 'standard' }),
    ])
  })

  it('歌曲 mid 与 mediaMid 不同时优先使用真实音频文件标识', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              { filename: 'M500song-mid.mp3', purl: 'wrong-file.mp3' },
              { filename: 'M500file-mid.mp3', purl: 'right-file.mp3' },
            ],
            sip: ['https://cdn.test/'],
          },
        },
      }),
    }))

    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'song-mid', 'file-mid', 'standard', '0')

    expect(res.filename).toBe('M500file-mid.mp3')
    expect(res.url).toBe('https://cdn.test/right-file.mp3')
  })
})

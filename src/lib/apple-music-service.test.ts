import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppleMusicService, appendUniqueAppleCharts, appleMusicTrackUrl, mapAppleTrack, pickAppleRecommendationFeatures } from './apple-music-service'
import { appleMusicProvider } from '../providers/apple-music-provider'
import { api } from './api'
import { appleMusicApiUrl } from '../../server/lib/apple-music'
import type { Playlist } from '../types/domain'

vi.mock('./api', () => ({ api: { get: vi.fn() } }))
const get = vi.mocked(api.get)
const song = (id: string, type = 'songs') => ({ id, type, attributes: { name: '歌曲', artistName: '歌手', durationInMillis: 180000, artwork: { url: 'https://example.com/{w}x{h}.jpg' } } })

beforeEach(() => { get.mockReset() })

describe('Apple Music service', () => {
  it('所有公开查询方法生成的路径均通过实际服务端白名单', async () => {
    const paths: string[] = []
    get.mockImplementation(async (endpoint, params) => {
      if (endpoint === '/api/apple-music/status') return { storefront: 'us', loggedIn: true }
      const path = String(params?.path)
      paths.push(path)
      expect(appleMusicApiUrl(path).origin).toBe('https://api.music.apple.com')
      return { data: [song('123')], results: {} }
    })
    const service = new AppleMusicService()
    await service.searchTracks('测试 & / ? 😀')
    await service.searchArtists('艺人')
    await service.searchAlbums('专辑')
    await service.searchPlaylists('歌单')
    await service.getArtistDetail(123)
    await service.getArtistSongs(123)
    await service.getArtistAlbums(123)
    await service.getAlbumDetail(123)
    await service.getAlbumTracks(123)
    await service.getAlbumDetail('l.library')
    await service.getAlbumTracks('l.library')
    await service.getPlaylistSkeleton('pl.catalog')
    await service.getPlaylistSkeleton('p.library')
    await service.getTracksByIds([123, 'i.library'])
    await service.getUserPlaylists()
    await service.getUserAlbums()
    await service.getRecommendPlaylists()
    await service.getChartPlaylistsPage()
    await service.getStorefrontChartPlaylists()
    await service.getRecommendationGroups()
    expect(paths).toHaveLength(21)
    expect(paths.some((path) => path.includes('/artists/123/view/top-songs'))).toBe(true)
  })

  it('大批补齐遵守每批100个ID，乱序和缺失响应不改变剩余曲目顺序', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => String(index + 1))
    const batches: string[][] = []
    get.mockImplementation(async (endpoint, params) => {
      if (endpoint.endsWith('/status')) return { storefront: 'cn' }
      const batch = new URL(String(params?.path), 'https://api.music.apple.com').searchParams.get('ids')!.split(',')
      batches.push(batch)
      return { data: batch.filter((id) => id !== '102').reverse().map((id) => song(id)) }
    })
    const tracks = await new AppleMusicService().getTracksByIds(ids)
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5])
    expect(tracks.map((track) => track.id)).toEqual(ids.filter((id) => id !== '102'))
  })

  it('没有待补齐ID时不请求账户或曲库', async () => {
    expect(await new AppleMusicService().getTracksByIds([])).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it('专辑完整翻页并排除MV，不将缺失专辑伪造成存在', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' })
      .mockResolvedValueOnce({ data: [song('1'), song('mv', 'music-videos')], next: '/v1/catalog/cn/albums/123/tracks?offset=2' })
      .mockResolvedValueOnce({ data: [song('2')] })
    const service = new AppleMusicService()
    expect((await service.getAlbumTracks(123)).map((track) => track.id)).toEqual(['1', '2'])
    get.mockResolvedValueOnce({ storefront: 'cn' }).mockResolvedValueOnce({ data: [] })
    expect(await service.getAlbumDetail('missing')).toBeNull()
  })

  it('已登录个人库读取后续分页，后页失败不返回看似完整的前缀', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [{ id: 'p.first', type: 'library-playlists' }], next: '/v1/me/library/playlists?offset=100' })
      .mockRejectedValueOnce(new Error('Apple Music 请求超时'))
    await expect(new AppleMusicService().getUserPlaylists()).rejects.toThrow('请求超时')
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/me/library/playlists?offset=100' })
  })

  it('资料库歌单列表缺少歌曲数时，从曲目关系读取真实总数', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [{ id: 'p.favorite', type: 'library-playlists', attributes: { name: '喜爱歌曲' } }] })
      .mockResolvedValueOnce({ data: [song('i.first', 'library-songs')], meta: { total: 42 }, next: '/v1/me/library/playlists/p.favorite/tracks?offset=1' })

    const playlists = await new AppleMusicService().getUserPlaylists()

    expect(playlists).toMatchObject([{ id: 'p.favorite', trackCount: 42, trackCountKnown: true }])
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/me/library/playlists/p.favorite/tracks?limit=1' })
  })

  it('收藏入口只选择喜爱歌曲歌单，保留真实曲目数', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [
        { id: 'p.travel', type: 'library-playlists', attributes: { name: '我喜爱的旅行歌曲' } },
        { id: 'p.favorite', type: 'library-playlists', attributes: { name: '喜爱歌曲' } },
      ] })
      .mockResolvedValueOnce({ data: [song('i.first', 'library-songs')], meta: { total: 42 } })

    expect(await new AppleMusicService().getLikedPlaylist()).toMatchObject({ id: 'p.favorite', trackCount: 42 })
    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/me/library/playlists/p.favorite/tracks?limit=1' })
  })

  it('没有喜爱歌曲歌单时不把普通歌单当作收藏入口', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [{ id: 'p.other', type: 'library-playlists', attributes: { name: 'Favorite Mix' } }] })
    expect(await new AppleMusicService().getLikedPlaylist()).toBeNull()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('按 Apple 推荐分组保留歌单与专辑顺序，忽略缺少标题的栏目', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [
        {
          id: 'mixes', type: 'personal-recommendation',
          attributes: { title: { stringForDisplay: '为你推荐' } },
          relationships: { contents: { data: [
            { id: 'pl.mix', type: 'playlists', attributes: { name: '周五放松', artwork: { url: 'https://example.com/{w}x{h}.jpg' } } },
            { id: 'album.1', type: 'albums', attributes: { name: '专辑' } },
          ] } },
        },
        { id: 'untitled', type: 'personal-recommendation', relationships: { contents: { data: [
          { id: 'pl.untitled', type: 'playlists', attributes: { name: '无标题' } },
        ] } } },
      ] })

    expect(await new AppleMusicService().getRecommendationGroups()).toMatchObject([
      { id: 'mixes', title: '为你推荐', items: [
        { id: 'pl.mix', name: '周五放松', source: 'apple', type: 'playlist' },
        { id: 'album.1', name: '专辑', source: 'apple', type: 'album' },
      ] },
    ])
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/me/recommendations' })
  })

  it('为你精选从每个分类稳定抽取一项，并避免跨分类重复', () => {
    const item = (id: string, type: Playlist['type'] = 'playlist'): Playlist => ({
      provider: 'apple', source: 'apple', type, id, name: id, cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music',
    })
    const firstGroup = Array.from({ length: 14 }, (_, index) => item(`pl.${index}`))
    const firstPick = pickAppleRecommendationFeatures([{ id: 'a', title: '专属推荐', items: firstGroup }], 42)[0].item
    const groups = [
      { id: 'a', title: '专属推荐', items: firstGroup },
      { id: 'b', title: '继续发现', items: [firstPick, item('pl.0', 'album')] },
      { id: 'empty', title: '空栏目', items: [] },
    ]
    const result = pickAppleRecommendationFeatures(groups, 42)
    expect(result).toEqual(pickAppleRecommendationFeatures(groups, 42))
    expect(result.map(feature => feature.moduleId)).toEqual(['a', 'b'])
    expect(new Set(result.map(feature => `${feature.item.type}:${feature.item.id}`)).size).toBe(2)
    expect(result[1]).toMatchObject({ item: { id: 'pl.0', type: 'album' }, groupTitle: '继续发现' })
  })

  it('未登录时不请求个性化推荐', async () => {
    get.mockResolvedValueOnce({ loggedIn: false })
    expect(await new AppleMusicService().getRecommendationGroups()).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('曲目数查询失败时保留歌单，但标记数量未知', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [{ id: 'p.favorite', type: 'library-playlists', attributes: { name: '喜爱歌曲' } }] })
      .mockRejectedValueOnce(new Error('暂时无法连接'))

    expect(await new AppleMusicService().getUserPlaylists()).toMatchObject([
      { id: 'p.favorite', trackCountKnown: false },
    ])
  })

  it('个人专辑完整翻页，详情和曲目走资料库路径', async () => {
    get.mockResolvedValueOnce({ loggedIn: true })
      .mockResolvedValueOnce({ data: [{ id: 'l.first', type: 'library-albums', attributes: { name: '专辑一' } }], next: '/v1/me/library/albums?offset=100' })
      .mockResolvedValueOnce({ data: [{ id: 'l.second', type: 'library-albums', attributes: { name: '专辑二' } }] })
      .mockResolvedValueOnce({ data: [{ id: 'l.first', type: 'library-albums', attributes: { name: '专辑一' } }] })
      .mockResolvedValueOnce({ data: [song('i.song', 'library-songs'), song('mv', 'music-videos')] })
    const service = new AppleMusicService()
    expect((await service.getUserAlbums()).map(album => album.id)).toEqual(['l.first', 'l.second'])
    expect(await service.getAlbumDetail('l.first')).toMatchObject({ id: 'l.first', type: 'album' })
    expect(await service.getAlbumTracks('l.first')).toMatchObject([{ id: 'i.song', appleLibrary: true }])
    expect(get.mock.calls.map(call => call[1]?.path).filter(Boolean)).toEqual([
      '/v1/me/library/albums?limit=100', '/v1/me/library/albums?offset=100',
      '/v1/me/library/albums/l.first', '/v1/me/library/albums/l.first/tracks',
    ])
  })

  it.each(['https://evil.test/v1/songs', '//evil.test/v1/songs', '/api/local/tracks'])(
    '拒绝异常分页地址 %s，不向其发送第二次请求', async (next) => {
      get.mockResolvedValueOnce({ data: [song('i.a', 'library-songs')], next })
      await expect(new AppleMusicService().getPlaylistSkeleton('p.a')).rejects.toThrow('分页地址无效')
      expect(get).toHaveBeenCalledOnce()
    }
  )

  it('艺人不存在明确报错；缺少曲目属性仍保留来源和身份', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' }).mockResolvedValueOnce({ data: [] })
    await expect(new AppleMusicService().getArtistDetail('123')).rejects.toThrow('歌手不存在')
    expect(mapAppleTrack({ id: '123', type: 'songs' })).toMatchObject({ source: 'apple', id: '123', name: '', artists: [], cover: '' })
  })

  it('地区字段不合法时只使用默认地区，搜索参数不会注入额外查询', async () => {
    get.mockResolvedValueOnce({ storefront: '../us' }).mockResolvedValueOnce({ results: {} })
    await new AppleMusicService().searchTracks('x&types=albums')
    const path = String(get.mock.calls[1][1]?.path)
    const url = appleMusicApiUrl(path)
    expect(url.pathname).toBe('/v1/catalog/cn/search')
    expect(url.searchParams.getAll('types')).toEqual(['songs'])
    expect(url.searchParams.get('term')).toBe('x&types=albums')
  })
  it('保留毫秒时长与资料库身份，不把试听地址当播放地址', () => {
    const track = mapAppleTrack(song('i.test', 'library-songs'))
    expect(track.duration).toBe(180000)
    expect(track.cover).toBe('https://example.com/600x600.jpg')
    expect(appleMusicTrackUrl(track)).toBe('apple-music:library:i.test')
    expect(appleMusicTrackUrl({ ...track, catalogId: '123' })).toBe('apple-music:123')
  })

  it('保留录音编号供同曲歌词校验', () => {
    const resource = song('123')
    expect(mapAppleTrack({ ...resource, attributes: { ...resource.attributes, isrc: 'USABC2600001' } }).isrc).toBe('USABC2600001')
  })

  it('搜索按账号 storefront 构造官方路径', async () => {
    get.mockResolvedValueOnce({ storefront: 'us' }).mockResolvedValueOnce({ results: { songs: { data: [song('1')] } } })
    const tracks = await new AppleMusicService().searchTracks('a & b')
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/catalog/us/search?types=songs&limit=25&include[songs]=artists&term=a%20%26%20b' })
    expect(tracks[0].source).toBe('apple')
  })

  it('资料库歌单完整翻页并保留重复曲目顺序', async () => {
    get.mockResolvedValueOnce({ data: [song('i.a', 'library-songs')], next: '/v1/me/library/playlists/p.a/tracks?offset=1' })
      .mockResolvedValueOnce({ data: [song('i.a', 'library-songs'), song('i.b', 'library-songs')] })
    const result = await new AppleMusicService().getPlaylistSkeleton('p.a')
    expect(result.trackIds).toEqual(['i.a', 'i.a', 'i.b'])
    expect(get).toHaveBeenNthCalledWith(1, '/api/apple-music/catalog', { path: '/v1/me/library/playlists/p.a/tracks' })
  })

  it('批量补齐区分目录和资料库，结果按输入含重复项排列', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' })
      .mockResolvedValueOnce({ data: [song('1'), song('2')] })
      .mockResolvedValueOnce({ data: [song('i.a', 'library-songs')] })
    const tracks = await new AppleMusicService().getTracksByIds(['2', 'i.a', '1', '2'])
    expect(tracks.map((track) => track.id)).toEqual(['2', 'i.a', '1', '2'])
    expect(get).toHaveBeenLastCalledWith('/api/apple-music/catalog', { path: '/v1/me/library/songs?ids=i.a&include=artists' })
  })

  it('热门歌单读取 charts 的分组结构并结束翻页', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' }).mockResolvedValueOnce({ results: { playlists: [{ data: [{ id: 'pl.test', type: 'playlists', attributes: { name: '热门', curatorName: 'Apple Music' } }] }] } })
    const service = new AppleMusicService()
    expect(await service.getRecommendPlaylists()).toMatchObject([{ id: 'pl.test', source: 'apple', name: '热门' }])
    expect(await service.getRecommendPlaylists(1)).toEqual([])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('榜单按 Apple 返回的游标继续加载，不丢失后续歌单', async () => {
    const next = '/v1/catalog/cn/charts?chart=most-played&limit=24&offset=24&types=playlists'
    get.mockResolvedValueOnce({ storefront: 'cn' })
      .mockResolvedValueOnce({ results: { playlists: [{ data: [{ id: 'pl.first', type: 'playlists', attributes: { name: '第一张' } }], next }] } })
      .mockResolvedValueOnce({ results: { playlists: [{ data: [{ id: 'pl.second', type: 'playlists', attributes: { name: '第二张' } }] }] } })

    const service = new AppleMusicService()
    expect(await service.getChartPlaylistsPage()).toMatchObject({ playlists: [{ id: 'pl.first' }], nextCursor: next })
    expect(await service.getChartPlaylistsPage(next)).toMatchObject({ playlists: [{ id: 'pl.second' }], nextCursor: undefined })
    expect(get).toHaveBeenNthCalledWith(2, '/api/apple-music/catalog', { path: '/v1/catalog/cn/charts?types=playlists&chart=most-played&limit=24' })
    expect(get).toHaveBeenNthCalledWith(3, '/api/apple-music/catalog', { path: next })
  })

  it('多页榜单合并时跳过已有和同页重复卡片', () => {
    const chart = (id: string): Playlist => ({ provider: 'apple', source: 'apple', type: 'playlist', id, name: id, cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music' })
    const first = chart('pl.first')
    const second = chart('pl.second')
    expect(appendUniqueAppleCharts([first], [first, second, second]).map(item => item.id)).toEqual(['pl.first', 'pl.second'])
  })

  it('榜单游标只能继续读取 charts', async () => {
    await expect(new AppleMusicService().getChartPlaylistsPage('/v1/me/library/songs')).rejects.toThrow('榜单分页地址无效')
    expect(get).not.toHaveBeenCalled()
  })

  it('地区榜单只读取当前地区的首批歌单', async () => {
    const next = '/v1/catalog/us/playlists?filter[storefront-chart]=us&offset=1'
    const data = Array.from({ length: 25 }, (_, index) => ({
      id: `pl.us-${index + 1}`, type: 'playlists', attributes: { name: `Top 100: ${index + 1}` },
    }))
    get.mockResolvedValueOnce({ storefront: 'us' })
      .mockResolvedValueOnce({ data, next })
    const playlists = await new AppleMusicService().getStorefrontChartPlaylists()
    expect(playlists).toHaveLength(20)
    expect(playlists[0]).toMatchObject({ id: 'pl.us-1', source: 'apple' })
    expect(playlists.at(-1)).toMatchObject({ id: 'pl.us-20' })
    expect(get).toHaveBeenNthCalledWith(2, '/api/apple-music/catalog', { path: '/v1/catalog/us/playlists?filter[storefront-chart]=us' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('未登录资料库为空，避免发起需用户授权请求', async () => {
    get.mockResolvedValueOnce({ loggedIn: false })
    expect(await new AppleMusicService().getUserPlaylists()).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('异常循环分页明确失败，不交付截断歌单', async () => {
    get.mockResolvedValue({ data: [], next: '/v1/me/library/playlists/p.a/tracks' })
    await expect(new AppleMusicService().getPlaylistSkeleton('p.a')).rejects.toThrow('分页地址无效')
  })

  it('provider 只返回 MusicKit 播放标识且不声明不支持能力', async () => {
    const candidates = await appleMusicProvider.playback.resolve(mapAppleTrack(song('123')), 'max')
    expect(candidates[0]).toMatchObject({ source: 'apple', url: 'apple-music:123', trial: false })
    expect(appleMusicProvider.playlistWriter).toBeUndefined()
    expect(appleMusicProvider.library?.getLikedPlaylist).toBeTypeOf('function')
    expect(appleMusicProvider.descriptor.defaultEnabled).toBe(false)
    const controller = new AbortController()
    controller.abort()
    await expect(appleMusicProvider.playback.resolve(mapAppleTrack(song('1')), 'max', controller.signal)).rejects.toThrow('Aborted')
  })
})


describe('Apple 专辑和歌单搜索', () => {
  it('搜索歌单缺少曲目关系时数量为未知，保留独立 charts 返回结构', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' }).mockResolvedValueOnce({ results: { playlists: { data: [{ id: 'pl.one', type: 'playlists', attributes: { name: '歌单' } }] } } })
    const result = await new AppleMusicService().searchPlaylists('测试 & 😀')
    expect(result[0]).toMatchObject({ source: 'apple', type: 'playlist', trackCountKnown: false })
    expect(String(get.mock.calls.at(-1)?.[1]?.path)).toContain('types=playlists')
    expect(String(get.mock.calls.at(-1)?.[1]?.path)).toContain(encodeURIComponent('测试 & 😀'))
  })
  it('搜索专辑保留总数和来源，不把专辑当歌单', async () => {
    get.mockResolvedValueOnce({ storefront: 'cn' }).mockResolvedValueOnce({ results: { albums: { data: [{ id: '123', type: 'albums', attributes: { name: '专辑', trackCount: 12 } }] } } })
    expect((await new AppleMusicService().searchAlbums('关键词'))[0]).toMatchObject({ source: 'apple', type: 'album', trackCount: 12, trackCountKnown: true })
  })
})

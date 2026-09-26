import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppleMusicService, appleMusicTrackUrl, mapAppleTrack } from './apple-music-service'
import { appleMusicProvider } from '../providers/apple-music-provider'
import { api } from './api'
import { appleMusicApiUrl } from '../../server/lib/apple-music'

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
    await service.getArtistDetail(123)
    await service.getArtistSongs(123)
    await service.getArtistAlbums(123)
    await service.getAlbumDetail(123)
    await service.getAlbumTracks(123)
    await service.getPlaylistSkeleton('pl.catalog')
    await service.getPlaylistSkeleton('p.library')
    await service.getTracksByIds([123, 'i.library'])
    await service.getUserPlaylists()
    await service.getRecommendPlaylists()
    expect(paths).toHaveLength(13)
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
    expect(appleMusicProvider.library?.getLikedPlaylist).toBeUndefined()
    expect(appleMusicProvider.descriptor.defaultEnabled).toBe(false)
    const controller = new AbortController()
    controller.abort()
    await expect(appleMusicProvider.playback.resolve(mapAppleTrack(song('1')), 'max', controller.signal)).rejects.toThrow('Aborted')
  })
})

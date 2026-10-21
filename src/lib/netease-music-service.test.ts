import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { NeteaseMusicService } from './netease-music-service'
import type { Track } from '../types/domain'
import { fetchLyrics } from './lyrics-fetch'
import { clearProviderRequestCache } from './provider-request-cache'
import { useSettingsStore } from '../stores/settings'

describe('网易云刷歌选段与展示歌词共享', () => {
  // 校验的是请求共享，AMLL 逐字兜底在 lyrics-fetch.test 单独覆盖
  beforeEach(() => { useSettingsStore.setState({ lyricsAmllFallback: false, lyricsKugouFallback: false }) })
  afterEach(() => {
    clearProviderRequestCache()
    vi.restoreAllMocks()
  })

  it('解析真实 LRC 响应且与页面共享同一请求', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ lyric: '[00:12.00]第一句\n[00:18.00]第二句' })
    const track = { id: 'highlight', source: 'netease' } as Track
    const [highlight, display] = await Promise.all([
      new NeteaseMusicService().getLyrics(track),
      fetchLyrics(track),
    ])
    expect(highlight).toEqual([{ time: 12, text: '第一句' }, { time: 18, text: '第二句' }])
    expect(display.main).toEqual(highlight)
    expect(get).toHaveBeenCalledOnce()
  })
})

describe('网易云热搜服务', () => {
  afterEach(() => vi.restoreAllMocks())

  it('请求网易云自己的热搜入口', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ keywords: ['晴天', '稻香'] })
    await expect(new NeteaseMusicService().getSearchHotkeys()).resolves.toEqual(['晴天', '稻香'])
    expect(get).toHaveBeenCalledWith('/api/search/hotkeys')
  })

  it('失败向上抛出，由热词区域展示降级提示', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    await expect(new NeteaseMusicService().getSearchHotkeys()).rejects.toThrow('offline')
  })
})

describe('网易云歌手歌曲分页', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按服务端游标继续加载并保留是否还有下一页', async () => {
    const songs = [{ id: 51, source: 'netease' }]
    const get = vi.spyOn(api, 'get').mockResolvedValue({ songs, nextOffset: 137, hasMore: true })

    await expect(new NeteaseMusicService().getArtistSongsPage('artist-id', 82, 50)).resolves.toEqual({
      songs,
      nextOffset: 137,
      hasMore: true,
    })
    expect(get).toHaveBeenCalledWith('/api/netease/artist/songs', {
      id: 'artist-id',
      offset: 82,
      limit: 50,
    })
  })
})

describe('网易云歌单变更检查', () => {
  afterEach(() => vi.restoreAllMocks())

  it('只请求歌单版本信息', async () => {
    const revision = { updatedAt: 123, trackIds: ['1', '2'] }
    const get = vi.spyOn(api, 'get').mockResolvedValue(revision)
    await expect(new NeteaseMusicService().getPlaylistRevision('playlist-id')).resolves.toEqual(revision)
    expect(get).toHaveBeenCalledWith('/api/playlist/revision', { id: 'playlist-id' })
  })
})

describe('网易云专辑简介', () => {
  afterEach(() => vi.restoreAllMocks())
  it('复用已有专辑接口返回的详情，不从其他专辑拼接', async () => {
    const playlist = { id: 123, source: 'netease', type: 'album', description: '专辑简介' }
    const get = vi.spyOn(api, 'get').mockResolvedValue({ playlist })
    await expect(new NeteaseMusicService().getAlbumDetail(123)).resolves.toEqual(playlist)
    expect(get).toHaveBeenCalledWith('/api/netease/album/songs', { id: '123' })
  })
  it('缺少专辑元信息时返回 null，保留原有页面摘要', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ songs: [] })
    await expect(new NeteaseMusicService().getAlbumDetail(123)).resolves.toBeNull()
  })
})

describe('网易云专辑歌单搜索', () => {
  afterEach(() => vi.restoreAllMocks())
  it('分类使用各自接口', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ albums: [], playlists: [] })
    const service = new NeteaseMusicService()
    await service.searchAlbums('关键词')
    await service.searchPlaylists('关键词')
    expect(get).toHaveBeenCalledWith('/api/netease/search/albums', { keywords: '关键词' })
    expect(get).toHaveBeenCalledWith('/api/netease/search/playlists', { keywords: '关键词' })
  })
})

describe('网易云漫游完整歌单', () => {
  afterEach(() => vi.restoreAllMocks())

  const song = (id: number): Track => ({ provider: 'netease', source: 'netease', type: 'song', id, name: `歌曲${id}`, artist: '歌手', artists: [] })

  it('替换完成后显式按漫游顺序排序，不能依赖添加接口的默认顺序', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ success: true })
    await new NeteaseMusicService().replacePlaylistTracks('roam', [9, 8], [3, 1, 2])
    expect(post.mock.calls).toEqual([
      ['/api/playlist/remove-songs', { pid: 'roam', ids: '9,8' }],
      ['/api/playlist/add-song', { pid: 'roam', ids: '3,1,2' }],
      ['/api/playlist/order/update', { pid: 'roam', ids: ['3', '1', '2'] }],
    ])
  })

  it('排序失败不能报告保存成功，空歌单不调用排序', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async path => {
      if (path === '/api/playlist/order/update') throw new Error('ORDER_FAILED')
      return { success: true } as never
    })
    await expect(new NeteaseMusicService().replacePlaylistTracks('roam', [], [2, 1])).rejects.toThrow('ORDER_FAILED')
    post.mockClear()
    await new NeteaseMusicService().replacePlaylistTracks('roam', [2, 1], [])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('补齐超过 100 首的歌单，按骨架顺序返回全部曲目', async () => {
    const songs = Array.from({ length: 350 }, (_, index) => song(index + 1))
    const get = vi.spyOn(api, 'get').mockImplementation(async (path, params) => {
      if (path === '/api/playlist/tracks') return { playlist: { id: 'roam' }, trackIds: songs.map(track => String(track.id)), tracks: songs.slice(0, 100).reverse() } as never
      const ids = String(params?.ids).split(',')
      return { tracks: songs.filter(track => ids.includes(String(track.id))).reverse() } as never
    })

    const found = await new NeteaseMusicService().getPlaylistWithDescription('roam')
    expect(found?.tracks).toEqual(songs)
    expect(get.mock.calls.filter(([path]) => path === '/api/song/detail').map(([, params]) => String(params?.ids).split(',').length)).toEqual([200, 50])
  })

  it('前缀中缺少的详情也按 ID 补齐，不把下标错位当作完整歌单', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => (path === '/api/playlist/tracks'
      ? { playlist: { id: 'roam' }, trackIds: [1, 2, 3], tracks: [song(3), song(1)] }
      : { tracks: [song(2)] }) as never)
    await expect(new NeteaseMusicService().getPlaylistWithDescription('roam')).resolves.toMatchObject({ tracks: [song(1), song(2), song(3)] })
  })

  it('补齐后仍缺少曲目时抛错，不能用截断歌单覆盖远端', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => (path === '/api/playlist/tracks'
      ? { playlist: { id: 'roam' }, trackIds: [1, 2], tracks: [song(1)] }
      : { tracks: [] }) as never)
    await expect(new NeteaseMusicService().getPlaylistWithDescription('roam')).rejects.toThrow('歌单歌曲详情不完整')
  })

  it.each(['HTTP 404', 'offline'])('补详情失败 %s 不误判为原歌单已删除', async (message) => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/api/playlist/tracks') return { playlist: { id: 'roam' }, trackIds: [1, 2], tracks: [song(1)] } as never
      throw new Error(message)
    })
    await expect(new NeteaseMusicService().getPlaylistWithDescription('roam')).rejects.toThrow(message)
  })

  it('只有原歌单查询 404 才返回 null', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('HTTP 404'))
    await expect(new NeteaseMusicService().getPlaylistWithDescription('deleted')).resolves.toBeNull()
  })

  it('完整小歌单和空歌单不额外请求详情', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ playlist: { id: 'small' }, trackIds: [1], tracks: [song(1)] })
      .mockResolvedValueOnce({ playlist: { id: 'empty' }, trackIds: [], tracks: [] })
    const service = new NeteaseMusicService()
    await expect(service.getPlaylistWithDescription('small')).resolves.toMatchObject({ tracks: [song(1)] })
    await expect(service.getPlaylistWithDescription('empty')).resolves.toMatchObject({ tracks: [] })
    expect(get).toHaveBeenCalledTimes(2)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { NeteaseMusicService } from './netease-music-service'

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

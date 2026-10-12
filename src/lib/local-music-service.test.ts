import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localMusicService } from './local-music-service'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ api: { get: h.get, post: h.post, url: (path: string) => path } }))

describe('本地收藏可用性查询', () => {
  beforeEach(() => vi.clearAllMocks())
  it('分批检查实际存在性，保留元数据但不将缺失文件当成可播放文件', async () => {
    const tracks = Array.from({ length: 102 }, (_, index) => ({ id: String(index), name: `歌曲${index}`, artist: '', hasCover: false }))
    h.get.mockResolvedValue({ tracks })
    h.post.mockImplementation(async (_path, body: { ids: string[] }) => ({ availableIds: body.ids.filter(id => id !== '0') }))
    const result = await localMusicService.getAvailableTracks(tracks.map(track => track.id), new AbortController().signal)
    expect(h.post).toHaveBeenCalledTimes(2)
    expect(h.post.mock.calls[0][1].ids).toHaveLength(100)
    expect(result).toHaveLength(101)
    expect(result[0]).toMatchObject({ id: '1', source: 'local', name: '歌曲1' })
  })
  it('取消后丢弃迟到批次并停止后续请求', async () => {
    const controller = new AbortController()
    h.get.mockResolvedValue({ tracks: [] })
    h.post.mockImplementation(async () => { controller.abort(); return { availableIds: ['1'] } })
    await expect(localMusicService.getAvailableTracks(Array.from({ length: 101 }, (_, index) => String(index)), controller.signal)).rejects.toThrow('Aborted')
    expect(h.post).toHaveBeenCalledOnce()
  })
})

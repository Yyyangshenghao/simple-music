import { afterEach, describe, expect, it, vi } from 'vitest'
import { BilibiliMusicService } from './bilibili-service'
import { api } from './api'

vi.mock('./api', () => ({ api: { get: vi.fn() } }))
afterEach(() => vi.resetAllMocks())

describe('B站直达详情服务', () => {
  it('只提交规范BV身份并带取消信号，保留UP主和分P信息', async () => {
    const controller = new AbortController()
    const track = { id: 'BV1BZbSzZEGT', source: 'bilibili', name: '原视频标题', uploader: '投稿者', videoPartCount: 2, cover: 'https://i0.hdslb.com/a.jpg' }
    vi.mocked(api.get).mockResolvedValue({ track })
    expect(await new BilibiliMusicService().getVideoTrack(track.id, controller.signal)).toEqual(track)
    expect(api.get).toHaveBeenCalledWith('/api/bilibili/song/detail', { bvid: track.id }, { signal: controller.signal })
  })
})

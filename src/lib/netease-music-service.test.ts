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

import { describe, expect, it, vi } from 'vitest'
import { collectNeteaseUserPlaylists } from './netease-user-playlists'

describe('collectNeteaseUserPlaylists', () => {
  it('按 offset 拉完所有分页并去重', async () => {
    const fetchPage = vi.fn(async (offset: number) => offset === 0
      ? { items: [{ id: 1 }, { id: 2 }], more: true }
      : { items: [{ id: 2 }, { id: 3 }], more: false })

    await expect(collectNeteaseUserPlaylists(fetchPage)).resolves.toEqual([
      { id: 1 }, { id: 2 }, { id: 3 },
    ])
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 2])
  })

  it('首屏异常只返回喜欢歌单时从 offset=1 补取其余歌单', async () => {
    const fetchPage = vi.fn(async (offset: number) => offset === 0
      ? { items: [{ id: 'liked' }], more: false }
      : { items: [{ id: 'created' }, { id: 'subscribed' }], more: false })

    await expect(collectNeteaseUserPlaylists(fetchPage)).resolves.toEqual([
      { id: 'liked' }, { id: 'created' }, { id: 'subscribed' },
    ])
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 1])
  })

  it('上游忽略 offset 返回重复页时停止', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [{ id: 1 }], more: true })

    await expect(collectNeteaseUserPlaylists(fetchPage)).resolves.toEqual([{ id: 1 }])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})

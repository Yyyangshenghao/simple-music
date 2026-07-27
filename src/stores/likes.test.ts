import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Track } from '../types/domain'

const likeTrack = vi.fn(async (_t: Track, _l: boolean) => true)
const checkLiked = vi.fn(async (_ids: unknown[]) => ({ '1': true }) as Record<string, boolean>)

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({ likeTrack, checkLiked })
}))

import { useLikesStore, likeKeyOf } from './likes'

function mk(i: number): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id: i, name: `t${i}`, artist: '', artists: [] }
}

describe('likes store', () => {
  beforeEach(() => {
    useLikesStore.setState({ likedByKey: {} })
    likeTrack.mockClear()
    checkLiked.mockClear()
    likeTrack.mockResolvedValue(true)
  })

  it('ensureChecked 查询一次后缓存', async () => {
    const t = mk(1)
    await useLikesStore.getState().ensureChecked(t)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
    await useLikesStore.getState().ensureChecked(t)
    expect(checkLiked).toHaveBeenCalledTimes(1)
  })

  it('批量合并:同窗口多首曲目只发一次 checkLiked(多 ids)', async () => {
    const t1 = mk(1)
    const t2 = mk(2)
    const t3 = mk(3)
    const ps = [t1, t2, t3].map((t) => useLikesStore.getState().ensureChecked(t))
    await Promise.all(ps)
    expect(checkLiked).toHaveBeenCalledTimes(1)
    expect(checkLiked).toHaveBeenCalledWith([1, 2, 3])
    // mock 返回 { '1': true },其余未命中为 false
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t1)]).toBe(true)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t2)]).toBe(false)
  })

  it('toggleLike 乐观更新,服务端失败回滚', async () => {
    const t = mk(2)
    await useLikesStore.getState().toggleLike(t)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
    expect(likeTrack).toHaveBeenCalledWith(t, true)

    likeTrack.mockResolvedValueOnce(false)
    await useLikesStore.getState().toggleLike(t)
    // 取消红心失败:回滚为仍然红心
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
  })
})

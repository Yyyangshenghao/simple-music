import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const harness = vi.hoisted(() => ({
  effect: undefined as undefined | (() => void | (() => void)),
  setters: [] as ReturnType<typeof vi.fn>[],
  page: vi.fn(),
  songs: vi.fn(),
}))
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => { harness.effect = effect },
  useState: (initial: unknown) => {
    const setter = vi.fn()
    harness.setters.push(setter)
    return [initial, setter]
  },
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ getArtistSongsPage: harness.page, getArtistSongs: harness.songs }) }))
import { useArtistSearch } from './useArtistSearch'

const song = (id: number) => ({ id, source: 'netease', name: `歌曲${id}` }) as Track
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('歌手完整曲库搜索', () => {
  beforeEach(() => { harness.setters = []; harness.page.mockReset(); harness.songs.mockReset() })
  it('恢复搜索页时首帧即为加载态，不能在搜索结果到达前恢复滚动', () => {
    expect(useArtistSearch('artist', 'netease', true).loading).toBe(true)
    expect(harness.page).not.toHaveBeenCalled()
  })
  it('只有启用搜索才读取完整曲库', async () => {
    useArtistSearch('artist', 'netease', false)
    harness.effect?.()
    await flush()
    expect(harness.page).not.toHaveBeenCalled()
  })
  it('串行读取下一页并去重，保留首屏以外的歌曲', async () => {
    harness.page.mockResolvedValueOnce({ songs: [song(1)], nextOffset: 50, hasMore: true })
      .mockResolvedValueOnce({ songs: [song(1), song(2)], nextOffset: 100, hasMore: false })
    useArtistSearch('artist', 'netease', true)
    harness.effect?.()
    await flush()
    expect(harness.page.mock.calls).toEqual([['artist', 0, 50], ['artist', 50, 50]])
    expect(harness.setters[0]).toHaveBeenLastCalledWith([song(1), song(2)])
    expect(harness.setters[1]).toHaveBeenLastCalledWith(false)
  })
  it('退出搜索后丢弃迟到响应且不继续分页', async () => {
    let resolve!: (value: unknown) => void
    harness.page.mockImplementation(() => new Promise((done) => { resolve = done }))
    useArtistSearch('artist', 'netease', true)
    const cleanup = harness.effect?.()
    if (cleanup) cleanup()
    harness.setters.forEach((setter) => setter.mockClear())
    resolve({ songs: [song(1)], nextOffset: 50, hasMore: true })
    await flush()
    expect(harness.setters[0]).not.toHaveBeenCalled()
    expect(harness.setters[1]).not.toHaveBeenCalled()
    expect(harness.page).toHaveBeenCalledTimes(1)
  })
  it('分页失败保留已有结果并报告错误', async () => {
    harness.page.mockResolvedValueOnce({ songs: [song(1)], nextOffset: 50, hasMore: true }).mockRejectedValueOnce(new Error('offline'))
    useArtistSearch('artist', 'netease', true)
    harness.effect?.()
    await flush()
    expect(harness.setters[0]).toHaveBeenLastCalledWith([song(1)])
    expect(harness.setters[2]).toHaveBeenLastCalledWith(true)
  })
  it('游标未前进时停止，避免循环请求', async () => {
    harness.page.mockResolvedValue({ songs: [], nextOffset: 0, hasMore: true })
    useArtistSearch('artist', 'netease', true)
    harness.effect?.()
    await flush()
    expect(harness.page).toHaveBeenCalledTimes(1)
  })
})

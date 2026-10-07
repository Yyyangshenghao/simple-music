import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBatchTracks } from './batch-tracks'
import { advanceProviderAccountSession } from './provider-account-session'
import type { Playlist, Track } from '../types/domain'

const h = vi.hoisted(() => ({ album: vi.fn(), skeleton: vi.fn(), participating: vi.fn(() => true) }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ catalog: { getAlbumTracks: h.album, getPlaylistSkeleton: h.skeleton } }) }))
vi.mock('../stores/providers', () => ({ isProviderParticipating: h.participating }))
const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: 'A', artist: '', artists: [] }
const album: Playlist = { provider: 'netease', source: 'netease', type: 'album', id: 2, name: '专辑', cover: '', creator: '', trackCount: 2, playCount: 0 }

describe('批量操作展开曲目', () => {
  beforeEach(() => { vi.clearAllMocks(); h.participating.mockReturnValue(true) })
  it('按结果顺序展开专辑、歌单并以来源和 ID 去重，保留可补详情的占位', async () => {
    h.album.mockResolvedValue([track, { ...track, id: 2 }, { ...track, id: 4, playable: false }])
    h.skeleton.mockResolvedValue({ trackIds: [3, 2], tracks: [{ ...track, id: 2 }] })
    const result = await resolveBatchTracks([track, { ...track, provider: 'qq', source: 'qq' }], [album, { ...album, id: 3, type: 'playlist' }], new AbortController().signal)
    expect(result.map((item) => `${item.source}:${String(item.id)}`)).toEqual(['netease:1', 'qq:1', 'netease:2', 'netease:3'])
    expect(result.at(-1)?.pending).toBe(true)
  })
  it('专辑展开期间账号切换后丢弃旧结果，不展开后续歌单', async () => {
    h.album.mockImplementation(async () => { advanceProviderAccountSession('netease'); return [track] })
    await expect(resolveBatchTracks([], [album, { ...album, id: 3 }], new AbortController().signal)).rejects.toThrow('账号或平台状态已变化')
    expect(h.album).toHaveBeenCalledTimes(1)
  })
  it('取消多选操作后迟到响应不再执行后续请求', async () => {
    const controller = new AbortController()
    h.album.mockImplementation(async () => { controller.abort(); return [track] })
    await expect(resolveBatchTracks([], [album, album], controller.signal)).rejects.toThrow('Aborted')
    expect(h.album).toHaveBeenCalledTimes(1)
  })
  it('来源被禁用时不发请求', async () => {
    h.participating.mockReturnValue(false)
    await expect(resolveBatchTracks([], [album], new AbortController().signal)).rejects.toThrow('账号或平台状态已变化')
    expect(h.album).not.toHaveBeenCalled()
  })
})

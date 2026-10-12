import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAppPlaylistTracks, resolveBatchTracks } from './batch-tracks'
import { advanceProviderAccountSession } from './provider-account-session'
import type { Playlist, Track } from '../types/domain'

const h = vi.hoisted(() => ({ album: vi.fn(), skeleton: vi.fn(), details: vi.fn(), participating: vi.fn((_source: string) => true) }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ catalog: { getAlbumTracks: h.album, getPlaylistSkeleton: h.skeleton, getTracksByIds: h.details } }) }))
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
  it('收藏已有曲目允许停用平台、Apple 和本地曲目，并保留不可播歌曲', async () => {
    h.participating.mockReturnValue(false)
    const result = await resolveAppPlaylistTracks([track, { ...track, playable: false, source: 'apple', provider: 'apple' }, { ...track, source: 'local', provider: 'local' }], [], new AbortController().signal)
    expect(result.map(item => item.source)).toEqual(['netease', 'apple', 'local'])
    expect(result[1].playable).toBe(false)
    expect(h.participating).not.toHaveBeenCalled()
  })
  it('收藏集合仍丢弃账号切换的迟到结果，取消后也不保存', async () => {
    h.album.mockImplementation(async () => { advanceProviderAccountSession('netease'); return [track] })
    await expect(resolveAppPlaylistTracks([], [album], new AbortController().signal)).rejects.toThrow('账号或平台状态已变化')
    const controller = new AbortController()
    controller.abort()
    await expect(resolveAppPlaylistTracks([track], [], controller.signal)).rejects.toThrow('Aborted')
  })
  it('收藏展开保留不可播和待补全曲目，不要求直接选中歌曲的平台参与', async () => {
    h.participating.mockImplementation(source => source === 'netease')
    h.album.mockResolvedValue([{ ...track, playable: false }])
    const result = await resolveAppPlaylistTracks([{ ...track, source: 'qq', provider: 'qq' }], [album], new AbortController().signal)
    expect(result.map(item => item.source)).toEqual(['qq', 'netease'])
    expect(result[1].playable).toBe(false)
  })
  it('收藏整单或占位选区时补全已有平台的元数据，仍保留查不到的原始身份', async () => {
    h.skeleton.mockResolvedValue({ trackIds: [1, 2, 3], tracks: [track] })
    h.details.mockResolvedValue([{ ...track, id: 2, name: 'B' }])
    const result = await resolveAppPlaylistTracks([], [{ ...album, type: 'playlist' }], new AbortController().signal)
    expect(h.details).toHaveBeenCalledWith([2, 3])
    expect(result.map(item => item.name)).toEqual(['A', 'B', ''])
    expect(result.at(-1)).toMatchObject({ id: 3, source: 'netease', pending: true })
  })
  it('补全收藏期间账号变化不能保存旧账号结果；停用平台的占位收藏不发请求', async () => {
    h.details.mockImplementation(async () => { advanceProviderAccountSession('netease'); return [track] })
    await expect(resolveAppPlaylistTracks([{ ...track, pending: true }], [], new AbortController().signal)).rejects.toThrow('账号或平台状态已变化')
    h.details.mockClear()
    h.participating.mockReturnValue(false)
    expect(await resolveAppPlaylistTracks([{ ...track, pending: true }], [], new AbortController().signal)).toHaveLength(1)
    expect(h.details).not.toHaveBeenCalled()
  })
})

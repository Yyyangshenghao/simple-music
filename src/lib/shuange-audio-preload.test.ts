import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { PlaybackEngine } from './playback-core'
import { prepareShuangeAudio, releaseShuangeAudio, waitForShuangeAudio } from './shuange-audio-preload'
import { fetchOfflineStatuses } from './offline-cache'

const mock = vi.hoisted(() => ({
  account: 1,
  preferences: { playbackOrder: ['netease', 'qq'], preferOriginSource: true, multiSourceFallback: true },
  enabled: true,
  urlSuffix: '',
}))
vi.mock('../stores/providers', () => ({
  useProviderStore: { getState: () => mock.preferences },
  isProviderParticipating: () => mock.enabled,
}))
vi.mock('./provider-account-session', () => ({ providerAccountSession: () => mock.account }))
vi.mock('./offline-cache', () => ({
  fetchOfflineStatuses: vi.fn(),
  offlineTrackKey: (track: Track) => `${track.source}:${track.id}`,
  offlineFileUrl: (status: { entryId?: string }) => status.entryId ? `/api/audio-cache/file?entryId=${status.entryId}` : null,
}))
vi.mock('./track-preload', () => ({
  getPreloadedResolution: (track: Track, quality: string) => ({ url: `https://cdn.example.com/${track.id}-${quality}.mp3${mock.urlSuffix}`, level: quality }),
  audioDiskCacheKey: (track: Track, level: string) => `${track.source}:${track.id}:${level}`,
}))

const tracks = [1, 2, 3, 4, 5].map(id => ({ source: 'netease', id } as Track))
const targets = tracks.map(track => ({ track, startAt: 60 }))
const preloadAudio = vi.fn(), releasePreloads = vi.fn(), waitForPreload = vi.fn()
const engine = { preloadAudio, releasePreloads, waitForPreload } as unknown as PlaybackEngine
/** 让批量离线检查的回调完成 */
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }

beforeEach(() => {
  vi.clearAllMocks()
  mock.account = 1
  mock.enabled = true
  mock.urlSuffix = ''
  mock.preferences = { playbackOrder: ['netease', 'qq'], preferOriginSource: true, multiSourceFallback: true }
  vi.mocked(fetchOfflineStatuses).mockImplementation(async items => items.map(track => ({ source: 'netease', id: String(track.id), state: 'missing' })))
  waitForPreload.mockResolvedValue(true)
})
afterEach(() => { releaseShuangeAudio(); vi.useRealTimers() })

describe('刷歌音频窗口', () => {
  it('四个相邻目标去重后共用批量检查 数据补齐通知不重复查相同窗口', async () => {
    prepareShuangeAudio(engine, [targets[0], ...targets], 'standard')
    prepareShuangeAudio(engine, targets, 'standard')
    await flush()
    expect(fetchOfflineStatuses).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchOfflineStatuses).mock.calls[0][0]).toEqual(tracks.slice(0, 4))
    expect(preloadAudio).toHaveBeenLastCalledWith(targets.slice(0, 4).map(({ track, startAt }) => ({
      url: `https://cdn.example.com/${track.id}-standard.mp3`, startAt, cacheKey: `netease:${track.id}:standard`,
      cacheContext: { originSource: 'netease', originId: String(track.id), resolvedSource: 'netease', resolvedId: String(track.id), quality: 'standard' },
    })))
    prepareShuangeAudio(engine, targets.slice(1), 'standard')
    await flush()
    expect(fetchOfflineStatuses).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchOfflineStatuses).mock.lastCall?.[0]).toEqual([tracks[4]])
    expect(preloadAudio.mock.lastCall?.[0]).toHaveLength(4)
  })

  it('移动窗口只查询新邻居 并取消已全部离开窗口的检查', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchOfflineStatuses>>) => void
    vi.mocked(fetchOfflineStatuses).mockImplementationOnce(() => new Promise(finish => { resolve = finish }))
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    const signal = vi.mocked(fetchOfflineStatuses).mock.calls[0][1]!
    prepareShuangeAudio(engine, [targets[1]], 'standard')
    expect(signal.aborted).toBe(true)
    resolve([{ source: 'netease', id: '1', state: 'missing' }])
    await flush()
    expect(preloadAudio.mock.lastCall?.[0].map((item: { url: string }) => item.url)).toEqual(['https://cdn.example.com/2-standard.mp3'])
    prepareShuangeAudio(engine, [targets[1], targets[2]], 'standard')
    await flush()
    expect(vi.mocked(fetchOfflineStatuses).mock.lastCall?.[0]).toEqual([tracks[2]])
  })

  it('新邻居检查完成之前不清空媒体窗口 保留刚切走的当前曲', async () => {
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    await flush()
    preloadAudio.mockClear()
    let finish!: (value: Awaited<ReturnType<typeof fetchOfflineStatuses>>) => void
    vi.mocked(fetchOfflineStatuses).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    prepareShuangeAudio(engine, [targets[1]], 'standard')
    prepareShuangeAudio(engine, [targets[1]], 'standard')
    expect(preloadAudio).not.toHaveBeenCalled()
    finish([{ source: 'netease', id: '2', state: 'missing' }])
    await flush()
    expect(preloadAudio).toHaveBeenCalledOnce()
    expect(preloadAudio.mock.lastCall?.[0]).toHaveLength(1)
  })

  it('相同歌曲的过期地址刷新后重新准备 不沿用旧媒体地址', async () => {
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    await flush()
    mock.urlSuffix = '?renewed=1'
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    await flush()
    expect(preloadAudio.mock.lastCall?.[0][0].url).toContain('?renewed=1')
    expect(fetchOfflineStatuses).toHaveBeenCalledTimes(2)
  })

  it('离线文件优先 未命中时尊重其他平台优先且不投机跨源查询', async () => {
    mock.preferences = { playbackOrder: ['qq', 'netease'], preferOriginSource: false, multiSourceFallback: true }
    vi.mocked(fetchOfflineStatuses).mockResolvedValueOnce([
      { source: 'netease', id: '1', state: 'cached', entryId: 'local' },
      { source: 'netease', id: '2', state: 'missing' },
    ])
    prepareShuangeAudio(engine, targets, 'standard')
    await flush()
    expect(preloadAudio).toHaveBeenLastCalledWith([{ url: '/api/audio-cache/file?entryId=local', startAt: 60 }])
  })

  it.each(['quality', 'account', 'participation'] as const)('%s 变化清理旧缓冲并拒绝旧检查写回', async change => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchOfflineStatuses>>) => void
    vi.mocked(fetchOfflineStatuses).mockImplementationOnce(() => new Promise(finish => { resolve = finish }))
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    const signal = vi.mocked(fetchOfflineStatuses).mock.calls[0][1]!
    if (change === 'account') mock.account++
    if (change === 'participation') mock.enabled = false
    prepareShuangeAudio(engine, [targets[0]], change === 'quality' ? 'lossless' : 'standard')
    expect(signal.aborted).toBe(true)
    expect(releasePreloads).toHaveBeenCalledOnce()
    resolve([{ source: 'netease', id: '1', state: 'cached', entryId: 'old' }])
    await flush()
    expect(JSON.stringify(preloadAudio.mock.lastCall)).not.toContain('entryId=old')
  })

  it('已有准备提前完成即返回 卡住时只等给定预算且退出取消等待', async () => {
    vi.useFakeTimers()
    prepareShuangeAudio(engine, [targets[0]], 'standard')
    await flush()
    let settle!: (value: boolean) => void
    waitForPreload.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    let done = false
    const pending = waitForShuangeAudio(targets[0], 'standard', 800)!.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toBe(false)
    settle(true)
    await pending
    expect(vi.getTimerCount()).toBe(0)
    waitForPreload.mockReturnValue(new Promise(() => {}))
    done = false
    const timeout = waitForShuangeAudio(targets[0], 'standard', 300)!.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await timeout
    expect(done).toBe(true)
    expect(waitForShuangeAudio(targets[1], 'standard', 800)).toBeUndefined()
    expect(waitForShuangeAudio(targets[0], 'standard', 0)).toBeUndefined()
  })

  it('Apple 和本地曲目不进入刷歌直链准备', async () => {
    prepareShuangeAudio(engine, ['apple', 'local'].map(source => ({ track: { ...tracks[0], source } as Track, startAt: 60 })), 'standard')
    await flush()
    expect(fetchOfflineStatuses).not.toHaveBeenCalled()
    expect(preloadAudio).toHaveBeenLastCalledWith([])
  })
})

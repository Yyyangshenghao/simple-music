import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceProviderAccountSession } from '../lib/provider-account-session'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  skeleton: vi.fn(),
  album: vi.fn(),
  details: vi.fn(),
  bumps: vi.fn(),
  playbackAvailable: true,
}))

// 保留同一次挂载的 hook 状态与依赖；普通 rerender 不会重新执行未变的 effect。
vi.mock('react', () => {
  const sameDeps = (left: unknown[], right: unknown[]) => left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
  return {
    useRef: (value: unknown) => harness.slots[harness.cursor++] ??= { current: value },
    useState: (value: unknown) => {
      const index = harness.cursor++
      harness.slots[index] ??= value
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = next }]
    },
    useReducer: () => { harness.cursor++; return [0, harness.bumps] },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const index = harness.cursor++
      const previous = harness.slots[index] as { callback: unknown; deps: unknown[] } | undefined
      if (!previous || !sameDeps(previous.deps, deps)) harness.slots[index] = { callback, deps }
      return (harness.slots[index] as { callback: unknown }).callback
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = harness.cursor++
      const previous = harness.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
      if (!previous || !sameDeps(previous.deps, deps)) {
        harness.effects.push(() => {
          previous?.cleanup?.()
          harness.slots[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
})
vi.mock('../lib/service-registry', () => {
  const service = { getPlaylistSkeleton: harness.skeleton, getAlbumTracks: harness.album, getTracksByIds: harness.details }
  return { serviceFor: () => service }
})
vi.mock('../stores/providers', () => ({ useProviderStore: (select: (state: unknown) => unknown) => select({ byId: {
    netease: { enabled: true, auth: 'authenticated', playbackAvailable: harness.playbackAvailable }, qq: { enabled: true, auth: 'authenticated', playbackAvailable: harness.playbackAvailable }, apple: { enabled: true, auth: 'authenticated', playbackAvailable: harness.playbackAvailable },
  } }), isProviderParticipating: () => harness.playbackAvailable }))

import { loadPlaylistQueue, useLazyPlaylist } from './useLazyPlaylist'

let nextId = 0
const song = (id: number): Track => ({ id, source: 'netease', provider: 'netease', type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
const collection = (type: Playlist['type']): Playlist => ({ id: ++nextId, source: 'netease', provider: 'netease', type, name: '测试', cover: '', trackCount: 1, playCount: 0, creator: '' })

function render(playlist: Playlist) {
  harness.cursor = 0
  const result = useLazyPlaylist(playlist)
  for (const effect of harness.effects.splice(0)) effect()
  return result
}

function unmount() {
  for (const slot of harness.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.()
  harness.slots = []
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('歌单缓存的挂载生命周期', () => {
  let now = 1_000
  beforeEach(() => {
    now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    harness.skeleton.mockReset().mockResolvedValue({ trackIds: [1], tracks: [song(1)] })
    harness.album.mockReset().mockResolvedValue([song(1)])
    harness.details.mockReset()
  })
  afterEach(() => {
    unmount()
    vi.restoreAllMocks()
  })

  it.each(['album', 'playlist'] as const)('%s 停留超过 TTL 后原地交互保留曲目，重新进入时刷新', async (type) => {
    const playlist = collection(type)
    const request = type === 'album' ? harness.album : harness.skeleton
    render(playlist)
    await settle()
    expect(render(playlist).loading).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)

    now += 10 * 60 * 1_000 + 1
    const current = render(playlist)
    expect(current.tracks).toEqual([song(1)])
    expect(current.loading).toBe(false)
    await settle()
    expect(request).toHaveBeenCalledTimes(1)

    unmount()
    harness.album.mockResolvedValue([song(2)])
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    expect(render(playlist).loading).toBe(true)
    await settle()
    expect(render(playlist).tracks).toEqual([song(2)])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('已离开集合仍按四份 LRU 上限淘汰，重新进入会重新拉取', async () => {
    const playlist = collection('album')
    render(playlist)
    await settle()
    unmount()
    for (let index = 0; index < 4; index++) await loadPlaylistQueue(collection('album'))
    expect(harness.album).toHaveBeenCalledTimes(5)
    render(playlist)
    await settle()
    expect(render(playlist).loading).toBe(false)
    expect(harness.album).toHaveBeenCalledTimes(6)
  })
})

describe('歌单内容的账号会话边界', () => {
  beforeEach(() => {
    harness.playbackAvailable = true
    harness.bumps.mockClear()
    harness.skeleton.mockReset().mockResolvedValue({ trackIds: [1], tracks: [song(1)] })
    harness.album.mockReset().mockResolvedValue([song(1)])
    harness.details.mockReset()
  })
  afterEach(unmount)

  it.each(['album', 'playlist'] as const)('命令式 %s 换号后重新读取，不能复用旧账号缓存', async type => {
    const playlist = collection(type)
    expect((await loadPlaylistQueue(playlist)).map(track => track.id)).toEqual([1])
    advanceProviderAccountSession('netease')
    harness.album.mockResolvedValue([song(2)])
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    expect((await loadPlaylistQueue(playlist)).map(track => track.id)).toEqual([2])
  })

  it.each(['album', 'playlist'] as const)('命令式 %s 的旧账号回复不可返回或覆盖当前缓存', async type => {
    const playlist = collection(type)
    let resolve!: (value: unknown) => void
    const request = type === 'album' ? harness.album : harness.skeleton
    request.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const old = loadPlaylistQueue(playlist)
    const rejected = expect(old).rejects.toThrow('会话')
    advanceProviderAccountSession('netease')
    harness.album.mockResolvedValue([song(2)])
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    expect((await loadPlaylistQueue(playlist)).map(track => track.id)).toEqual([2])
    resolve(type === 'album' ? [song(3)] : { trackIds: [3], tracks: [song(3)] })
    await rejected
    expect((await loadPlaylistQueue(playlist)).map(track => track.id)).toEqual([2])
  })

  it.each(['album', 'playlist'] as const)('同一挂载的 %s 换号时立即隔离旧列表，新账号独立加载', async type => {
    const playlist = collection(type)
    render(playlist)
    await settle()
    const old = render(playlist)
    expect(old.tracks).toEqual([song(1)])
    advanceProviderAccountSession('netease')
    harness.album.mockResolvedValue([song(2)])
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    const loading = render(playlist)
    expect(loading.tracks).toEqual([])
    expect(loading.loading).toBe(true)
    expect(old.makeQueue()).toEqual([])
    await settle()
    expect(render(playlist).tracks).toEqual([song(2)])
  })

  it('旧账号补详情回复不修改缓存，旧回调不提交队列，新账号仍显示自己的歌曲', async () => {
    const playlist = collection('playlist')
    harness.skeleton.mockResolvedValueOnce({ trackIds: [1], tracks: [] })
    render(playlist)
    await settle()
    const old = render(playlist)
    let resolve!: (tracks: Track[]) => void
    harness.details.mockReturnValueOnce(new Promise(done => { resolve = done }))
    old.ensureRange(0, 1)
    advanceProviderAccountSession('netease')
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    render(playlist)
    await settle()
    resolve([song(3)])
    await settle()
    expect(old.makeQueue()).toEqual([])
    expect(render(playlist).tracks).toEqual([song(2)])
  })

  it('旧账号主动刷新晚到时不覆盖新账号同一歌单', async () => {
    const playlist = collection('playlist')
    render(playlist)
    await settle()
    const old = render(playlist)
    let resolve!: (value: unknown) => void
    harness.skeleton.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const refreshing = old.refresh()
    advanceProviderAccountSession('netease')
    harness.skeleton.mockResolvedValue({ trackIds: [2], tracks: [song(2)] })
    render(playlist)
    await settle()
    resolve({ trackIds: [3], tracks: [song(3)] })
    await refreshing
    expect(render(playlist).tracks).toEqual([song(2)])
    expect(old.makeQueue()).toEqual([])
  })
})

describe('专辑共享缓存及连接变化', () => {
  beforeEach(() => {
    harness.playbackAvailable = true
    harness.bumps.mockClear()
    harness.album.mockReset()
    harness.skeleton.mockReset()
    harness.details.mockReset()
  })
  afterEach(() => { harness.playbackAvailable = true; unmount() })
  it('同账号命令式专辑与当前挂载并发完成后仍通知界面，不停在加载中', async () => {
    const playlist = collection('album')
    let resolve!: (tracks: Track[]) => void
    harness.album.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce([song(2)])
    render(playlist)
    await loadPlaylistQueue(playlist)
    harness.bumps.mockClear()
    resolve([song(1)])
    await settle()
    expect(harness.bumps).toHaveBeenCalled()
    expect(render(playlist).loading).toBe(false)
    unmount()
  })

  it('在途专辑被四份LRU淘汰后，当前挂载可完成且缓存仍有上限', async () => {
    const playlist = collection('album')
    let resolve!: (tracks: Track[]) => void
    harness.album.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValue([song(2)])
    render(playlist)
    const others = Array.from({ length: 4 }, () => collection('album'))
    for (const item of others) await loadPlaylistQueue(item)
    resolve([song(1)])
    await settle()
    expect(render(playlist).loading).toBe(false)
    const before = harness.album.mock.calls.length
    await loadPlaylistQueue(others[0])
    expect(harness.album).toHaveBeenCalledTimes(before + 1)
    unmount()
  })

  it('Apple播放连接断开时可用态与回复守卫一致，旧请求不使页面停在可用加载态', async () => {
    const playlist = { ...collection('album'), source: 'apple' as const, provider: 'apple' as const }
    let resolve!: (tracks: Track[]) => void
    harness.album.mockReturnValueOnce(new Promise(done => { resolve = done }))
    render(playlist)
    harness.playbackAvailable = false
    expect(render(playlist)).toMatchObject({ available: false, error: true })
    resolve([song(1)])
    await settle()
    expect(render(playlist).available).toBe(false)
    harness.playbackAvailable = true
    unmount()
  })

})

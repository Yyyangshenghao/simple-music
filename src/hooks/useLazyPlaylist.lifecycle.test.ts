import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  skeleton: vi.fn(),
  album: vi.fn(),
  details: vi.fn(),
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
    useReducer: () => { harness.cursor++; return [0, vi.fn()] },
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
vi.mock('../stores/providers', () => ({ useProviderStore: () => true, isProviderParticipating: () => true }))

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

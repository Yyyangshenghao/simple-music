import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArtistInfo, Track } from '../types/domain'

function mkTrack(artistId: number, i: number): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: `${artistId}-${i}`,
    name: `t${artistId}-${i}`,
    artist: '',
    artists: [],
  }
}

function mkArtist(id: number): ArtistInfo {
  return { id, name: `artist${id}`, avatar: '', source: 'netease' }
}

const POOLS: Record<string, Track[]> = {
  '1': Array.from({ length: 15 }, (_, i) => mkTrack(1, i)),
  '2': Array.from({ length: 3 }, (_, i) => mkTrack(2, i)),
}

const getArtistSongs = vi.fn(async (id: unknown) => POOLS[String(id)] ?? [])

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({ getArtistSongs })
}))

vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }) }
}))

import { useRoamStore, MAX_ARTISTS } from './roam'

describe('roam store', () => {
  beforeEach(() => {
    useRoamStore.setState({ playlist: null, selectedArtists: [], mode: 'hot', generating: false })
    getArtistSongs.mockClear()
    getArtistSongs.mockImplementation(async (id: unknown) => POOLS[String(id)] ?? [])
  })

  it('addArtist 去重且上限 MAX_ARTISTS 位', () => {
    const { addArtist } = useRoamStore.getState()
    for (let i = 0; i < MAX_ARTISTS + 1; i++) addArtist(mkArtist(i))
    addArtist(mkArtist(0)) // 重复,不应再次加入
    expect(useRoamStore.getState().selectedArtists).toHaveLength(MAX_ARTISTS)
  })

  it('removeArtist 按 id 移除', () => {
    const { addArtist, removeArtist } = useRoamStore.getState()
    addArtist(mkArtist(1))
    addArtist(mkArtist(2))
    removeArtist(1)
    expect(useRoamStore.getState().selectedArtists.map((a) => a.id)).toEqual([2])
  })

  it('generate 按 hot 模式取每人前 10 首并汇总,曲库不足按实际数量', async () => {
    useRoamStore.setState({ selectedArtists: [mkArtist(1), mkArtist(2)], mode: 'hot' })
    await useRoamStore.getState().generate()
    const { playlist } = useRoamStore.getState()
    expect(playlist).not.toBeNull()
    expect(playlist!.tracks).toHaveLength(13) // 10 + 3
    expect(getArtistSongs).toHaveBeenCalledTimes(2)
  })

  it('generate 后清空 selectedArtists,可重新选歌手', async () => {
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot' })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().selectedArtists).toEqual([])
  })

  it('单个歌手请求失败不阻断其余歌手', async () => {
    getArtistSongs.mockImplementationOnce(async () => { throw new Error('boom') })
    useRoamStore.setState({ selectedArtists: [mkArtist(1), mkArtist(2)], mode: 'hot' })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().playlist!.tracks).toHaveLength(3)
  })

  it('未选歌手时 generate 是 no-op', async () => {
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(getArtistSongs).not.toHaveBeenCalled()
  })

  it('reset 清空 playlist,回到选歌手态', async () => {
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot' })
    await useRoamStore.getState().generate()
    useRoamStore.getState().reset()
    expect(useRoamStore.getState().playlist).toBeNull()
  })
})

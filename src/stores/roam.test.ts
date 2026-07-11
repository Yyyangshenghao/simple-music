import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ArtistInfo, Track } from '../types/domain'
import type { MusicService } from '../lib/music-service'

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

const findUserPlaylistsByName = vi.fn(async (_name: string) => [] as MockNeteasePlaylist[])
const getPlaylistWithDescription = vi.fn(async (_id: unknown) => null as { playlist: MockNeteasePlaylist; tracks: Track[] } | null)
const createPlaylist = vi.fn(async (_name: string, _opts: { private: boolean }) => ({ id: 'new-pid' }))
const replacePlaylistTracks = vi.fn(async (_id: unknown, _cur: unknown[], _next: unknown[]) => true)
const updatePlaylistDescription = vi.fn(async (_id: unknown, _desc: string) => true)

interface MockNeteasePlaylist {
  id: unknown
  name: string
  description: string
}

function mkNeteasePlaylist(overrides: Partial<Pick<MockNeteasePlaylist, 'id' | 'description'>> = {}): MockNeteasePlaylist {
  return {
    id: overrides.id ?? 'pid-1',
    name: '每日漫游',
    description: overrides.description ?? '',
  }
}

const localOnlyService = { getArtistSongs }
const neteaseRealService = {
  getArtistSongs,
  findUserPlaylistsByName,
  getPlaylistWithDescription,
  createPlaylist,
  replacePlaylistTracks,
  updatePlaylistDescription,
}

let currentService: typeof localOnlyService | typeof neteaseRealService = localOnlyService

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => currentService
}))

vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }) }
}))

import { useRoamStore, MAX_ARTISTS } from './roam'

describe('roam store', () => {
  beforeEach(() => {
    currentService = localOnlyService
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

describe('roam store — 网易云真实歌单分支', () => {
  beforeEach(() => {
    currentService = neteaseRealService
    useRoamStore.setState({
      playlist: null,
      selectedArtists: [],
      mode: 'hot',
      generating: false,
      loading: false,
      neteasePlaylistId: null,
      neteaseHydrated: false,
    })
    findUserPlaylistsByName.mockClear()
    getPlaylistWithDescription.mockClear()
    createPlaylist.mockClear()
    replacePlaylistTracks.mockClear()
    updatePlaylistDescription.mockClear()
    findUserPlaylistsByName.mockResolvedValue([])
    getPlaylistWithDescription.mockResolvedValue(null)
    createPlaylist.mockResolvedValue({ id: 'new-pid' })
    replacePlaylistTracks.mockResolvedValue(true)
    updatePlaylistDescription.mockResolvedValue(true)
  })

  afterEach(() => {
    currentService = localOnlyService
  })

  it('ensureNeteaseHydrated:无缓存 id、账号里也没有匹配歌单 → 留在选歌手态', async () => {
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBeNull()
    expect(useRoamStore.getState().loading).toBe(false)
  })

  it('ensureNeteaseHydrated:账号里有同名但无水印的歌单 → 不采用,留在选歌手态', async () => {
    findUserPlaylistsByName.mockResolvedValue([mkNeteasePlaylist({ description: '我自己写的简介' })])
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBeNull()
  })

  it('ensureNeteaseHydrated:命中带水印且日期为今天的歌单 → 直接进入结果态', async () => {
    // 按本地时区取日期(与 roam.ts 内 todayKey() 的算法一致),不用 toISOString()(那是 UTC,
    // 在 UTC- 时区的深夜/UTC+ 时区的凌晨跑测试会跟本地日期差一天,导致这个用例偶发失败)。
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const pl = mkNeteasePlaylist({ id: 'pid-9', description: `Simple Music · ${todayStr} · 周杰伦/邓紫棋` })
    findUserPlaylistsByName.mockResolvedValue([pl])
    getPlaylistWithDescription.mockResolvedValue({ playlist: pl, tracks: [mkTrack(1, 0)] })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    const { playlist, neteasePlaylistId } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('pid-9')
    expect(playlist).not.toBeNull()
    expect(playlist!.artists).toEqual([{ name: '周杰伦' }, { name: '邓紫棋' }])
    expect(playlist!.tracks).toHaveLength(1)
  })

  it('ensureNeteaseHydrated:命中歌单但简介日期不是今天 → 留在选歌手态,但缓存 id 供生成时复用', async () => {
    const pl = mkNeteasePlaylist({ id: 'pid-9', description: 'Simple Music · 2000-01-01 · 周杰伦' })
    findUserPlaylistsByName.mockResolvedValue([pl])
    getPlaylistWithDescription.mockResolvedValue({ playlist: pl, tracks: [] })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBe('pid-9')
  })

  it('ensureNeteaseHydrated:重复调用只请求一次(neteaseHydrated 守卫)', async () => {
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(findUserPlaylistsByName).toHaveBeenCalledTimes(1)
  })

  it('generate:无可复用歌单 → 新建 + 加曲目 + 写简介', async () => {
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalledWith('每日漫游', { private: true })
    expect(replacePlaylistTracks).toHaveBeenCalledWith('new-pid', [], expect.any(Array))
    expect(updatePlaylistDescription).toHaveBeenCalledWith('new-pid', expect.stringContaining('Simple Music'))
    const { playlist, neteasePlaylistId, selectedArtists } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('new-pid')
    expect(playlist!.tracks).toHaveLength(10)
    expect(selectedArtists).toEqual([])
  })

  it('generate:已有可复用歌单(neteasePlaylistId 命中)→ 不新建,清空旧曲目再加新的', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce({
      playlist: mkNeteasePlaylist({ id: 'pid-1' }),
      tracks: [mkTrack(9, 0), mkTrack(9, 1)],
    })
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: 'pid-1' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).not.toHaveBeenCalled()
    expect(replacePlaylistTracks).toHaveBeenCalledWith('pid-1', ['9-0', '9-1'], expect.any(Array))
  })

  it('generate:缓存的 neteasePlaylistId 已失效(查无歌单)→ 走新建', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce(null)
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: 'stale-pid' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalled()
  })

  it('generate:任一步抛错 → generating 回 false,selectedArtists 不清空', async () => {
    replacePlaylistTracks.mockRejectedValueOnce(new Error('boom'))
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().generating).toBe(false)
    expect(useRoamStore.getState().selectedArtists).toHaveLength(1)
    expect(useRoamStore.getState().playlist).toBeNull()
  })
})

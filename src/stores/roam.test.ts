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

import { useRoamStore, MAX_ARTISTS, MAX_SONGS_PER_ARTIST, type RoamArtistEntry } from './roam'

/** confirmArtists 内部异步拉取曲库池,flush 两轮微任务让 getArtistSongs.then(...) 的 set 落地。 */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

function mkEntry(artistId: number, overrides: Partial<RoamArtistEntry> = {}): RoamArtistEntry {
  const pool = POOLS[String(artistId)] ?? []
  return {
    artist: mkArtist(artistId),
    pool,
    tracks: pool.slice(0, 10),
    count: 10,
    loading: false,
    ...overrides,
  }
}

describe('roam store', () => {
  beforeEach(() => {
    currentService = localOnlyService
    useRoamStore.setState({ playlist: null, entries: [], mode: 'hot', generating: false })
    getArtistSongs.mockClear()
    getArtistSongs.mockImplementation(async (id: unknown) => POOLS[String(id)] ?? [])
  })

  it('confirmArtists 整体设定已选歌手,超过 MAX_ARTISTS 的丢弃', () => {
    const many = Array.from({ length: MAX_ARTISTS + 3 }, (_, i) => mkArtist(i))
    useRoamStore.getState().confirmArtists(many)
    expect(useRoamStore.getState().entries).toHaveLength(MAX_ARTISTS)
  })

  it('confirmArtists 拉取新歌手曲库,首数按人数摊算(2 位→15 首上限,曲库不足则全量)', async () => {
    useRoamStore.getState().confirmArtists([mkArtist(1), mkArtist(2)])
    expect(useRoamStore.getState().entries.every((e) => e.loading)).toBe(true)
    await flush()
    const entries = useRoamStore.getState().entries
    expect(entries[0].tracks).toHaveLength(15)
    expect(entries[1].tracks).toHaveLength(3)
    expect(entries.every((e) => !e.loading)).toBe(true)
  })

  it('confirmArtists 曲库拉取失败:该歌手曲目为空,不影响其他歌手', async () => {
    getArtistSongs.mockImplementationOnce(async () => { throw new Error('boom') })
    useRoamStore.getState().confirmArtists([mkArtist(1), mkArtist(2)])
    await flush()
    const entries = useRoamStore.getState().entries
    expect(entries[0].tracks).toEqual([])
    expect(entries[0].loading).toBe(false)
    expect(entries[1].tracks).toHaveLength(3)
  })

  it('confirmArtists 重新确认时保留已有歌手的曲库池与手动编辑结果,不重新拉取', async () => {
    useRoamStore.setState({ entries: [mkEntry(1, { tracks: [POOLS['1'][0]], count: 1 })] })
    useRoamStore.getState().confirmArtists([mkArtist(1), mkArtist(2)])
    await flush()
    const entries = useRoamStore.getState().entries
    expect(entries[0].tracks).toEqual([POOLS['1'][0]]) // 未被 15 首默认值冲掉
    const fetchedIds = getArtistSongs.mock.calls.map((c) => c[0])
    expect(fetchedIds).not.toContain(1) // 已有的没有重新拉取
    expect(fetchedIds).toContain(2)
  })

  it('removeArtist 按 id 移除', () => {
    useRoamStore.getState().confirmArtists([mkArtist(1), mkArtist(2)])
    useRoamStore.getState().removeArtist(1)
    expect(useRoamStore.getState().entries.map((e) => e.artist.id)).toEqual([2])
  })

  it('setArtistCount 调大:从曲库池补齐,跳过已选的,不超过 MAX_SONGS_PER_ARTIST', () => {
    useRoamStore.setState({ entries: [mkEntry(1, { tracks: POOLS['1'].slice(0, 4), count: 4 })] })
    useRoamStore.getState().setArtistCount(1, 8)
    const entry = useRoamStore.getState().entries[0]
    expect(entry.tracks).toHaveLength(8)
    expect(entry.tracks.slice(0, 4)).toEqual(POOLS['1'].slice(0, 4))
    expect(new Set(entry.tracks.map((t) => t.id)).size).toBe(8)

    useRoamStore.getState().setArtistCount(1, 999)
    expect(useRoamStore.getState().entries[0].count).toBe(MAX_SONGS_PER_ARTIST)
  })

  it('setArtistCount 调小:从尾部裁剪', () => {
    useRoamStore.setState({ entries: [mkEntry(1, { tracks: POOLS['1'].slice(0, 10), count: 10 })] })
    useRoamStore.getState().setArtistCount(1, 3)
    const entry = useRoamStore.getState().entries[0]
    expect(entry.tracks).toEqual(POOLS['1'].slice(0, 3))
  })

  it('addTrack/removeTrack 手动编辑已选曲目,与 count 解耦', () => {
    useRoamStore.setState({ entries: [mkEntry(1, { tracks: POOLS['1'].slice(0, 2), count: 2 })] })
    const extra = POOLS['1'][5]
    useRoamStore.getState().addTrack(1, extra)
    let entry = useRoamStore.getState().entries[0]
    expect(entry.tracks).toHaveLength(3)
    expect(entry.count).toBe(2) // count 不受手动新增影响

    useRoamStore.getState().addTrack(1, extra) // 重复加入应忽略
    expect(useRoamStore.getState().entries[0].tracks).toHaveLength(3)

    useRoamStore.getState().removeTrack(1, POOLS['1'][0].id)
    entry = useRoamStore.getState().entries[0]
    expect(entry.tracks.map((t) => t.id)).toEqual([POOLS['1'][1].id, extra.id])
  })

  it('generate 汇总所有 entries 已选曲目并清空 entries', async () => {
    useRoamStore.setState({
      entries: [mkEntry(1, { tracks: POOLS['1'].slice(0, 10) }), mkEntry(2, { tracks: POOLS['2'] })],
      mode: 'hot',
    })
    await useRoamStore.getState().generate()
    const { playlist, entries } = useRoamStore.getState()
    expect(playlist).not.toBeNull()
    expect(playlist!.tracks).toHaveLength(13)
    expect(entries).toEqual([])
  })

  it('未选歌手时 generate 是 no-op', async () => {
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().playlist).toBeNull()
  })

  it('reset 清空 playlist 与 entries,回到选歌手态', async () => {
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot' })
    await useRoamStore.getState().generate()
    useRoamStore.getState().reset()
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().entries).toEqual([])
  })
})

describe('roam store — 网易云真实歌单分支', () => {
  beforeEach(() => {
    currentService = neteaseRealService
    useRoamStore.setState({
      playlist: null,
      entries: [],
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
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalledWith('每日漫游', { private: true })
    expect(replacePlaylistTracks).toHaveBeenCalledWith('new-pid', [], expect.any(Array))
    expect(updatePlaylistDescription).toHaveBeenCalledWith('new-pid', expect.stringContaining('Simple Music'))
    const { playlist, neteasePlaylistId, entries } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('new-pid')
    expect(playlist!.tracks).toHaveLength(10)
    expect(entries).toEqual([])
  })

  it('generate:已有可复用歌单(neteasePlaylistId 命中)→ 不新建,清空旧曲目再加新的', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce({
      playlist: mkNeteasePlaylist({ id: 'pid-1' }),
      tracks: [mkTrack(9, 0), mkTrack(9, 1)],
    })
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot', neteasePlaylistId: 'pid-1' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).not.toHaveBeenCalled()
    expect(replacePlaylistTracks).toHaveBeenCalledWith('pid-1', ['9-0', '9-1'], expect.any(Array))
  })

  it('generate:缓存的 neteasePlaylistId 已失效(查无歌单)→ 走新建', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce(null)
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot', neteasePlaylistId: 'stale-pid' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalled()
  })

  it('generate:任一步抛错 → generating 回 false,entries 不清空', async () => {
    replacePlaylistTracks.mockRejectedValueOnce(new Error('boom'))
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().generating).toBe(false)
    expect(useRoamStore.getState().entries).toHaveLength(1)
    expect(useRoamStore.getState().playlist).toBeNull()
  })
})

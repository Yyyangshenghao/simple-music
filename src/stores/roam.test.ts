import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ArtistInfo, Track } from '../types/domain'
import type { MusicService } from '../lib/music-service'
import { api } from '../lib/api'
import { NeteaseMusicService } from '../lib/netease-music-service'
import { advanceProviderAccountSession } from '../lib/provider-account-session'

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

it('QQ最近歌曲用于猜歌手，完成与在途建议都按账号失效', async () => {
  const old = currentService
  const recent = vi.fn().mockResolvedValue([{ ...mkTrack(1, 0), source: 'qq', provider: 'qq', artists: [{ id: 'artist-mid', name: '歌手' }] }])
  const detail = vi.fn().mockResolvedValue({ id: 'artist-mid', name: '歌手', source: 'qq', avatar: '' })
  currentService = { getArtistSongs, getRecentTracks: recent, getArtistDetail: detail } as typeof localOnlyService
  try {
    useRoamStore.getState().clearSuggestions()
    await useRoamStore.getState().loadSuggestions(['qq'])
    expect(useRoamStore.getState().suggestions.map(a => a.name)).toEqual(['歌手'])
    await useRoamStore.getState().loadSuggestions(['qq'])
    expect(recent).toHaveBeenCalledTimes(1)
    advanceProviderAccountSession('qq')
    recent.mockResolvedValueOnce([])
    await useRoamStore.getState().loadSuggestions(['qq'])
    expect(recent).toHaveBeenCalledTimes(2)
    expect(useRoamStore.getState().suggestions).toEqual([])
    useRoamStore.getState().clearSuggestions()
    let finish!: (tracks: Track[]) => void
    recent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const loading = useRoamStore.getState().loadSuggestions(['qq'])
    advanceProviderAccountSession('qq')
    finish([{ ...mkTrack(1, 0), source: 'qq', artists: [{ id: 'old', name: '旧账号' }] }])
    await loading
    expect(useRoamStore.getState()).toMatchObject({ suggestions: [], suggestionsLoaded: false, suggestionsLoading: false })
    expect(detail).toHaveBeenCalledTimes(1)
  } finally { currentService = old; useRoamStore.getState().clearSuggestions() }
})

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => currentService
}))

const setNeteaseLoggedIn = vi.fn()
let neteaseLoggedIn = true

vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ neteaseLoggedIn, setNeteaseLoggedIn }) }
}))

let providerParticipating = true
const setAccountState = vi.fn()
vi.mock('./providers', () => ({
  isProviderParticipating: () => providerParticipating,
  useProviderStore: { getState: () => ({
    setAccountState,
    byId: { netease: { enabled: true, auth: 'authenticated' } },
  }) },
}))

import { useAppPlaylistsStore } from './app-playlists'
import { saveRoamAsAppPlaylist, useRoamStore, MAX_ARTISTS, MAX_SONGS_PER_ARTIST, type RoamArtistEntry } from './roam'

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } })
  useAppPlaylistsStore.getState().reload()
})
afterEach(() => vi.unstubAllGlobals())

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
    loadFailed: false,
    ...overrides,
  }
}

describe('roam store', () => {
  beforeEach(() => {
    neteaseLoggedIn = true
    providerParticipating = true
    currentService = localOnlyService
    useRoamStore.setState({ playlist: null, localPlaylist: null, entries: [], mode: 'hot', generating: false, error: null })
    getArtistSongs.mockClear()
    setNeteaseLoggedIn.mockClear()
    setAccountState.mockClear()
    getArtistSongs.mockImplementation(async (id: unknown) => POOLS[String(id)] ?? [])
  })

  it('confirmArtists 整体设定已选歌手,超过 MAX_ARTISTS 的丢弃', () => {
    const many = Array.from({ length: MAX_ARTISTS + 3 }, (_, i) => mkArtist(i))
    useRoamStore.getState().confirmArtists(many)
    expect(useRoamStore.getState().entries).toHaveLength(MAX_ARTISTS)
  })

  it('平台未参与时不拉取歌手曲库并移除旧条目', () => {
    providerParticipating = false
    useRoamStore.getState().confirmArtists([mkArtist(1)])
    expect(getArtistSongs).not.toHaveBeenCalled()
    expect(useRoamStore.getState().entries).toEqual([])
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

  it('confirmArtists 曲库拉取失败:该歌手曲目为空并标记 loadFailed,不影响其他歌手', async () => {
    getArtistSongs.mockImplementationOnce(async () => { throw new Error('boom') })
    useRoamStore.getState().confirmArtists([mkArtist(1), mkArtist(2)])
    await flush()
    const entries = useRoamStore.getState().entries
    expect(entries[0].tracks).toEqual([])
    expect(entries[0].loading).toBe(false)
    expect(entries[0].loadFailed).toBe(true)
    expect(entries[1].tracks).toHaveLength(3)
    expect(entries[1].loadFailed).toBe(false)
  })

  it('retryArtistPool 重新拉取失败歌手的曲库,成功后清 loadFailed 并按目标首数选曲', async () => {
    getArtistSongs.mockImplementationOnce(async () => { throw new Error('boom') })
    useRoamStore.getState().confirmArtists([mkArtist(1)])
    await flush()
    expect(useRoamStore.getState().entries[0].loadFailed).toBe(true)

    useRoamStore.getState().retryArtistPool(1)
    expect(useRoamStore.getState().entries[0].loading).toBe(true)
    await flush()
    const entry = useRoamStore.getState().entries[0]
    expect(entry.loadFailed).toBe(false)
    expect(entry.loading).toBe(false)
    expect(entry.tracks).toHaveLength(15) // 1 位歌手摊算默认首数=15
  })

  it('retryArtistPool 守卫:加载中不重发请求;entry 已移除则 no-op', async () => {
    let releasePool: (v: Track[]) => void = () => {}
    getArtistSongs.mockImplementationOnce(() => new Promise<Track[]>((r) => { releasePool = r }))
    useRoamStore.getState().confirmArtists([mkArtist(1)]) // 第 1 次拉取挂起中
    useRoamStore.getState().retryArtistPool(1) // loading 中 → no-op
    expect(getArtistSongs).toHaveBeenCalledTimes(1)
    releasePool(POOLS['1'])
    await flush()

    useRoamStore.getState().removeArtist(1)
    useRoamStore.getState().retryArtistPool(1) // 已移除 → no-op
    expect(getArtistSongs).toHaveBeenCalledTimes(1)
  })

  it('confirmArtists 重新确认同一批歌手时自动重试 loadFailed 的 entry', async () => {
    getArtistSongs.mockImplementationOnce(async () => { throw new Error('boom') })
    useRoamStore.getState().confirmArtists([mkArtist(1)])
    await flush()
    expect(useRoamStore.getState().entries[0].loadFailed).toBe(true)

    useRoamStore.getState().confirmArtists([mkArtist(1)]) // 不用手点卡片重试
    await flush()
    const entry = useRoamStore.getState().entries[0]
    expect(entry.loadFailed).toBe(false)
    expect(entry.tracks).toHaveLength(15)
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

  it('reset 一并清掉 generating 与 error:生成卡死时切音源触发 reset 后仍能恢复可用', () => {
    useRoamStore.setState({ generating: true, error: '生成失败:boom' })
    useRoamStore.getState().reset()
    expect(useRoamStore.getState().generating).toBe(false)
    expect(useRoamStore.getState().error).toBeNull()
  })
})

describe('roam store — 网易云真实歌单分支', () => {
  beforeEach(() => {
    neteaseLoggedIn = true
    currentService = neteaseRealService
    useRoamStore.setState({
      playlist: null,
      localPlaylist: null,
      entries: [],
      mode: 'hot',
      generating: false,
      error: null,
      loading: false,
      neteasePlaylistId: null,
      neteaseHydrated: false,
      scope: 'all',
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
    vi.restoreAllMocks()
  })

  function completePlaylistService() {
    const service = new NeteaseMusicService()
    return { ...neteaseRealService, getPlaylistWithDescription: vi.fn(service.getPlaylistWithDescription.bind(service)) }
  }

  it('真实服务恢复超过 100 首的漫游时保留全量曲目与顺序', async () => {
    const tracks = Array.from({ length: 150 }, (_, index) => mkTrack(9, index))
    const playlist = mkNeteasePlaylist({ description: 'Simple Music · 2000-01-01 · 歌手' })
    vi.spyOn(api, 'get').mockImplementation(async path => (path === '/api/playlist/tracks'
      ? { playlist, trackIds: tracks.map(track => track.id), tracks: tracks.slice(0, 100) }
      : { tracks: tracks.slice(100).reverse() }) as never)
    findUserPlaylistsByName.mockResolvedValue([playlist])
    useRoamStore.setState({ neteasePlaylistId: playlist.id })
    await useRoamStore.getState().ensureNeteaseHydrated(completePlaylistService() as unknown as MusicService)
    expect(useRoamStore.getState().playlist?.tracks.map(track => track.id)).toEqual(tracks.map(track => track.id))
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

  it('ensureNeteaseHydrated:命中歌单但简介日期不是今天 → 仍展示这份过期歌单(可继续听),缓存 id', async () => {
    const pl = mkNeteasePlaylist({ id: 'pid-9', description: 'Simple Music · 2000-01-01 · 周杰伦' })
    findUserPlaylistsByName.mockResolvedValue([pl])
    getPlaylistWithDescription.mockResolvedValue({ playlist: pl, tracks: [mkTrack(1, 0)] })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    const { playlist, neteasePlaylistId } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('pid-9')
    expect(playlist).not.toBeNull()
    expect(playlist!.date).toBe('2000-01-01')
    expect(playlist!.tracks).toHaveLength(1)
  })

  it('ensureNeteaseHydrated:重复调用只请求一次(neteaseHydrated 守卫)', async () => {
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(findUserPlaylistsByName).toHaveBeenCalledTimes(1)
  })

  it('ensureNeteaseHydrated:切换候选范围后丢弃迟到结果', async () => {
    let resolveCandidates: (items: MockNeteasePlaylist[]) => void = () => {}
    findUserPlaylistsByName.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCandidates = resolve
    }))
    const pending = useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    useRoamStore.getState().setScope('all')
    resolveCandidates([mkNeteasePlaylist({ description: 'Simple Music · 2000-01-01 · 周杰伦' })])
    await pending

    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().loading).toBe(false)
    expect(getPlaylistWithDescription).not.toHaveBeenCalled()
  })

  it('generate:已登录网易云也仅保存应用歌单，不调用远端写接口', async () => {
    useRoamStore.setState({ entries: [mkEntry(1)], mode: 'hot', neteasePlaylistId: 'old-cloud' })
    await useRoamStore.getState().generate()
    const state = useRoamStore.getState()
    expect(state.playlist?.appPlaylistId).toBeTruthy()
    expect(useAppPlaylistsStore.getState().items[0].tracks).toEqual(state.playlist?.tracks)
    expect(createPlaylist).not.toHaveBeenCalled()
    expect(replacePlaylistTracks).not.toHaveBeenCalled()
    expect(updatePlaylistDescription).not.toHaveBeenCalled()
  })

  it('混合音源同样进入应用歌单，保留各自身份和生成顺序', async () => {
    const qqTrack = { ...mkTrack(2, 0), provider: 'qq' as const, source: 'qq' as const }
    useRoamStore.setState({ entries: [mkEntry(1, { tracks: [mkTrack(1, 0)] }), mkEntry(2, { artist: { ...mkArtist(2), source: 'qq' }, tracks: [qqTrack] })] })
    await useRoamStore.getState().generate()
    const result = useRoamStore.getState().playlist!
    expect(result.source).toBe('mixed')
    expect(useAppPlaylistsStore.getState().items[0].tracks.map(track => track.source).sort()).toEqual(['netease', 'qq'])
    expect(createPlaylist).not.toHaveBeenCalled()
  })

  it('应用歌单落盘失败保留选歌草稿，不显示生成成功', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    useRoamStore.setState({ entries: [mkEntry(1)] })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().error).toContain('保存失败')
    expect(useRoamStore.getState().entries).toHaveLength(1)
    expect(useRoamStore.getState().generating).toBe(false)
    expect(useAppPlaylistsStore.getState().items).toEqual([])
  })

  it('同日同曲重新生成独立应用歌单，不误用已经编辑的旧结果', async () => {
    const entry = mkEntry(2, { tracks: [mkTrack(2, 0)] })
    useRoamStore.setState({ entries: [entry] })
    await useRoamStore.getState().generate()
    const first = useRoamStore.getState().playlist!.appPlaylistId!
    useAppPlaylistsStore.getState().rename(first, '我编辑过的')
    useAppPlaylistsStore.getState().removeTracks(first, ['netease:2-0'])
    useRoamStore.setState({ entries: [entry] })
    await useRoamStore.getState().generate()
    const second = useRoamStore.getState().playlist!.appPlaylistId!
    expect(second).not.toBe(first)
    expect(useAppPlaylistsStore.getState().items.find(item => item.id === second)?.tracks).toHaveLength(1)
    expect(useAppPlaylistsStore.getState().items.find(item => item.id === first)?.name).toBe('我编辑过的')
  })

  it('旧远端恢复保持只读，重复恢复不撤销已导入应用歌单的删除', async () => {
    const found = { playlist: mkNeteasePlaylist({ description: 'Simple Music · 2000-01-01 · 歌手' }), tracks: [mkTrack(1, 0)] }
    getPlaylistWithDescription.mockResolvedValue(found)
    findUserPlaylistsByName.mockResolvedValue([found.playlist])
    useRoamStore.setState({ neteasePlaylistId: 'pid-1' })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    const id = saveRoamAsAppPlaylist(useRoamStore.getState().playlist!)
    useAppPlaylistsStore.getState().remove(id)
    useRoamStore.getState().setScope('all')
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useAppPlaylistsStore.getState().items).toEqual([])
    expect(createPlaylist).not.toHaveBeenCalled()
  })
})

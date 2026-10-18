import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
const h = vi.hoisted(() => ({ sync: vi.fn(), participating: true, epoch: 0, cache: vi.fn(), read: vi.fn(), details: vi.fn(), skeleton: vi.fn(), snapshots: new Map<string, unknown>() }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ playlistWriter: { syncAppPlaylist: h.sync, readAppPlaylistSnapshot: h.read }, catalog: { getTracksByIds: h.details, getPlaylistSkeleton: h.skeleton } }) }))
vi.mock('../stores/providers', () => ({ isProviderParticipating: () => h.participating }))
vi.mock('./provider-account-session', async original => ({ ...await original<typeof import('./provider-account-session')>(), providerAccountSession: () => h.epoch }))
vi.mock('./provider-request-cache', () => ({ clearProviderRequestCache: h.cache }))
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { appPlaylistSyncContent, appPlaylistSyncReason, readAppPlaylistSnapshot, pullAppPlaylist, syncAppPlaylist } from './app-playlist-sync'
import { playlistSyncSnapshot, playlistSyncResult } from '../../server/lib/playlist-sync-report'
import type { PlaylistSyncInput, PlaylistSyncSnapshot } from '../types/playlist-sync'
import { ProviderAuthError } from './provider-account-session'

function successful(input: PlaylistSyncInput, playlistId = '201') {
  const snapshot = playlistSyncSnapshot(input.name, input.tracks.map(t => t.source === 'qq' ? { ...t, songType: t.songType ?? 0 } : t))
  h.snapshots.set(playlistId, snapshot)
  return { success: true, status: 'complete' as const, playlistId, snapshot }
}
function partial(input: PlaylistSyncInput, playlistId = '201') {
  const snapshot = playlistSyncSnapshot(input.name, [])
  h.snapshots.set(playlistId, snapshot)
  return playlistSyncResult(playlistId, input, snapshot, snapshot, [{ step: 'add', message: '操作频繁' }], input.tracks[0]?.source !== 'qq')
}
const session = { accountId: '7', accountToken: 'test-token' }
const song = (id: number, source: Track['source'] = 'netease'): Track => ({ id, source, provider: source, type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
let id: string
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
  useAppPlaylistsStore.getState().reload()
  id = useAppPlaylistsStore.getState().create('通勤', [song(3), song(1), song(2)])
  h.snapshots.clear()
  h.sync.mockReset().mockImplementation(async input => successful(input))
  h.read.mockReset().mockImplementation(async ({ playlistId }) => h.snapshots.get(playlistId))
  h.details.mockReset().mockImplementation(async ids => ids.map((id: string) => song(Number(id))))
  h.skeleton.mockReset().mockResolvedValue({ tracks: [] })
  h.participating = true; h.epoch = 0; h.cache.mockClear()
})
afterEach(() => vi.unstubAllGlobals())
it('首次记录当前账号目标，后续名称/顺序更新复用它，刷新存档后仍保留', async () => {
  await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().rename(id, '回家')
  useAppPlaylistsStore.getState().moveTrack(id, 'netease:2', -1)
  await syncAppPlaylist(id, session)
  expect(h.sync.mock.calls[1][0]).toMatchObject({ playlistId: '201', name: '回家', tracks: [{ id: '3' }, { id: '2' }, { id: '1' }] })
  useAppPlaylistsStore.getState().reload()
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].syncedContent).toBe(appPlaylistSyncContent(useAppPlaylistsStore.getState().items[0]))
})
it.each(['qq', 'apple', 'local'] as const)('混合%s拒绝同步，不过滤后悄悄写入部分歌曲', async source => {
  useAppPlaylistsStore.getState().addTracks(id, [song(4, source)])
  await expect(syncAppPlaylist(id, session)).rejects.toThrow('全部歌曲来自网易云')
  expect(h.sync).not.toHaveBeenCalled()
})
it('空歌单、无效网易云ID和未登录不能同步', async () => {
  h.participating = false
  await expect(syncAppPlaylist(id, session)).rejects.toThrow('登录')
  h.participating = true
  const item = useAppPlaylistsStore.getState().items[0]
  expect(appPlaylistSyncReason({ ...item, tracks: [] })).toContain('还没有歌曲')
  expect(appPlaylistSyncReason({ ...item, tracks: [{ ...song(1), id: 'bad' }] })).toContain('有效')
})
it('部分失败记录创建检查点，重试更新同一目标，失败不标记成功', async () => {
  h.sync.mockImplementationOnce(async input => partial(input))
  expect((await syncAppPlaylist(id, session)).status).toBe('partial')
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toMatchObject({ playlistId: '201', base: { tracks: [] }, lastReport: { matched: 0 } })
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].syncedContent).toBeUndefined()
  await syncAppPlaylist(id, session)
  expect(h.sync.mock.calls[1][0].playlistId).toBe('201')
})
it('同步期间编辑保留本地新内容，成功标记仍对应发出时的快照', async () => {
  const before = appPlaylistSyncContent(useAppPlaylistsStore.getState().items[0])
  let finish!: (value: object) => void
  h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().rename(id, '新名称')
  finish(successful(h.sync.mock.calls[0][0])); await pending
  const item = useAppPlaylistsStore.getState().items[0]
  expect(item.name).toBe('新名称')
  expect(item.neteaseSync?.['7'].syncedContent).toBe(before)
  expect(item.neteaseSync?.['7'].syncedContent).not.toBe(appPlaylistSyncContent(item))
})
it.each(['account', 'delete'] as const)('迟到的%s响应不写回已失效本地状态', async kind => {
  let finish!: (value: object) => void
  h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = syncAppPlaylist(id, session)
  if (kind === 'account') h.epoch++
  else useAppPlaylistsStore.getState().remove(id)
  finish(successful(h.sync.mock.calls[0][0]))
  if (kind === 'account') {
    await expect(pending).rejects.toThrow('账号已变化')
    expect(useAppPlaylistsStore.getState().items[0].neteaseSync).toBeUndefined()
  } else { await pending; expect(useAppPlaylistsStore.getState().items).toEqual([]) }
})
it('重复点击共用在途请求，切换账号后使用各自的云端关联', async () => {
  let finish!: (value: object) => void
  h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = syncAppPlaylist(id, session), second = syncAppPlaylist(id, session)
  expect(first).toBe(second)
  finish(successful(h.sync.mock.calls[0][0])); await first
  h.sync.mockImplementationOnce(async input => successful(input, '202'))
  await syncAppPlaylist(id, { accountId: '8', accountToken: 'another-token' })
  expect(h.sync.mock.calls[1][0].playlistId).toBeUndefined()
  expect(Object.keys(useAppPlaylistsStore.getState().items[0].neteaseSync!)).toEqual(['7', '8'])
})
it('失败或超时使旧成功快照失效，本地回退旧内容也不能误报已同步', async () => {
  await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().rename(id, '更新中')
  h.sync.mockRejectedValueOnce(new Error('REQUEST_TIMEOUT'))
  await expect(syncAppPlaylist(id, session)).rejects.toThrow('REQUEST_TIMEOUT')
  useAppPlaylistsStore.getState().rename(id, '通勤')
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toMatchObject({ playlistId: '201' })
})
it('已关联歌单删除最后一首后仍可手动更新为空，不再新建目标', async () => {
  await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().removeTracks(id, ['netease:3', 'netease:1', 'netease:2'])
  await syncAppPlaylist(id, session)
  expect(h.sync.mock.calls[1][0]).toMatchObject({ playlistId: '201', tracks: [] })
})
it('QQ关联独立于网易云，传真实数字QQ ID和类型，成功只失效QQ缓存', async () => {
  await syncAppPlaylist(id, session)
  const store = useAppPlaylistsStore.getState()
  store.removeTracks(id, ['netease:3', 'netease:1', 'netease:2'])
  store.addTracks(id, [{ ...song(1, 'qq'), id: 'mid1', qqId: 1, songType: 1 }])
  h.sync.mockImplementationOnce(async input => successful(input, '900'))
  await syncAppPlaylist(id, session, 'qq')
  expect(h.sync.mock.calls[1][0]).toMatchObject({ playlistId: undefined, tracks: [{ source: 'qq', id: 'mid1', qqId: '1', songType: 1 }] })
  useAppPlaylistsStore.getState().reload()
  const item = useAppPlaylistsStore.getState().items[0]
  expect(item.qqSync?.['7'].playlistId).toBe('900')
  expect(item.neteaseSync?.['7'].playlistId).toBe('201')
  expect(h.cache.mock.calls.map(([source]) => source)).toEqual(['netease', 'qq'])
})
it('QQ名称/曲目变化需要更新，但本地顺序变化不假称可同步', () => {
  const item = { ...useAppPlaylistsStore.getState().items[0], tracks: [1, 2].map(id => ({ ...song(id, 'qq'), qqId: id })) }
  const content = appPlaylistSyncContent(item, 'qq')
  expect(appPlaylistSyncContent({ ...item, tracks: [...item.tracks].reverse() }, 'qq')).toBe(content)
  expect(appPlaylistSyncContent({ ...item, name: '改名' }, 'qq')).not.toBe(content)
  expect(appPlaylistSyncContent({ ...item, tracks: item.tracks.slice(1) }, 'qq')).not.toBe(content)
})
it('QQ缺失数字身份、混合来源、超长名称均显示原因', () => {
  const item = useAppPlaylistsStore.getState().items[0]
  expect(appPlaylistSyncReason(item, false, 'qq')).toContain('全部歌曲来自QQ 音乐')
  expect(appPlaylistSyncReason({ ...item, tracks: [song(1, 'qq')] }, false, 'qq')).toContain('有效')
  expect(appPlaylistSyncReason({ ...item, name: '名'.repeat(21), tracks: [{ ...song(1, 'qq'), qqId: 1 }] }, false, 'qq')).toContain('20')
})
it('QQ部分失败保存当前账号检查点，切换账号不使用旧目标', async () => {
  const store = useAppPlaylistsStore.getState()
  const qqId = store.create('QQ歌单', [{ ...song(1, 'qq'), qqId: 1 }])
  h.sync.mockImplementationOnce(async input => partial(input, '900'))
  expect((await syncAppPlaylist(qqId, session, 'qq')).status).toBe('partial')
  expect(useAppPlaylistsStore.getState().items.find(item => item.id === qqId)?.qqSync?.['7']).toMatchObject({ playlistId: '900', base: { tracks: [] }, lastReport: { matched: 0 } })
  await syncAppPlaylist(qqId, session, 'qq')
  expect(h.sync.mock.calls[1][0].playlistId).toBe('900')
  await syncAppPlaylist(qqId, { ...session, accountId: '8' }, 'qq')
  expect(h.sync.mock.calls[2][0].playlistId).toBeUndefined()
})

it('检查云端只读，云端有新增时禁止未经合并推送', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  h.snapshots.set('201', playlistSyncSnapshot(base.name, [...base.tracks, { source: 'netease', id: '4' }]))
  const cloud = await readAppPlaylistSnapshot(id, session, 'netease')
  expect(cloud.tracks).toHaveLength(4)
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].base).toEqual(base)
  await expect(syncAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('先拉取')
  expect(h.sync).toHaveBeenCalledOnce()
})

it('拉取合并双方独立新增，基准只记云端，再推送时传版本且保留双方歌曲', async () => {
  await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().addTracks(id, [song(5)])
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot('云端改名', [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  await pullAppPlaylist(id, session, 'netease', cloud)
  const merged = useAppPlaylistsStore.getState().items[0]
  expect(merged.name).toBe('云端改名')
  expect(merged.tracks.map(track => String(track.id))).toEqual(['3', '1', '2', '5', '4'])
  expect(merged.tracks.find(track => String(track.id) === '4')?.name).toBe('歌曲4')
  expect(merged.neteaseSync?.['7'].base).toEqual(cloud)
  expect(merged.neteaseSync?.['7'].syncedContent).toBeUndefined()
  await syncAppPlaylist(id, session, 'netease', cloud)
  expect(h.sync.mock.calls[1][0]).toMatchObject({ expectedRevision: cloud.revision, tracks: [{ id: '3' }, { id: '1' }, { id: '2' }, { id: '5' }, { id: '4' }] })
})

it('双方改名冲突必须选择，采用云端名字后仍保留本地独立新增', async () => {
  await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().rename(id, '应用名')
  useAppPlaylistsStore.getState().addTracks(id, [song(5)])
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot('云端名', base.tracks)
  h.snapshots.set('201', cloud)
  await expect(pullAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('冲突')
  expect(useAppPlaylistsStore.getState().items[0].name).toBe('应用名')
  await pullAppPlaylist(id, session, 'netease', cloud, { name: 'cloud' })
  expect(useAppPlaylistsStore.getState().items[0]).toMatchObject({ name: '云端名', tracks: expect.arrayContaining([expect.objectContaining({ id: '5' })]) })
})

it.each(['local', 'cloud'] as const)('旧关联没有基准时要求明确首次选择：%s', async initial => {
  useAppPlaylistsStore.getState().recordNeteaseSync(id, '7', { playlistId: '201' })
  const cloud = playlistSyncSnapshot('云端版本', [{ source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  await expect(syncAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('首次对齐')
  await expect(pullAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('保留应用')
  await pullAppPlaylist(id, session, 'netease', cloud, {}, initial)
  const item = useAppPlaylistsStore.getState().items[0]
  expect(item.name).toBe(initial === 'local' ? '通勤' : '云端版本')
  expect(item.tracks.map(track => String(track.id))).toEqual(initial === 'local' ? ['3', '1', '2'] : ['4'])
  expect(item.neteaseSync?.['7'].base).toEqual(cloud)
  expect(h.sync).not.toHaveBeenCalled()
})

it('检查后云端再次变化，拒绝套用旧冲突选择或更新本地', async () => {
  await syncAppPlaylist(id, session)
  const cloud = h.snapshots.get('201') as PlaylistSyncSnapshot
  h.snapshots.set('201', playlistSyncSnapshot('再改名', cloud.tracks))
  await expect(pullAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('检查后又有修改')
  expect(useAppPlaylistsStore.getState().items[0].name).toBe('通勤')
})

it('拉取补信息期间的本地编辑不被覆盖，也不推进同步基准', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot(base.name, [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  let finish!: (value: Track[]) => void
  h.details.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pulling = pullAppPlaylist(id, session, 'netease', cloud)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  useAppPlaylistsStore.getState().rename(id, '刚改的新名')
  finish([song(4)])
  await expect(pulling).rejects.toThrow('新修改')
  expect(useAppPlaylistsStore.getState().items[0]).toMatchObject({ name: '刚改的新名', neteaseSync: { '7': { base } } })
})

it.each(['account', 'delete'] as const)('拉取期间%s变化不写回旧结果', async kind => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot('云端改名', base.tracks)
  let finish!: (value: PlaylistSyncSnapshot) => void
  h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pulling = pullAppPlaylist(id, session, 'netease', cloud)
  if (kind === 'account') h.epoch++
  else useAppPlaylistsStore.getState().remove(id)
  finish(cloud)
  await expect(pulling).rejects.toThrow(kind === 'account' ? '账号已变化' : '已被删除')
  if (kind === 'account') expect(useAppPlaylistsStore.getState().items[0].name).toBe('通勤')
  else expect(useAppPlaylistsStore.getState().items).toEqual([])
})

it('歌曲信息补拉失败仍保留云端有效ID，不丢掉歌曲', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot(base.name, [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  h.details.mockRejectedValueOnce(new Error('network unavailable'))
  await pullAppPlaylist(id, session, 'netease', cloud)
  expect(useAppPlaylistsStore.getState().items[0].tracks.at(-1)).toMatchObject({ source: 'netease', id: '4', name: '歌曲 4' })
})

it('补拉歌曲信息发生真实鉴权失效时停止，不吞掉并推进旧基准', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot(base.name, [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  h.details.mockRejectedValueOnce(new ProviderAuthError('请重新登录', 'netease', 0))
  await expect(pullAppPlaylist(id, session, 'netease', cloud)).rejects.toThrow('重新登录')
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].base).toEqual(base)
})

it('部分结果与实际云端基准在重载后保留，重试使用实际版本', async () => {
  h.sync.mockImplementationOnce(async input => partial(input))
  const result = await syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().reload()
  const link = useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']
  expect(link?.lastReport).toEqual(result.report)
  expect(link?.base).toEqual(result.snapshot)
  expect(link?.syncedContent).toBeUndefined()
  await syncAppPlaylist(id, session)
  expect(h.sync.mock.calls[1][0].expectedRevision).toBe(result.snapshot?.revision)
})

it('服务端发现陈旧版本时保留基准并提示重查，不假称部分成功', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  h.sync.mockResolvedValueOnce({ success: false, status: 'stale', playlistId: '201', error: '云端已变化' })
  await expect(syncAppPlaylist(id, session, 'netease', base)).rejects.toThrow('云端已变化')
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].base).toEqual(base)
})

it('同一歌单推送与拉取互斥，取消只读检查后不返回旧快照', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  let finish!: (value: PlaylistSyncSnapshot) => void
  h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pulling = pullAppPlaylist(id, session, 'netease', base)
  await expect(syncAppPlaylist(id, session, 'netease', base)).rejects.toThrow('正在处理')
  finish(base)
  await pulling
  const controller = new AbortController()
  h.read.mockImplementationOnce(async () => { controller.abort(); return base })
  await expect(readAppPlaylistSnapshot(id, session, 'netease', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it.each(['netease', 'qq'] as const)('%s拉取不按可播放状态或详情缺项过滤完整云端引用', async source => {
  const ref = (n: number) => source === 'qq'
    ? { source, id: `mid${n}`, qqId: String(n), songType: n === 4 ? 1 : 0 }
    : { source, id: String(n) }
  const track = (n: number): Track => ({ ...song(n, source), ...ref(n) })
  const localId = source === 'netease' ? id : useAppPlaylistsStore.getState().create('QQ歌单', [track(1)])
  await syncAppPlaylist(localId, session, source)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot(base.name, [...base.tracks, ref(4), ref(5)])
  h.snapshots.set('201', cloud)
  const unavailable = { ...track(4), playable: false, name: '当前不可播放的歌曲' }
  h.details.mockResolvedValueOnce([unavailable])
  h.skeleton.mockResolvedValueOnce({ tracks: [unavailable] })

  await pullAppPlaylist(localId, session, source, cloud)
  useAppPlaylistsStore.getState().reload()
  const item = useAppPlaylistsStore.getState().items.find(item => item.id === localId)!
  expect(item.tracks.map(track => String(track.id))).toEqual(cloud.tracks.map(track => track.id))
  expect(item.tracks.find(track => track.id === ref(4).id)).toMatchObject({ ...ref(4), playable: false, name: unavailable.name })
  expect(item.tracks.find(track => track.id === ref(5).id)).toMatchObject({ ...ref(5), name: `歌曲 ${ref(5).id}` })
  expect((source === 'qq' ? item.qqSync : item.neteaseSync)?.['7'].base).toEqual(cloud)
  expect(source === 'qq' ? h.skeleton : h.details).toHaveBeenCalledOnce()
})

it('最终回读未知时保留旧基准，恢复检查后先接受实际云端成果而不盲目重推', async () => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  useAppPlaylistsStore.getState().addTracks(id, [song(4)])
  const unknown = playlistSyncResult('201', { name: base.name, tracks: [...base.tracks, { source: 'netease', id: '4' }] }, base, undefined,
    [{ step: 'read', message: '无法确认最终结果' }], true)
  h.sync.mockResolvedValueOnce(unknown)
  await syncAppPlaylist(id, session, 'netease', base)
  useAppPlaylistsStore.getState().reload()
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toMatchObject({ base, lastReport: { matched: null, added: null, removed: null } })
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].syncedContent).toBeUndefined()

  const actual = playlistSyncSnapshot(base.name, [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', actual)
  await expect(syncAppPlaylist(id, session, 'netease', actual)).rejects.toThrow('先拉取')
  expect(h.sync).toHaveBeenCalledTimes(2)
  await pullAppPlaylist(id, session, 'netease', actual)
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toMatchObject({ base: actual, syncedContent: expect.any(String) })
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].lastReport).toBeUndefined()
})

it.each(['revision', 'duplicate', 'source', 'report'] as const)('拒绝%s损坏回执，不将其写为新同步基准', async invalid => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const result = structuredClone(playlistSyncResult('201', base, base, base, [], true))
  if (invalid === 'revision') result.snapshot!.revision = 'bad'
  if (invalid === 'duplicate') result.snapshot!.tracks.push({ ...result.snapshot!.tracks[0] })
  if (invalid === 'source') result.snapshot!.tracks[0].source = 'qq'
  if (invalid === 'report') result.report!.matched = -1
  h.sync.mockResolvedValueOnce(result)
  await expect(syncAppPlaylist(id, session, 'netease', base)).rejects.toThrow('结果无效')
  useAppPlaylistsStore.getState().reload()
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].base).toEqual(base)
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7'].syncedContent).toBeUndefined()
})

it('32份在途歌单到上限后拒绝新增，完成后释放容量且不丢失原请求', async () => {
  const finish: (() => void)[] = []
  h.sync.mockImplementation(input => new Promise(resolve => { finish.push(() => resolve(successful(input))) }))
  const localIds = Array.from({ length: 33 }, (_, index) => useAppPlaylistsStore.getState().create(`歌单${index}`, [song(index + 1)]))
  const running = localIds.slice(0, 32).map(localId => syncAppPlaylist(localId, session))
  await expect(syncAppPlaylist(localIds[32], session)).rejects.toThrow('正在处理其他歌单')
  expect(h.sync).toHaveBeenCalledTimes(32)
  finish.forEach(resolve => resolve())
  expect((await Promise.all(running)).every(result => result.status === 'complete')).toBe(true)
  h.sync.mockImplementation(async input => successful(input))
  await expect(syncAppPlaylist(localIds[32], session)).resolves.toMatchObject({ status: 'complete' })
})

it.each(['target', 'base', 'disabled'] as const)('补歌曲信息期间%s变化不套用旧合并或覆盖新的关联', async change => {
  await syncAppPlaylist(id, session)
  const base = h.snapshots.get('201') as PlaylistSyncSnapshot
  const cloud = playlistSyncSnapshot('云端名', [...base.tracks, { source: 'netease', id: '4' }])
  h.snapshots.set('201', cloud)
  let finish!: (value: Track[]) => void
  h.details.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pulling = pullAppPlaylist(id, session, 'netease', cloud)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const nextBase = playlistSyncSnapshot('新的同步基准', base.tracks)
  if (change === 'disabled') h.participating = false
  else useAppPlaylistsStore.getState().recordNeteaseSync(id, '7', { playlistId: change === 'target' ? '202' : '201', base: change === 'base' ? nextBase : base })
  finish([song(4)])
  await expect(pulling).rejects.toThrow(change === 'disabled' ? '登录并启用' : '基准已变化')
  const item = useAppPlaylistsStore.getState().items[0]
  expect(item.name).toBe('通勤')
  expect(item.tracks.map(track => String(track.id))).toEqual(['3', '1', '2'])
  expect(item.neteaseSync?.['7']).toMatchObject({ playlistId: change === 'target' ? '202' : '201', base: change === 'base' ? nextBase : base })
})

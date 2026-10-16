import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
const h = vi.hoisted(() => ({ sync: vi.fn(), participating: true, epoch: 0, cache: vi.fn() }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ playlistWriter: { syncAppPlaylist: h.sync } }) }))
vi.mock('../stores/providers', () => ({ isProviderParticipating: () => h.participating }))
vi.mock('./provider-account-session', () => ({ providerAccountSession: () => h.epoch }))
vi.mock('./provider-request-cache', () => ({ clearProviderRequestCache: h.cache }))
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { appPlaylistSyncContent, appPlaylistSyncReason, syncAppPlaylist } from './app-playlist-sync'
const session = { accountId: '7', accountToken: 'test-token' }
const song = (id: number, source: Track['source'] = 'netease'): Track => ({ id, source, provider: source, type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
let id: string
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
  useAppPlaylistsStore.getState().reload()
  id = useAppPlaylistsStore.getState().create('通勤', [song(3), song(1), song(2)])
  h.sync.mockReset().mockResolvedValue({ success: true, playlistId: '201' })
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
  h.sync.mockResolvedValueOnce({ success: false, playlistId: '201', error: '操作频繁' })
  await expect(syncAppPlaylist(id, session)).rejects.toThrow('操作频繁')
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toEqual({ playlistId: '201' })
  await syncAppPlaylist(id, session)
  expect(h.sync.mock.calls[1][0].playlistId).toBe('201')
})
it('同步期间编辑保留本地新内容，成功标记仍对应发出时的快照', async () => {
  const before = appPlaylistSyncContent(useAppPlaylistsStore.getState().items[0])
  let finish!: (value: object) => void
  h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = syncAppPlaylist(id, session)
  useAppPlaylistsStore.getState().rename(id, '新名称')
  finish({ success: true, playlistId: '201' }); await pending
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
  finish({ success: true, playlistId: '201' })
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
  finish({ success: true, playlistId: '201' }); await first
  h.sync.mockResolvedValueOnce({ success: true, playlistId: '202' })
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
  expect(useAppPlaylistsStore.getState().items[0].neteaseSync?.['7']).toEqual({ playlistId: '201' })
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
  h.sync.mockResolvedValueOnce({ success: true, playlistId: '900' })
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
  h.sync.mockResolvedValueOnce({ success: false, playlistId: '900', error: 'QQ 音乐拒绝写入（80105）' })
  await expect(syncAppPlaylist(qqId, session, 'qq')).rejects.toThrow('80105')
  expect(useAppPlaylistsStore.getState().items.find(item => item.id === qqId)?.qqSync?.['7']).toEqual({ playlistId: '900' })
  await syncAppPlaylist(qqId, session, 'qq')
  expect(h.sync.mock.calls[1][0].playlistId).toBe('900')
  await syncAppPlaylist(qqId, { ...session, accountId: '8' }, 'qq')
  expect(h.sync.mock.calls[2][0].playlistId).toBeUndefined()
})

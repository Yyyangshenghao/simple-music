import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectPlatformPlaylist, mutatePlatformPlaylist, supportsPlatformPlaylists } from './platform-playlists'

const h = vi.hoisted(() => ({ epoch: 0, enabled: true, session: vi.fn(), inspect: vi.fn(), mutate: vi.fn(), clear: vi.fn(), invalidate: vi.fn(), changed: vi.fn() }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ playlistWriter: { getPlaylistManagementSession: h.session, inspectPlatformPlaylist: h.inspect, mutatePlatformPlaylist: h.mutate } }) }))
vi.mock('../stores/providers', () => ({ isProviderParticipating: () => h.enabled }))
vi.mock('./provider-account-session', () => ({ providerAccountSession: () => h.epoch }))
vi.mock('./provider-request-cache', () => ({ clearProviderRequestCache: h.clear }))
vi.mock('../hooks/useLazyPlaylist', () => ({ invalidatePlaylistCache: h.invalidate }))
vi.mock('../stores/platform-playlists', () => ({ usePlatformPlaylistsStore: { getState: () => ({ changed: h.changed }) } }))
const track = { source: 'qq' as const, id: 'mid', qqId: '1', songType: 0 }
const command = { action: 'add' as const, playlistId: '900', tracks: [track] }
describe('平台歌单直接管理', () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.epoch++; h.enabled = true
    h.session.mockResolvedValue({ accountId: '7', accountToken: 'token' })
    h.inspect.mockResolvedValue({ playlistId: '900', name: '我的歌单' })
    h.mutate.mockResolvedValue({ playlistId: '900', status: 'complete', requested: 1, completed: 1 })
  })
  it('添加仅发送明确选中曲目，不构造全量替换快照，并使列表与详情失效', async () => {
    await mutatePlatformPlaylist('qq', command)
    expect(h.mutate).toHaveBeenCalledWith({ ...command, accountId: '7', accountToken: 'token' }, undefined)
    expect(h.clear).toHaveBeenCalledWith('qq')
    expect(h.invalidate).toHaveBeenCalledWith(expect.objectContaining({ id: '900', source: 'qq', type: 'playlist' }), { preserveSnapshot: true })
    expect(h.changed).toHaveBeenCalledWith('qq')
  })
  it('跨来源加入在获取账号或写入之前被拒绝', async () => {
    await expect(mutatePlatformPlaylist('qq', { ...command, tracks: [{ source: 'netease', id: '1' }] })).rejects.toThrow('同一平台')
    expect(h.session).not.toHaveBeenCalled(); expect(h.mutate).not.toHaveBeenCalled()
  })
  it('核实账号时换号，不向新账号发送旧操作', async () => {
    h.session.mockImplementationOnce(async () => { h.epoch++; return { accountId: '7', accountToken: 'token' } })
    await expect(mutatePlatformPlaylist('qq', command)).rejects.toThrow('账号已变化')
    expect(h.mutate).not.toHaveBeenCalled()
  })
  it('旧账号写入结果迟到不发布成功或刷新新账号页面', async () => {
    h.mutate.mockImplementationOnce(async () => { h.epoch++; return { playlistId: '900', status: 'complete', requested: 1, completed: 1 } })
    await expect(mutatePlatformPlaylist('qq', command)).rejects.toThrow('账号已变化')
    expect(h.changed).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled()
  })
  it('超时也失效旧数据，避免将可能已部分写入的平台结果当作未操作', async () => {
    h.mutate.mockRejectedValueOnce(new Error('REQUEST_TIMEOUT'))
    await expect(mutatePlatformPlaylist('qq', command)).rejects.toThrow('REQUEST_TIMEOUT')
    expect(h.invalidate).toHaveBeenCalled(); expect(h.changed).toHaveBeenCalled()
  })
  it('取消阻止提交，已发出写入取消后仍清理旧缓存但不返回成功', async () => {
    const aborted = new AbortController(); aborted.abort()
    await expect(mutatePlatformPlaylist('qq', command, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.mutate).not.toHaveBeenCalled()
    const controller = new AbortController()
    h.mutate.mockImplementationOnce(async () => { controller.abort(); return { playlistId: '900', status: 'complete', requested: 1, completed: 1 } })
    await expect(mutatePlatformPlaylist('qq', command, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.changed).toHaveBeenCalledWith('qq')
  })
  it('权限检查的迟到结果不能授予新账号编辑权', async () => {
    h.inspect.mockImplementationOnce(async () => { h.epoch++; return { playlistId: '900', name: '旧账号歌单' } })
    await expect(inspectPlatformPlaylist('qq', '900')).rejects.toThrow('账号已变化')
  })
  it('平台停用后不操作，Apple和本地不提供平台写入', async () => {
    h.enabled = false
    await expect(mutatePlatformPlaylist('qq', command)).rejects.toThrow('账号已变化')
    expect(supportsPlatformPlaylists('apple')).toBe(false)
    expect(supportsPlatformPlaylists('local')).toBe(false)
    expect(h.session).not.toHaveBeenCalled()
  })
})

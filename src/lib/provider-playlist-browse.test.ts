import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecommendationPage } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import type { Playlist } from '../types/domain'
import { advanceProviderAccountSession } from './provider-account-session'
import { getProviderPlaylistBrowse, loadProviderPlaylistBrowse } from './provider-playlist-browse'
import { clearProviderRequestCache } from './provider-request-cache'

const service = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../providers/registry', () => ({
  providerFor: (source: string) => ({ recommendations: {
    listSurfaces: () => [{ id: `${source}:playlist-feed`, kind: 'playlist-feed' }],
    load: service.load,
  } }),
}))

function playlist(id: unknown): Playlist {
  return { id, source: 'qq', provider: 'qq', type: 'playlist', name: `歌单 ${String(id)}`, cover: '', trackCount: 2, playCount: 0, creator: '歌单作者' }
}

function page(ids: unknown[], nextCursor?: string): RecommendationPage {
  return { content: { type: 'playlists', playlists: ids.map(playlist) }, hasMore: !!nextCursor, nextCursor }
}

beforeEach(() => {
  clearProviderRequestCache()
  service.load.mockReset()
  useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
})

describe('推荐歌单完整浏览', () => {
  it('沿用平台分页，按字符串身份去重并保留已浏览内容和滚动位置', async () => {
    service.load.mockResolvedValueOnce(page([1, 2], '1')).mockResolvedValueOnce(page(['2', 3], '2'))
    const first = await loadProviderPlaylistBrowse('qq')
    first!.scrollTop = 240
    expect(getProviderPlaylistBrowse('qq')).toBe(first)
    const next = await loadProviderPlaylistBrowse('qq', first!)
    expect(service.load.mock.calls).toEqual([['qq:playlist-feed', undefined], ['qq:playlist-feed', '1']])
    expect(next?.playlists.map(item => item.id)).toEqual([1, 2, 3])
    expect(next).toMatchObject({ nextCursor: '2', scrollTop: 240 })
    expect(getProviderPlaylistBrowse('qq')).toBe(next)
  })

  it.each([
    { ids: [1], cursor: '2' },
    { ids: [2], cursor: '1' },
  ])('没有新歌单或游标重复时终止翻页 %o', async ({ ids, cursor }) => {
    service.load.mockResolvedValueOnce(page([1], '1')).mockResolvedValueOnce(page(ids, cursor))
    const first = await loadProviderPlaylistBrowse('qq')
    const next = await loadProviderPlaylistBrowse('qq', first!)
    expect(next?.nextCursor).toBeUndefined()
  })

  it('翻页失败后保留原列表，再试仍请求同一页', async () => {
    service.load.mockResolvedValueOnce(page([1], '1')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([2]))
    const first = await loadProviderPlaylistBrowse('qq')
    await expect(loadProviderPlaylistBrowse('qq', first!)).rejects.toThrow('offline')
    expect(getProviderPlaylistBrowse('qq')).toBe(first)
    const recovered = await loadProviderPlaylistBrowse('qq', first!, true)
    expect(recovered?.playlists.map(item => item.id)).toEqual([1, 2])
    expect(service.load.mock.calls.slice(1).map(call => call[1])).toEqual(['1', '1'])
  })

  it('换号后丢弃快照和旧账号迟到响应', async () => {
    service.load.mockResolvedValueOnce(page([1], '1'))
    await loadProviderPlaylistBrowse('qq')
    let finish!: (value: RecommendationPage) => void
    service.load.mockImplementationOnce(() => new Promise<RecommendationPage>(resolve => { finish = resolve }))
    const pending = loadProviderPlaylistBrowse('qq', getProviderPlaylistBrowse('qq'))
    advanceProviderAccountSession('qq')
    clearProviderRequestCache('qq')
    expect(getProviderPlaylistBrowse('qq')).toBeUndefined()
    finish(page([2]))
    expect(await pending).toBeNull()
    expect(getProviderPlaylistBrowse('qq')).toBeUndefined()
  })

  it('关闭平台或清除读取缓存后不会恢复旧浏览快照', async () => {
    service.load.mockResolvedValue(page([1], '1'))
    await loadProviderPlaylistBrowse('qq')
    clearProviderRequestCache('qq')
    expect(getProviderPlaylistBrowse('qq')).toBeUndefined()
    await loadProviderPlaylistBrowse('qq')
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: false, auth: 'authenticated' } } }))
    expect(getProviderPlaylistBrowse('qq')).toBeUndefined()
    expect(await loadProviderPlaylistBrowse('qq')).toBeNull()
  })

  it('平台停用后重新启用，同账号旧请求也不能覆盖新浏览快照', async () => {
    let finish!: (value: RecommendationPage) => void
    service.load.mockImplementationOnce(() => new Promise<RecommendationPage>(resolve => { finish = resolve }))
    const old = loadProviderPlaylistBrowse('qq')
    clearProviderRequestCache('qq')
    service.load.mockResolvedValueOnce(page(['new']))
    const current = await loadProviderPlaylistBrowse('qq')
    finish(page(['old']))
    expect(await old).toBeNull()
    expect(getProviderPlaylistBrowse('qq')).toBe(current)
    expect(current?.playlists.map(item => item.id)).toEqual(['new'])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { SongComment, SongCommentsPage } from '../types/song-comments'
import { useProviderStore } from '../stores/providers'
import { advanceProviderAccountSession } from './provider-account-session'
import { loadSongComments, mergeSongCommentsPage, supportsSongComments } from './song-comments'

const h = vi.hoisted(() => ({ get: vi.fn(), resolve: vi.fn() }))
vi.mock('./api', () => ({ api: { get: h.get } }))
vi.mock('./queue-details', () => ({ resolvePending: h.resolve }))

const initial = useProviderStore.getState()
const track = (source: Track['source'], extra: Partial<Track> = {}): Track => ({
  source, provider: source, type: 'song', id: 123, name: '歌曲', artist: '歌手', artists: [], ...extra,
})
const comment = (id: unknown): SongComment => ({ id, content: String(id), time: 1700000000000, likedCount: 0, user: null })
const page = (ids: unknown[], nextOffset?: number): SongCommentsPage => ({ comments: ids.map(comment), hotComments: [], total: 50, nextOffset })

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(page([1], 20))
  h.resolve.mockReset()
  useProviderStore.setState({ byId: { ...initial.byId, netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' } } })
})
afterEach(() => useProviderStore.setState(initial))

describe('歌曲评论读取', () => {
  it('仅向歌曲原平台读取，网易标识先转字符串并按请求偏移翻页', async () => {
    const controller = new AbortController()
    await loadSongComments(track('netease'), { offset: 20, signal: controller.signal })
    expect(h.get).toHaveBeenCalledWith('/api/song/comments', { id: '123', limit: 20, offset: 20 }, { signal: controller.signal })
    expect(h.resolve).not.toHaveBeenCalled()
    expect(supportsSongComments(track('apple'))).toBe(false)
    await expect(loadSongComments(track('local'))).rejects.toThrow('这个来源暂不提供歌曲评论')
  })

  it('QQ优先使用独立的qqId和MID，不把MID里的数字拼成歌曲ID', async () => {
    await loadSongComments(track('qq', { id: '004Z8Ihr0JIu5s', qqId: '4835221', mid: '004Z8Ihr0JIu5s' }))
    expect(h.get.mock.calls[0][1]).toMatchObject({ id: '4835221', mid: '004Z8Ihr0JIu5s' })
    await loadSongComments(track('qq', { id: '004Z8Ihr0JIu5s' }))
    expect(h.get.mock.calls[1][1]).toMatchObject({ id: undefined, mid: '004Z8Ihr0JIu5s' })
    await loadSongComments(track('qq', { id: '4835221' }))
    expect(h.get.mock.calls[2][1]).toMatchObject({ id: '4835221', mid: undefined })
    await expect(loadSongComments(track('qq', { id: { id: 4835221 } }))).rejects.toThrow('歌曲标识不可用')
    await expect(loadSongComments(track('qq', { id: Number.MAX_SAFE_INTEGER + 1 }))).rejects.toThrow('歌曲标识不可用')
  })

  it('补齐pending资料后仍使用原平台读取，已中止请求不访问API', async () => {
    h.resolve.mockResolvedValue(track('qq', { id: '004Z8Ihr0JIu5s', qqId: '4835221' }))
    await loadSongComments(track('qq', { id: '004Z8Ihr0JIu5s', pending: true }))
    expect(h.get.mock.calls[0][1].id).toBe('4835221')
    const controller = new AbortController()
    controller.abort()
    await expect(loadSongComments(track('qq'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.get).toHaveBeenCalledTimes(1)
  })

  it('账号切换和来源停用再启用时丢弃迟到响应', async () => {
    let finish!: (value: SongCommentsPage) => void
    h.get.mockImplementation(() => new Promise<SongCommentsPage>(resolve => { finish = resolve }))
    const oldAccount = loadSongComments(track('netease'))
    advanceProviderAccountSession('netease')
    finish(page([1]))
    await expect(oldAccount).rejects.toMatchObject({ name: 'AbortError' })
    const oldEnabled = loadSongComments(track('qq'))
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: false, auth: 'authenticated' } } }))
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
    finish(page([2]))
    await expect(oldEnabled).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('区分业务失败与空结果，并拒绝重复或倒退的翻页偏移', async () => {
    h.get.mockResolvedValueOnce({ error: '平台请求失败', comments: [] })
    await expect(loadSongComments(track('qq'))).rejects.toThrow('平台请求失败')
    h.get.mockResolvedValueOnce(page([], 20))
    expect(await loadSongComments(track('netease'), { offset: 20 })).toMatchObject({ comments: [], nextOffset: undefined })
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: false, auth: 'authenticated' } } }))
    await expect(loadSongComments(track('qq'))).rejects.toThrow('请登录并启用')
  })

  it('翻页按评论身份去重，独立保留热评，无新增内容时结束', () => {
    const first = { ...page([1, 2], 20), hotComments: [comment('hot')] }
    const next = mergeSongCommentsPage(first, page(['2', 3, 3], 40))
    expect(next.comments.map(item => item.id)).toEqual([1, 2, 3])
    expect(next.hotComments).toEqual(first.hotComments)
    expect(next.nextOffset).toBe(40)
    expect(mergeSongCommentsPage(next, page([1, '2', 3], 60)).nextOffset).toBeUndefined()
  })
})

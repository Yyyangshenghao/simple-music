import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Track } from '../types/domain'

const likeTrack = vi.fn(async (_t: Track, _l: boolean) => true)
const checkLiked = vi.fn(async (_ids: unknown[]) => ({ '1': true }) as Record<string, boolean>)

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({ likeTrack, checkLiked })
}))

import { useLikesStore, likeKeyOf } from './likes'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'

function mk(i: number, source: 'netease' | 'qq' = 'netease'): Track {
  return { provider: source, source, type: 'song', id: i, name: `t${i}`, artist: '', artists: [] }
}

describe('likes store', () => {
  beforeEach(() => {
    useProviderStore.setState({
      byId: {
        netease: { enabled: true, auth: 'authenticated' },
        qq: { enabled: false, auth: 'anonymous' },
        apple: { enabled: false, auth: 'anonymous' },
      },
      playbackOrder: ['netease'],
    })
    useLikesStore.setState({ likedByKey: {}, qqMutationRevision: 0 })
    useToastStore.getState().dismiss()
    useSettingsStore.setState({ neteaseLoggedIn: true })
    likeTrack.mockClear()
    checkLiked.mockClear()
    likeTrack.mockResolvedValue(true)
    checkLiked.mockResolvedValue({ '1': true })
  })

  afterEach(() => {
    useToastStore.getState().dismiss()
    vi.useRealTimers()
  })

  function enableQQ() {
    useProviderStore.setState((state) => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
  }

  it('QQ 查询与乐观状态不失效歌单缓存，写入确认成功后才更新版本', async () => {
    vi.useFakeTimers()
    enableQQ()
    const track = mk(1, 'qq')
    checkLiked.mockResolvedValueOnce({ '1': false })
    const checking = useLikesStore.getState().ensureChecked(track)
    await vi.advanceTimersByTimeAsync(200)
    await checking
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)

    let finish!: (value: boolean) => void
    likeTrack.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const liking = useLikesStore.getState().toggleLike(track)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)
    await Promise.resolve()
    finish(true)
    await liking
    expect(useLikesStore.getState().qqMutationRevision).toBe(1)

    await useLikesStore.getState().toggleLike(track)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(false)
    expect(useLikesStore.getState().qqMutationRevision).toBe(2)
    expect(useToastStore.getState().message).toBeNull()
  })

  it('QQ 状态查询失败不失效歌单缓存，也不误报收藏写入失败', async () => {
    vi.useFakeTimers()
    enableQQ()
    checkLiked.mockRejectedValueOnce(new Error('network unavailable'))
    const checking = useLikesStore.getState().ensureChecked(mk(2, 'qq'))
    await vi.advanceTimersByTimeAsync(200)
    await checking

    expect(useLikesStore.getState().qqMutationRevision).toBe(0)
    expect(useLikesStore.getState().likedByKey['qq:2']).toBeUndefined()
    expect(useToastStore.getState().message).toBeNull()
    expect(useProviderStore.getState().byId.qq.auth).toBe('authenticated')
  })

  it.each(['rejected', 'unsuccessful'] as const)('QQ 取消红心%s时回滚并提示，不更新缓存版本', async (failure) => {
    enableQQ()
    const track = mk(3, 'qq')
    useLikesStore.setState({ likedByKey: { [likeKeyOf(track)]: true } })
    if (failure === 'rejected') likeTrack.mockRejectedValueOnce(new Error('收藏失败，请重试'))
    else likeTrack.mockResolvedValueOnce(false)

    await useLikesStore.getState().toggleLike(track)

    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)
    expect(useToastStore.getState().message).toBeTruthy()
    expect(useProviderStore.getState().byId.qq.auth).toBe('authenticated')
  })

  it('QQ 换号后旧写入成功不失效新账号缓存或回写状态', async () => {
    enableQQ()
    const track = mk(4, 'qq')
    let finish!: (value: boolean) => void
    likeTrack.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const liking = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    useProviderStore.getState().setAccountState('qq', 'authenticated')
    useLikesStore.setState({ likedByKey: { [likeKeyOf(track)]: false } })

    finish(true)
    await liking

    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(false)
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)
    expect(useToastStore.getState().message).toBeNull()
  })

  it.each(['rejected', 'unsuccessful'] as const)('QQ 换号后旧写入%s不回滚、提示或使新账号失效', async (failure) => {
    enableQQ()
    const track = mk(5, 'qq')
    let finish!: (value: boolean) => void
    let fail!: (error: Error) => void
    likeTrack.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = resolve
      fail = reject
    }))
    const liking = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    useProviderStore.getState().setAccountState('qq', 'authenticated')
    useLikesStore.setState({ likedByKey: { [likeKeyOf(track)]: true } })

    if (failure === 'rejected') fail(new Error('HTTP 401'))
    else finish(false)
    await liking

    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)
    expect(useToastStore.getState().message).toBeNull()
    expect(useProviderStore.getState().byId.qq.auth).toBe('authenticated')
  })

  it('ensureChecked 查询一次后缓存', async () => {
    const t = mk(1)
    await useLikesStore.getState().ensureChecked(t)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
    await useLikesStore.getState().ensureChecked(t)
    expect(checkLiked).toHaveBeenCalledTimes(1)
  })

  it('批量合并:同窗口多首曲目只发一次 checkLiked(多 ids)', async () => {
    const t1 = mk(1)
    const t2 = mk(2)
    const t3 = mk(3)
    const ps = [t1, t2, t3].map((t) => useLikesStore.getState().ensureChecked(t))
    await Promise.all(ps)
    expect(checkLiked).toHaveBeenCalledTimes(1)
    expect(checkLiked).toHaveBeenCalledWith([1, 2, 3])
    // mock 返回 { '1': true },其余未命中为 false
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t1)]).toBe(true)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t2)]).toBe(false)
  })

  it('toggleLike 乐观更新,服务端失败回滚', async () => {
    const t = mk(2)
    await useLikesStore.getState().toggleLike(t)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
    expect(likeTrack).toHaveBeenCalledWith(t, true)
    expect(useLikesStore.getState().qqMutationRevision).toBe(0)

    likeTrack.mockResolvedValueOnce(false)
    await useLikesStore.getState().toggleLike(t)
    // 取消红心失败:回滚为仍然红心
    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBe(true)
  })

  it('红心接口鉴权失效时回滚并停用对应平台', async () => {
    const t = mk(3)
    likeTrack.mockRejectedValueOnce(new Error('HTTP 401'))

    await useLikesStore.getState().toggleLike(t)

    expect(useLikesStore.getState().likedByKey[likeKeyOf(t)]).toBeUndefined()
    expect(useSettingsStore.getState().neteaseLoggedIn).toBe(false)
    expect(useProviderStore.getState().byId.netease).toMatchObject({ enabled: false, auth: 'expired' })
  })

  it('迟到的查询不覆盖查询期间成功的点赞', async () => {
    vi.useFakeTimers()
    let respond!: (value: Record<string, boolean>) => void
    checkLiked.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
    const track = mk(2)
    const checking = useLikesStore.getState().ensureChecked(track)
    await vi.advanceTimersByTimeAsync(200)
    await useLikesStore.getState().toggleLike(track)
    respond({ '2': false })
    await checking
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)
  })

  it('账号切换只清理该平台的缓存，并重新查询同曲红心', async () => {
    vi.useFakeTimers()
    const track = mk(1)
    const checking = useLikesStore.getState().ensureChecked(track)
    await vi.advanceTimersByTimeAsync(200)
    await checking
    useLikesStore.setState((state) => ({ likedByKey: { ...state.likedByKey, 'qq:1': true } }))
    useProviderStore.getState().setAccountState('netease', 'authenticated')

    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBeUndefined()
    expect(useLikesStore.getState().likedByKey['qq:1']).toBe(true)
    checkLiked.mockResolvedValueOnce({ '1': false })
    const rechecking = useLikesStore.getState().ensureChecked(track)
    await vi.advanceTimersByTimeAsync(200)
    await rechecking
    expect(checkLiked).toHaveBeenCalledTimes(2)
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(false)
  })

  it('旧账号的查询成功不能写入新账号，旧账号失败不能使新账号过期', async () => {
    vi.useFakeTimers()
    let respond!: (value: Record<string, boolean>) => void
    let fail!: (error: Error) => void
    checkLiked.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
    const first = useLikesStore.getState().ensureChecked(mk(1))
    await vi.advanceTimersByTimeAsync(200)
    checkLiked.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const second = useLikesStore.getState().ensureChecked(mk(2))
    await vi.advanceTimersByTimeAsync(200)
    useProviderStore.getState().setAccountState('netease', 'authenticated')
    respond({ '1': true })
    fail(new Error('HTTP 401'))
    await Promise.all([first, second])

    expect(useLikesStore.getState().likedByKey).toEqual({})
    expect(useProviderStore.getState().byId.netease.auth).toBe('authenticated')
    // 旧失败不能把新账号的查询放入失败冷却。
    const rechecking = useLikesStore.getState().ensureChecked(mk(2))
    await vi.advanceTimersByTimeAsync(200)
    await rechecking
    expect(checkLiked).toHaveBeenCalledTimes(3)
  })

  it('账号切换取消尚未发出的查询，待等待者仍能完成', async () => {
    vi.useFakeTimers()
    const checking = useLikesStore.getState().ensureChecked(mk(1))
    useProviderStore.getState().setAccountState('netease', 'anonymous')
    await vi.advanceTimersByTimeAsync(200)
    await checking
    expect(checkLiked).not.toHaveBeenCalled()
  })

  it('旧点赞失败不回滚新账号，新操作也不被更早的失败覆盖', async () => {
    let fail!: (error: Error) => void
    likeTrack.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const track = mk(2)
    const first = useLikesStore.getState().toggleLike(track)
    const second = useLikesStore.getState().toggleLike(track)
    const third = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    // 已再次点赞；第一操作迟到失败不能反向回滚它。
    fail(new Error('like failed'))
    await Promise.all([first, second, third])
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)

    likeTrack.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const oldAccount = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    useProviderStore.getState().setAccountState('netease', 'authenticated')
    fail(new Error('HTTP 401'))
    await oldAccount
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBeUndefined()
    expect(useProviderStore.getState().byId.netease.auth).toBe('authenticated')
  })

  it('快速点赞和取消均失败时恢复已确认状态，同曲写入按顺序提交', async () => {
    let fail!: (error: Error) => void
    likeTrack.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    likeTrack.mockResolvedValueOnce(false)
    const track = mk(2)
    const liking = useLikesStore.getState().toggleLike(track)
    const unliking = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    expect(likeTrack).toHaveBeenCalledTimes(1)
    fail(new Error('like failed'))
    await Promise.all([liking, unliking])
    expect(likeTrack.mock.calls.map(([, liked]) => liked)).toEqual([true, false])
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(false)
  })

  it('账号切换丢弃旧排队写入，旧操作完成后仍保留新账号队列', async () => {
    let finishOld!: (value: boolean) => void
    let finishNew!: (value: boolean) => void
    likeTrack.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    likeTrack.mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve }))
    const track = mk(2)
    const oldFirst = useLikesStore.getState().toggleLike(track)
    const oldQueued = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    expect(likeTrack).toHaveBeenCalledTimes(1)
    useProviderStore.getState().setAccountState('netease', 'authenticated')
    const newFirst = useLikesStore.getState().toggleLike(track)
    const newQueued = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    expect(likeTrack).toHaveBeenCalledTimes(2)

    finishOld(true)
    await Promise.all([oldFirst, oldQueued])
    const newLast = useLikesStore.getState().toggleLike(track)
    await Promise.resolve()
    expect(likeTrack).toHaveBeenCalledTimes(2)
    finishNew(true)
    await Promise.all([newFirst, newQueued, newLast])
    expect(likeTrack.mock.calls.map(([, liked]) => liked)).toEqual([true, true, false, true])
    expect(useLikesStore.getState().likedByKey[likeKeyOf(track)]).toBe(true)
  })
})

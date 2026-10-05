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

function mk(i: number): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id: i, name: `t${i}`, artist: '', artists: [] }
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
    useLikesStore.setState({ likedByKey: {} })
    useSettingsStore.setState({ neteaseLoggedIn: true })
    likeTrack.mockClear()
    checkLiked.mockClear()
    likeTrack.mockResolvedValue(true)
    checkLiked.mockResolvedValue({ '1': true })
  })

  afterEach(() => {
    vi.useRealTimers()
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

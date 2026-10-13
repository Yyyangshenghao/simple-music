import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import { usePlayerStore } from '../stores/player'
import { useShuangeStore } from '../stores/shuange'
import { useNavigationStore } from '../stores/navigation'

const h = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }))
vi.mock('../stores/player', async importOriginal => ({
  ...await importOriginal<typeof import('../stores/player')>(), registerTrackEndedInterceptor: h.register
}))
import { initShuangePlayback } from './shuange-playback'

const first: Track = { source: 'netease', provider: 'netease', type: 'song', id: 1, name: '第一首', artist: '', artists: [] }
const second: Track = { ...first, id: 2, name: '第二首' }
const range = { startSec: 30, endSec: 50, kind: 'refrain' as const }
const initial = useShuangeStore.getState()
let stop: (() => void) | undefined
let ended: () => boolean
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const pending = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  h.register.mockImplementation(callback => { ended = callback; return h.unregister })
  useShuangeStore.setState({ ...initial, active: true, feed: [first, second], index: 0, offset: range, loading: false,
    next: vi.fn(async () => {}), enter: vi.fn(async () => { useShuangeStore.setState({ active: true }) }),
    leave: vi.fn(() => { useShuangeStore.setState({ active: false }) }) })
  usePlayerStore.setState({ currentTrack: first, status: 'playing', position: 30, contextId: 'shuange:1' })
  useNavigationStore.setState({ currentView: 'shuange', history: ['explore'], future: [] })
})
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks() })

describe('宿主持有刷歌导航与续播', () => {
  it('首屏等待推荐尚未接管音频时不吞掉原队列的自然结束', () => {
    useShuangeStore.setState({ loading: true, feed: [], index: -1, offset: null })
    usePlayerStore.setState({ contextId: 'original-list' })
    stop = initShuangePlayback()
    expect(ended()).toBe(false)
    useShuangeStore.setState({ loading: false, error: '暂无推荐' })
    expect(ended()).toBe(false)
    expect(useShuangeStore.getState().next).not.toHaveBeenCalled()
  })
  it('无React也能片段推进，暂停、旧来源、无效片段和加载中不推进，结束由当前会话接管', async () => {
    stop = initShuangePlayback()
    expect(initShuangePlayback()).toBe(stop)
    expect(h.register).toHaveBeenCalledOnce()
    const next = useShuangeStore.getState().next
    usePlayerStore.setState({ status: 'paused', position: 50 })
    usePlayerStore.setState({ status: 'playing', currentTrack: { ...first, source: 'qq' } })
    expect(next).not.toHaveBeenCalled()
    expect(ended()).toBe(false)
    useShuangeStore.setState({ loading: true })
    usePlayerStore.setState({ currentTrack: first, position: 51 })
    expect(ended()).toBe(true)
    expect(next).not.toHaveBeenCalled()
    useShuangeStore.setState({ loading: false, offset: null })
    expect(ended()).toBe(false)
    useShuangeStore.setState({ offset: range })
    usePlayerStore.setState({ position: 49.7 })
    expect(next).toHaveBeenCalledOnce()
    await flush()
    usePlayerStore.setState({ status: 'paused', position: 50 })
    expect(ended()).toBe(true)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('补货未完成时进度与ended只推进一次，补货失败或去重无新卡后可重试', async () => {
    const task = pending()
    const next = vi.fn(async () => {}).mockReturnValueOnce(task.promise).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('补货失败'))
    useShuangeStore.setState({ next })
    stop = initShuangePlayback()
    usePlayerStore.setState({ position: 50 })
    usePlayerStore.setState({ position: 51 })
    expect(ended()).toBe(true)
    expect(next).toHaveBeenCalledOnce()
    task.resolve()
    await flush()
    expect(ended()).toBe(true)
    await flush()
    expect(ended()).toBe(true)
    await flush()
    expect(ended()).toBe(true)
    expect(next).toHaveBeenCalledTimes(4)
  })

  it('旧next完成不能解开新卡的推进锁，精修先更新offset不会拿旧位置误切卡', async () => {
    const old = pending(), current = pending()
    const next = vi.fn(async () => {}).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    useShuangeStore.setState({ next })
    stop = initShuangePlayback()
    usePlayerStore.setState({ position: 50 })
    useShuangeStore.setState({ index: 1, offset: { startSec: 5, endSec: 15, kind: 'refrain' } })
    expect(next).toHaveBeenCalledOnce()
    usePlayerStore.setState({ currentTrack: second, position: 5 })
    expect(next).toHaveBeenCalledOnce()
    usePlayerStore.setState({ position: 15 })
    expect(next).toHaveBeenCalledTimes(2)
    old.resolve()
    await flush()
    usePlayerStore.setState({ position: 16 })
    expect(ended()).toBe(true)
    expect(next).toHaveBeenCalledTimes(2)
    current.resolve()
  })

  it('只有进入/离开刷歌导航才进入或恢复会话，普通字段更新与整曲接管不重入', () => {
    useShuangeStore.setState({ active: false })
    useNavigationStore.setState({ currentView: 'explore' })
    stop = initShuangePlayback()
    const { enter, leave } = useShuangeStore.getState()
    useNavigationStore.getState().navigateTo('shuange')
    expect(enter).toHaveBeenCalledOnce()
    useNavigationStore.setState({ navigationRevision: 100 })
    expect(enter).toHaveBeenCalledOnce()
    useNavigationStore.getState().navigateTo('library')
    expect(leave).toHaveBeenCalledOnce()
    useNavigationStore.getState().goBack()
    expect(enter).toHaveBeenCalledTimes(2)
    useShuangeStore.setState({ active: false })
    expect(enter).toHaveBeenCalledTimes(2)
    useNavigationStore.getState().navigateTo('explore')
    expect(leave).toHaveBeenCalledOnce()
  })

  it('停止解除监听且不恢复队列音频，旧回调、后续导航/进度及迟到next完成均无效', async () => {
    const task = pending()
    const next = vi.fn(() => task.promise)
    useShuangeStore.setState({ next })
    stop = initShuangePlayback()
    usePlayerStore.setState({ position: 50 })
    const leave = useShuangeStore.getState().leave
    stop()
    stop()
    expect(h.unregister).toHaveBeenCalledOnce()
    expect(leave).not.toHaveBeenCalled()
    expect(useShuangeStore.getState().active).toBe(false)
    task.resolve()
    await flush()
    useNavigationStore.getState().navigateTo('explore')
    useNavigationStore.getState().navigateTo('shuange')
    usePlayerStore.setState({ position: 51 })
    expect(ended()).toBe(false)
    expect(next).toHaveBeenCalledOnce()
    expect(useShuangeStore.getState().enter).not.toHaveBeenCalled()
  })
})

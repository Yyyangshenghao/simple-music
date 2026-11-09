import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./qishui-music-service', async importOriginal => ({
  ...await importOriginal<typeof import('./qishui-music-service')>(),
  getQishuiListeningTracks: h.load,
}))
vi.mock('../stores/providers', async importOriginal => ({
  ...await importOriginal<typeof import('../stores/providers')>(),
  isProviderParticipating: () => participating,
}))

let participating = true

import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { initQishuiRadio, qishuiRadioContext, qishuiRadioMode } from './qishui-radio'

const track = (id: number) => ({ id: String(id), source: 'qishui', provider: 'qishui', name: `歌${id}` }) as unknown as Track
const tracks = (from: number, count: number) => Array.from({ length: count }, (_, index) => track(from + index))
const context = qishuiRadioContext('fresh')
const flush = () => new Promise(resolve => setTimeout(resolve))

function setQueue(queue: Track[], queueIndex: number, queueContextId: unknown = context) {
  usePlaylistStore.setState({ queue, queueIndex, queueContextId, shuffleOrder: queue.map((_, index) => index) })
}
const moveTo = (queueIndex: number) => usePlaylistStore.setState({ queueIndex })
const ids = () => usePlaylistStore.getState().queue.map(item => Number(item.id))

describe('汽水听歌模式续播', () => {
  let stop: () => void
  let time = 1000

  beforeEach(() => {
    h.load.mockReset()
    participating = true
    time = 1000
    useSettingsStore.setState({ playMode: 'list' } as never)
    setQueue([], -1, null)
    stop = initQishuiRadio(() => time)
  })
  afterEach(() => stop())

  it('上下文与模式互相转换，其他队列不算听歌模式', () => {
    expect(qishuiRadioMode(context)).toBe('fresh')
    expect(qishuiRadioMode('12345')).toBeNull()
    expect(qishuiRadioMode(null)).toBeNull()
  })

  it('还剩很多歌时不请求，快播完才补下一批', async () => {
    setQueue(tracks(1, 20), 0)
    moveTo(15)
    expect(h.load).not.toHaveBeenCalled()
    h.load.mockResolvedValue(tracks(21, 20))
    moveTo(16)
    expect(h.load).toHaveBeenCalledWith('fresh')
    await flush()
    expect(ids()).toHaveLength(40)
    expect(usePlaylistStore.getState().queueIndex).toBe(16)
  })

  it('普通歌单队列不续播', () => {
    setQueue(tracks(1, 5), 4, 'playlist-1')
    moveTo(3)
    expect(h.load).not.toHaveBeenCalled()
  })

  it('平台停用时不请求', () => {
    participating = false
    setQueue(tracks(1, 5), 0)
    moveTo(4)
    expect(h.load).not.toHaveBeenCalled()
  })

  it('跳过队列里已有的歌', async () => {
    setQueue(tracks(1, 5), 0)
    h.load.mockResolvedValue([track(5), track(6)])
    moveTo(4)
    await flush()
    expect(ids()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('丢掉较早播过的歌，让它们之后还能再回来，当前歌不受影响', async () => {
    setQueue(tracks(1, 40), 0)
    h.load.mockResolvedValue([track(1), track(41)])
    moveTo(38)
    await flush()
    const state = usePlaylistStore.getState()
    expect(state.queue[state.queueIndex].id).toBe('39')
    expect(state.queueIndex).toBe(30)
    expect(ids()).toContain(1)
    expect(ids()).toContain(41)
    expect(ids()).not.toContain(8)
  })

  it('切到别的队列后丢弃迟到结果', async () => {
    let resolve!: (value: Track[]) => void
    h.load.mockImplementation(() => new Promise(done => { resolve = done }))
    setQueue(tracks(1, 3), 0)
    moveTo(2)
    setQueue(tracks(100, 2), 0, 'playlist-1')
    resolve(tracks(4, 3))
    await flush()
    expect(ids()).toEqual([100, 101])
  })

  it('请求进行中不重复发起；失败后等一段时间再试', async () => {
    let reject!: (reason: Error) => void
    h.load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    setQueue(tracks(1, 5), 0)
    moveTo(3)
    moveTo(4)
    expect(h.load).toHaveBeenCalledTimes(1)
    reject(new Error('network'))
    await flush()
    h.load.mockResolvedValue(tracks(6, 2))
    moveTo(3)
    expect(h.load).toHaveBeenCalledTimes(1)
    time += 31_000
    moveTo(4)
    expect(h.load).toHaveBeenCalledTimes(2)
  })

  it('全是重复歌时同样等一段时间，不连续请求', async () => {
    setQueue(tracks(1, 5), 0)
    h.load.mockResolvedValue(tracks(1, 5))
    moveTo(3)
    await flush()
    moveTo(4)
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('随机模式按实际播放顺序判断剩余', async () => {
    useSettingsStore.setState({ playMode: 'shuffle' } as never)
    usePlaylistStore.setState({ queue: tracks(1, 10), queueIndex: 9, queueContextId: context, shuffleOrder: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] })
    moveTo(8)
    expect(h.load).not.toHaveBeenCalled()
    h.load.mockResolvedValue([])
    moveTo(2)
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('停止后不再响应', () => {
    stop()
    setQueue(tracks(1, 3), 0)
    moveTo(2)
    expect(h.load).not.toHaveBeenCalled()
  })
})

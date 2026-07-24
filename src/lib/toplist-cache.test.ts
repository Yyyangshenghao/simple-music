import { describe, it, expect, vi, beforeEach } from 'vitest'

const getToplistPreview = vi.fn()
const getToplists = vi.fn()
vi.mock('./service-registry', () => ({
  serviceFor: () => ({
    getToplistPreview: (id: unknown) => getToplistPreview(id),
    getToplists: () => getToplists(),
  }),
}))

import {
  clearToplistCaches,
  getCachedToplistGroups,
  getCachedToplistPreview,
  loadToplistGroups,
  requestToplistPreview,
} from './toplist-cache'

/** 手动可控的 promise,用来观察并发池同时在途的任务数。 */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  clearToplistCaches()
  getToplistPreview.mockReset()
  getToplists.mockReset()
})

describe('requestToplistPreview', () => {
  it('并发上限 4,其余排队,前面完成后才放行', async () => {
    const gates = Array.from({ length: 6 }, () => deferred<{ name: string; artist: string }[]>())
    getToplistPreview.mockImplementation((id: unknown) => gates[Number(id)].promise)

    const all = Array.from({ length: 6 }, (_, i) => requestToplistPreview('netease', i))
    await flush()
    expect(getToplistPreview).toHaveBeenCalledTimes(4)

    gates[0].resolve([{ name: 'a', artist: 'x' }])
    await flush()
    expect(getToplistPreview).toHaveBeenCalledTimes(5)

    for (const g of gates) g.resolve([{ name: 'a', artist: 'x' }])
    await Promise.all(all)
    expect(getToplistPreview).toHaveBeenCalledTimes(6)
  })

  it('高优先级请求插到队首,先于早排队的任务发出', async () => {
    const gates = Array.from({ length: 6 }, () => deferred<{ name: string; artist: string }[]>())
    getToplistPreview.mockImplementation((id: unknown) => gates[Number(id)].promise)

    const all = Array.from({ length: 6 }, (_, i) => requestToplistPreview('netease', i))
    await flush()
    // 4/5 还在队列里,把 5 提到队首
    void requestToplistPreview('netease', 5, { priority: 'high' })
    gates[0].resolve([])
    await flush()
    expect(getToplistPreview).toHaveBeenCalledWith(5)
    expect(getToplistPreview).not.toHaveBeenCalledWith(4)

    for (const g of gates) g.resolve([])
    await Promise.all(all)
  })

  it('成功结果写缓存,重复请求不再打上游', async () => {
    getToplistPreview.mockResolvedValue([{ name: 'a', artist: 'x' }])
    await requestToplistPreview('netease', 19723756)
    expect(getCachedToplistPreview('netease', 19723756)).toEqual([{ name: 'a', artist: 'x' }])

    await requestToplistPreview('netease', 19723756)
    expect(getToplistPreview).toHaveBeenCalledTimes(1)
  })

  it('失败返回空数组但不写缓存,下次仍会重试', async () => {
    getToplistPreview.mockRejectedValueOnce(new Error('boom'))
    expect(await requestToplistPreview('netease', 1)).toEqual([])
    expect(getCachedToplistPreview('netease', 1)).toBeNull()

    getToplistPreview.mockResolvedValueOnce([{ name: 'b', artist: 'y' }])
    expect(await requestToplistPreview('netease', 1)).toEqual([{ name: 'b', artist: 'y' }])
  })

  it('同一榜单的并发请求共用一次在途请求', async () => {
    const gate = deferred<{ name: string; artist: string }[]>()
    getToplistPreview.mockReturnValue(gate.promise)
    const a = requestToplistPreview('netease', 7)
    const b = requestToplistPreview('netease', 7)
    await flush()
    expect(getToplistPreview).toHaveBeenCalledTimes(1)
    gate.resolve([{ name: 'c', artist: 'z' }])
    expect(await a).toEqual(await b)
  })
})

describe('loadToplistGroups', () => {
  it('缓存分组,二次进入直接同步命中', async () => {
    getToplists.mockResolvedValue([{ title: '官方榜', entries: [] }])
    expect(getCachedToplistGroups('netease')).toBeNull()

    const groups = await loadToplistGroups('netease')
    expect(groups).toHaveLength(1)
    expect(getCachedToplistGroups('netease')).toEqual(groups)

    await loadToplistGroups('netease')
    expect(getToplists).toHaveBeenCalledTimes(1)
  })

  it('并发调用共用一次在途请求,失败不写缓存', async () => {
    const gate = deferred<unknown[]>()
    getToplists.mockReturnValue(gate.promise)
    const a = loadToplistGroups('netease')
    const b = loadToplistGroups('netease')
    expect(getToplists).toHaveBeenCalledTimes(1)
    gate.reject(new Error('boom'))
    expect(await a).toEqual([])
    expect(await b).toEqual([])
    expect(getCachedToplistGroups('netease')).toBeNull()
  })
})

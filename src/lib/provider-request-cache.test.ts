import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from './provider-request-cache'

describe('provider request cache', () => {
  beforeEach(() => clearProviderRequestCache())

  it('相同数据面的并发请求复用同一个在途任务', async () => {
    let resolveRequest: (value: string) => void = () => {}
    const loader = vi.fn(() => new Promise<string>((resolve) => { resolveRequest = resolve }))
    const first = requestProviderData('netease', 'recommendation:daily', loader)
    const second = requestProviderData('netease', 'recommendation:daily', loader)
    resolveRequest('ok')
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok'])
    expect(loader).toHaveBeenCalledOnce()
  })

  it('短期复用成功结果，force 可刷新且失败不会缓存', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered')

    await expect(requestProviderData('qq', 'library', loader)).resolves.toBe('first')
    await expect(requestProviderData('qq', 'library', loader)).resolves.toBe('first')
    await expect(requestProviderData('qq', 'library', loader, { force: true })).resolves.toBe('second')
    await expect(requestProviderData('qq', 'failure', loader)).rejects.toThrow('boom')
    await expect(requestProviderData('qq', 'failure', loader)).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(4)
  })

  it('只清除指定平台的缓存', async () => {
    const netease = vi.fn().mockResolvedValue('n')
    const qq = vi.fn().mockResolvedValue('q')
    await requestProviderData('netease', 'library', netease)
    await requestProviderData('qq', 'library', qq)
    clearProviderRequestCache('netease')
    await requestProviderData('netease', 'library', netease)
    await requestProviderData('qq', 'library', qq)
    expect(netease).toHaveBeenCalledTimes(2)
    expect(qq).toHaveBeenCalledOnce()
  })

  it('账号变化后不复用旧在途任务，旧结果也不重新写入缓存', async () => {
    let resolveOld: (value: string) => void = () => {}
    const oldLoader = vi.fn(() => new Promise<string>((resolve) => { resolveOld = resolve }))
    const freshLoader = vi.fn().mockResolvedValue('fresh')
    const oldRequest = requestProviderData('netease', 'library', oldLoader)

    clearProviderRequestCache('netease')
    await expect(requestProviderData('netease', 'library', freshLoader)).resolves.toBe('fresh')
    resolveOld('old')
    await expect(oldRequest).resolves.toBe('old')
    await expect(requestProviderData('netease', 'library', freshLoader)).resolves.toBe('fresh')
    expect(freshLoader).toHaveBeenCalledOnce()
  })
})

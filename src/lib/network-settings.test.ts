import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ api: { get: h.get, post: h.post } }))

import { DEFAULT_PROXY_SETTINGS, loadProxySettings, proxyTestMessage, saveProxySettings, testProxySettings } from './network-settings'

beforeEach(() => { vi.clearAllMocks() })

describe('代理设置客户端', () => {
  it('读取与保存都走 /api/network/proxy', async () => {
    h.get.mockResolvedValue(DEFAULT_PROXY_SETTINGS)
    expect(await loadProxySettings()).toEqual(DEFAULT_PROXY_SETTINGS)
    expect(h.get).toHaveBeenCalledWith('/api/network/proxy')

    const settings = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', apple: 'direct' as const, appleUrl: '' }
    h.post.mockResolvedValue(settings)
    expect(await saveProxySettings(settings)).toEqual(settings)
    expect(h.post).toHaveBeenCalledWith('/api/network/proxy', settings)
  })

  it('测试连接带上候选设置与目标出口', async () => {
    h.post.mockResolvedValue({ ok: true, status: 200, elapsedMs: 42 })
    const result = await testProxySettings(DEFAULT_PROXY_SETTINGS, 'apple')
    expect(result.ok).toBe(true)
    expect(h.post).toHaveBeenCalledWith('/api/network/proxy/test', { settings: DEFAULT_PROXY_SETTINGS, target: 'apple' }, undefined, { timeoutMs: 15_000 })
  })

  it('测试结果文案区分成功、服务端原因与兜底', () => {
    expect(proxyTestMessage({ ok: true, status: 200, elapsedMs: 42 })).toBe('连接正常（42 ms）')
    expect(proxyTestMessage({ ok: false, elapsedMs: 900, error: '代理端口没有响应，请确认代理软件正在运行' })).toBe('代理端口没有响应，请确认代理软件正在运行')
    expect(proxyTestMessage({ ok: false, elapsedMs: 900 })).toBe('通过代理连接失败')
  })
})

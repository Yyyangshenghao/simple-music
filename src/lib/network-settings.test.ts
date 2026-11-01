import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ api: { get: h.get, post: h.post } }))

import {
  DEFAULT_PROXY_SETTINGS,
  detectProxyCandidates,
  diagnoseProxySettings,
  loadProxySettings,
  loadSystemProxy,
  proxyCheckMessage,
  proxyDiagnosisSummary,
  proxyRouteLabel,
  saveProxySettings,
  sameProxySettings,
} from './network-settings'

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

  it('诊断带上草稿设置，系统代理与自动检测各有接口', async () => {
    h.post.mockResolvedValueOnce({ routes: [], systemProxy: '', hints: [] })
    await diagnoseProxySettings(DEFAULT_PROXY_SETTINGS)
    expect(h.post).toHaveBeenCalledWith('/api/network/proxy/diagnose', { settings: DEFAULT_PROXY_SETTINGS }, undefined, { timeoutMs: 30_000 })

    h.get.mockResolvedValueOnce({ address: 'http://127.0.0.1:7890' })
    expect(await loadSystemProxy()).toBe('http://127.0.0.1:7890')
    expect(h.get).toHaveBeenCalledWith('/api/network/proxy/system')

    h.post.mockResolvedValueOnce({ candidates: [{ address: 'http://127.0.0.1:7890', source: 'scan', label: 'Clash' }] })
    expect(await detectProxyCandidates()).toHaveLength(1)
  })

  it('比较设置是否有改动', () => {
    expect(sameProxySettings(DEFAULT_PROXY_SETTINGS, { ...DEFAULT_PROXY_SETTINGS })).toBe(true)
    expect(sameProxySettings(DEFAULT_PROXY_SETTINGS, { ...DEFAULT_PROXY_SETTINGS, appleUrl: 'x' })).toBe(false)
  })
})

describe('检测结果文案', () => {
  it('单项：可达带耗时，出口给地区与 IP，失败给原因', () => {
    expect(proxyCheckMessage({ id: 'netease', ok: true, elapsedMs: 42, status: 200 })).toBe('可访问 · 42 ms')
    expect(proxyCheckMessage({ id: 'apple', ok: true, elapsedMs: 7314, slow: true })).toBe('很慢 · 7314 ms')
    expect(proxyCheckMessage({ id: 'egress', ok: true, elapsedMs: 1, ip: '1.2.3.4', country: 'JP' })).toBe('日本 · 1.2.3.4')
    expect(proxyCheckMessage({ id: 'qq', ok: false, elapsedMs: 1, error: '连接超时' })).toBe('连接超时')
    expect(proxyCheckMessage({ id: 'qq', ok: false, elapsedMs: 1 })).toBe('无法访问')
  })

  it('线路：直连、系统代理与自定义', () => {
    expect(proxyRouteLabel({ address: '', source: 'direct' })).toBe('直连')
    expect(proxyRouteLabel({ address: 'http://127.0.0.1:7890', source: 'system' })).toBe('系统代理 http://127.0.0.1:7890')
    expect(proxyRouteLabel({ address: 'socks5://127.0.0.1:7891', source: 'custom' })).toBe('socks5://127.0.0.1:7891')
  })

  it('总结：有结论直接列出，否则概括失败平台', () => {
    const route = { target: 'default' as const, address: '', source: 'direct' as const }
    expect(proxyDiagnosisSummary({ routes: [], systemProxy: '', hints: ['a', 'b'] })).toBe('a；b')
    expect(proxyDiagnosisSummary({ routes: [{ ...route, checks: [{ id: 'netease', ok: true, elapsedMs: 1 }] }], systemProxy: '', hints: [] })).toBe('检测完成，各平台均可访问')
    expect(proxyDiagnosisSummary({
      routes: [{ ...route, checks: [{ id: 'netease', ok: true, elapsedMs: 1 }, { id: 'apple', ok: false, elapsedMs: 1 }, { id: 'egress', ok: false, elapsedMs: 1 }] }],
      systemProxy: '', hints: [],
    })).toBe('无法访问：Apple Music')
  })
})

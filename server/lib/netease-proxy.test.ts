import { describe, expect, it, vi } from 'vitest'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

const h = vi.hoisted(() => ({ address: '' }))
vi.mock('./upstream-proxy', () => ({ upstreamProxyAddress: (target: string) => (target === 'default' ? h.address : '') }))

import { applyNeteaseProxy, installNeteaseProxy, isNeteaseUpstream } from './netease-proxy'

describe('网易 NCM 请求的代理出口', () => {
  it('只识别网易上游域名', () => {
    expect(isNeteaseUpstream('https://interface.music.163.com/eapi/search/get')).toBe(true)
    expect(isNeteaseUpstream('https://p1.music.126.net/a.jpg')).toBe(true)
    expect(isNeteaseUpstream('/weapi/login', 'https://music.163.com')).toBe(true)
    expect(isNeteaseUpstream('https://evil163.com/x')).toBe(false)
    expect(isNeteaseUpstream('https://api.github.com/x')).toBe(false)
    expect(isNeteaseUpstream(undefined)).toBe(false)
  })

  it('直连时不改写 NCM 自带的 agent', () => {
    const config = { url: 'https://music.163.com/weapi/x', httpsAgent: 'ncm', proxy: undefined }
    expect(applyNeteaseProxy(config, '')).toEqual({ url: 'https://music.163.com/weapi/x', httpsAgent: 'ncm', proxy: undefined })
  })

  it('有出口时换成 CONNECT+TLS 的代理 agent，并关掉 axios 自带代理', () => {
    const config = applyNeteaseProxy({ url: 'https://interface.music.163.com/eapi/x', httpsAgent: 'ncm' }, 'http://127.0.0.1:7890')
    expect(config.httpsAgent).toBeInstanceOf(HttpsProxyAgent)
    expect(config.httpAgent).toBe(config.httpsAgent)
    expect(config.proxy).toBe(false)
    // 同一地址复用 agent，保留连接池。
    expect(applyNeteaseProxy({ url: 'https://music.163.com/x' }, 'http://127.0.0.1:7890').httpsAgent).toBe(config.httpsAgent)
    expect(applyNeteaseProxy({ url: 'https://music.163.com/x' }, 'http://127.0.0.1:7891').httpsAgent).not.toBe(config.httpsAgent)
  })

  it('socks5 地址改用 SocksProxyAgent，由代理解析域名', () => {
    const config = applyNeteaseProxy({ url: 'https://music.163.com/x' }, 'socks5://127.0.0.1:7891')
    expect(config.httpsAgent).toBeInstanceOf(SocksProxyAgent)
    expect((config.httpsAgent as SocksProxyAgent).shouldLookup).toBe(false)
  })

  it('换地址后旧 agent 留出在途时间再销毁，不留长连接', () => {
    vi.useFakeTimers()
    const old = applyNeteaseProxy({ url: 'https://music.163.com/x' }, 'http://127.0.0.1:7001').httpsAgent as HttpsProxyAgent<string>
    const destroy = vi.spyOn(old, 'destroy')
    applyNeteaseProxy({ url: 'https://music.163.com/x' }, 'http://127.0.0.1:7002')
    expect(destroy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(destroy).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('非网易请求不受影响', () => {
    const config = { url: 'https://example.com/x', httpsAgent: 'other' }
    expect(applyNeteaseProxy(config, 'http://127.0.0.1:7890')).toEqual({ url: 'https://example.com/x', httpsAgent: 'other' })
  })

  it('拦截器在每次请求时读取当前出口，只安装一次', () => {
    let interceptor: ((config: Record<string, unknown>) => Record<string, unknown>) | undefined
    const use = vi.fn((fn) => { interceptor = fn; return 0 })
    installNeteaseProxy({ interceptors: { request: { use } } })
    installNeteaseProxy({ interceptors: { request: { use } } })
    expect(use).toHaveBeenCalledTimes(1)
    expect(interceptor!({ url: 'https://music.163.com/x' }).proxy).toBeUndefined()
    h.address = 'http://127.0.0.1:7890'
    expect(interceptor!({ url: 'https://music.163.com/x' }).proxy).toBe(false)
  })
})

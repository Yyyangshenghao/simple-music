import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROXY_SETTINGS, type ProxySettings } from './proxy-config'

const h = vi.hoisted(() => {
  class FakeDispatcher {
    close = vi.fn(async () => {})
    destroy = vi.fn(async () => {})
    dispatch = vi.fn(() => true)
  }
  return {
    FakeDispatcher,
    original: new FakeDispatcher(),
    global: null as unknown,
    agents: [] as { kind: string; address: string; close: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; dispatch: ReturnType<typeof vi.fn> }[],
  }
})
vi.mock('undici', () => {
  const make = (kind: string) => class extends h.FakeDispatcher {
    kind = kind
    constructor(public address: string) {
      super()
      h.agents.push(this)
    }
  }
  return {
    Dispatcher: class {},
    ProxyAgent: make('http'),
    Socks5ProxyAgent: make('socks5'),
    getGlobalDispatcher: () => h.original,
    setGlobalDispatcher: (dispatcher: unknown) => { h.global = dispatcher },
  }
})

const custom = (port: number, scheme = 'http'): ProxySettings => ({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: `${scheme}://127.0.0.1:${port}` })

async function load() {
  vi.resetModules()
  return import('./upstream-proxy')
}

beforeEach(() => {
  h.global = null
  h.agents.length = 0
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(key, '')
})

describe('上游代理 dispatcher', () => {
  it('按协议建 agent，并把本机/局域网请求分流回原 dispatcher', async () => {
    const proxy = await load()
    proxy.applyUpstreamProxy(custom(7890))
    const active = h.global as { dispatch: (options: { origin: string }, handler: object) => boolean }
    active.dispatch({ origin: 'https://music.163.com' }, {})
    active.dispatch({ origin: 'http://127.0.0.1:9222' }, {})
    active.dispatch({ origin: 'http://192.168.1.5' }, {})
    expect(h.agents[0]).toMatchObject({ kind: 'http', address: 'http://127.0.0.1:7890' })
    expect(h.agents[0].dispatch).toHaveBeenCalledTimes(1)
    expect(h.original.dispatch).toHaveBeenCalledTimes(2)

    proxy.applyUpstreamProxy(custom(7891, 'socks5'))
    expect(h.agents[1]).toMatchObject({ kind: 'socks5' })
  })

  it('缓存超限时不关闭当前全局出口与 Apple 出口', async () => {
    const proxy = await load()
    const apple = { apple: 'custom' as const, appleUrl: 'http://127.0.0.1:6999' }
    for (let port = 7001; port <= 7012; port++) {
      proxy.applyUpstreamProxy({ ...custom(port), ...apple })
      proxy.dispatcherForTarget('apple')
    }
    const appleAgent = h.agents.find((agent) => agent.address === 'http://127.0.0.1:6999')!
    const last = h.agents.find((agent) => agent.address === 'http://127.0.0.1:7012')!
    expect(appleAgent.close).not.toHaveBeenCalled()
    expect(last.close).not.toHaveBeenCalled()
    expect(proxy.dispatcherForTarget('apple')).toBe(proxy.dispatcherForTarget('apple'))
    expect(h.agents.filter((agent) => agent.close.mock.calls.length > 0).length).toBeGreaterThan(0)
  })

  it('测试连接用一次性 dispatcher，测完即销毁且不进缓存', async () => {
    const proxy = await load()
    const seen = await proxy.withProbeDispatcher('http://127.0.0.1:7890', async (dispatcher) => dispatcher)
    expect(seen).not.toBe(h.original)
    expect(h.agents[0].destroy).toHaveBeenCalled()
    proxy.applyUpstreamProxy(custom(7890))
    expect(h.global).not.toBe(seen)
  })

  it('没有代理地址时测试走进程原 dispatcher', async () => {
    const proxy = await load()
    expect(await proxy.withProbeDispatcher('', async (d) => d)).toBe(h.original)
    expect(h.agents).toHaveLength(0)
  })

  it('跟随系统时用宿主解析的系统代理，变化后立即切换', async () => {
    const proxy = await load()
    proxy.applyUpstreamProxy(DEFAULT_PROXY_SETTINGS)
    expect(proxy.upstreamProxyAddress()).toBe('')
    proxy.setSystemProxyAddresses({ default: 'http://127.0.0.1:7890', apple: 'http://127.0.0.1:7890' })
    expect(proxy.upstreamProxyAddress()).toBe('http://127.0.0.1:7890')
    expect(h.agents[0].address).toBe('http://127.0.0.1:7890')
    // PAC 分流：国内直连、Apple 走代理，两个出口分别生效。
    proxy.setSystemProxyAddresses({ default: '', apple: 'http://127.0.0.1:7890' })
    expect(proxy.upstreamProxyAddress()).toBe('')
    expect(proxy.upstreamProxyAddress('apple')).toBe('http://127.0.0.1:7890')
    proxy.setSystemProxyAddresses({ default: '', apple: '' })
    expect(h.global).toBe(h.original)
    // 自定义模式不受系统代理影响。
    proxy.applyUpstreamProxy(custom(7000))
    proxy.setSystemProxyAddresses({ default: 'http://127.0.0.1:7890', apple: 'http://127.0.0.1:7890' })
    expect(proxy.upstreamProxyAddress()).toBe('http://127.0.0.1:7000')
  })

  it('isLocalNetworkHost 只认本机与私网地址，不误伤 fc/fd 开头的域名', async () => {
    const { isLocalNetworkHost } = await load()
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.0.2', '172.20.1.1', '192.168.3.4', 'nas.local', 'fd12:3456::1']) expect(isLocalNetworkHost(host)).toBe(true)
    for (const host of ['music.163.com', 'fcdn.example.com', 'fd.example.com', '172.32.0.1', '8.8.8.8']) expect(isLocalNetworkHost(host)).toBe(false)
  })
})

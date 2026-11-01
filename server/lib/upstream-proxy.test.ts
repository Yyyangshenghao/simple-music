import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROXY_SETTINGS, type ProxySettings } from './proxy-config'

const h = vi.hoisted(() => ({
  original: { name: 'original' },
  global: null as unknown,
  agents: [] as { address: string; close: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
}))
vi.mock('undici', () => ({
  Agent: class {},
  ProxyAgent: class {
    address: string
    close = vi.fn(async () => {})
    destroy = vi.fn(async () => {})
    constructor(address: string) {
      this.address = address
      h.agents.push(this)
    }
  },
  getGlobalDispatcher: () => h.original,
  setGlobalDispatcher: (dispatcher: unknown) => { h.global = dispatcher },
}))

const custom = (port: number): ProxySettings => ({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: `http://127.0.0.1:${port}` })

async function load() {
  vi.resetModules()
  return import('./upstream-proxy')
}

beforeEach(() => {
  h.global = null
  h.agents.length = 0
})

describe('上游代理 dispatcher', () => {
  it('缓存超限时不关闭当前全局出口', async () => {
    const proxy = await load()
    proxy.applyUpstreamProxy(custom(7000))
    const active = h.global as (typeof h.agents)[number]
    for (let port = 7001; port <= 7012; port++) proxy.dispatcherForTarget(custom(port), 'default')
    expect(active.close).not.toHaveBeenCalled()
    // 之后的取用仍拿到同一个未关闭的实例，不会新建。
    expect(proxy.dispatcherForTarget(custom(7000), 'default')).toBe(active)
    expect(h.agents.filter((agent) => agent.close.mock.calls.length > 0)).toHaveLength(5)
  })

  it('测试连接用一次性 dispatcher，测完即销毁且不进缓存', async () => {
    const proxy = await load()
    const seen = await proxy.withProbeDispatcher(custom(7890), 'default', async (dispatcher) => dispatcher)
    expect(seen).toBe(h.agents[0])
    expect(h.agents[0].destroy).toHaveBeenCalled()
    expect(proxy.dispatcherForTarget(custom(7890), 'default')).not.toBe(seen)
  })

  it('没有代理地址时测试走进程原 dispatcher', async () => {
    const proxy = await load()
    expect(await proxy.withProbeDispatcher({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' }, 'default', async (d) => d)).toBe(h.original)
    expect(h.agents).toHaveLength(0)
  })

  it('upstreamProxyAddress 反映当前默认出口', async () => {
    const proxy = await load()
    expect(proxy.upstreamProxyAddress()).toBe('')
    proxy.applyUpstreamProxy(custom(7890))
    expect(proxy.upstreamProxyAddress()).toBe('http://127.0.0.1:7890')
    proxy.applyUpstreamProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' })
    expect(proxy.upstreamProxyAddress()).toBe('')
    expect(h.global).toBe(h.original)
  })
})

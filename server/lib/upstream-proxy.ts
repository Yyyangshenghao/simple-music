import { isIP } from 'node:net'
import { Dispatcher, ProxyAgent, Socks5ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { DEFAULT_PROXY_SETTINGS, environmentSystemProxy, nodeProxyAddress, type ProxySettings, type ProxyTarget, type SystemProxyAddresses } from './proxy-config'

// 上游请求统一由 undici 的全局 dispatcher 承载：server 内二十多处 fetch 无需逐个改造，
// 测试里 stubGlobal('fetch') 的写法也继续有效。
const original: Dispatcher = getGlobalDispatcher()
const agents = new Map<string, Dispatcher>()
const MAX_AGENTS = 8
let appliedAddress: string | null = null
let currentSettings: ProxySettings = { ...DEFAULT_PROXY_SETTINGS }
// 宿主（Electron）解析出的系统代理；独立 server 没有宿主，只能读环境变量。
let systemAddresses: SystemProxyAddresses | null = null

/** 本机与局域网地址一律直连：开发态 Chrome 调试端口、局域网 NAS 之类不能被代理绕走。 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const family = isIP(host)
  if (family === 6) return host === '::1' || host.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(host)
  if (family !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 按请求目标分流：本地地址走进程原 dispatcher，其余走代理。 */
class BypassLocalDispatcher extends Dispatcher {
  constructor(private readonly proxy: Dispatcher) { super() }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    let local = false
    try { local = isLocalNetworkHost(new URL(String(options.origin)).hostname) } catch { /* 解析不了的交给代理处理并报错 */ }
    return (local ? original : this.proxy).dispatch(options, handler)
  }

  close(): Promise<void>
  close(callback: () => void): void
  close(callback?: () => void): Promise<void> | void {
    const done = this.proxy.close()
    if (callback) { void done.then(callback, callback); return }
    return done
  }

  destroy(): Promise<void>
  destroy(err: Error | null): Promise<void>
  destroy(callback: () => void): void
  destroy(err: Error | null, callback: () => void): void
  destroy(errOrCallback?: Error | null | (() => void), callback?: () => void): Promise<void> | void {
    const cb = typeof errOrCallback === 'function' ? errOrCallback : callback
    const done = this.proxy.destroy(typeof errOrCallback === 'function' ? null : errOrCallback ?? null)
    if (cb) { void done.then(cb, cb); return }
    return done
  }
}

/** 按地址协议建 dispatcher：http/https 走 CONNECT 隧道，socks5 走 undici 的 SOCKS5 实现。 */
export function createProxyDispatcher(address: string): Dispatcher {
  const proxy = address.startsWith('socks5:') ? new Socks5ProxyAgent(address) : new ProxyAgent(address)
  return new BypassLocalDispatcher(proxy)
}

function dispatcherForAddress(address: string): Dispatcher {
  if (!address) return original
  const cached = agents.get(address)
  if (cached) return cached
  const agent = createProxyDispatcher(address)
  // 超出上限只淘汰最早且不是当前出口的那个：关掉全局 dispatcher 会让之后所有上游请求报 ClientClosedError。
  if (agents.size >= MAX_AGENTS) {
    const inUse = new Set([appliedAddress, upstreamProxyAddress('apple')])
    for (const [key, value] of agents) {
      if (inUse.has(key)) continue
      agents.delete(key)
      void value.close().catch(() => {})
      break
    }
  }
  agents.set(address, agent)
  return agent
}

function resolvedSystemAddresses(): SystemProxyAddresses {
  return systemAddresses ?? environmentSystemProxy()
}

/** 某个出口当前实际使用的代理地址；空字符串表示直连。 */
export function upstreamProxyAddress(target: ProxyTarget = 'default'): string {
  return nodeProxyAddress(currentSettings, target, resolvedSystemAddresses())
}

/** 草稿设置（尚未保存）下某个出口会用的地址，供诊断使用；`system` 用调用方给的最新系统代理。 */
export function draftProxyAddress(settings: ProxySettings, target: ProxyTarget, system = resolvedSystemAddresses()): string {
  return nodeProxyAddress(settings, target, system)
}

/** 当前已知的系统代理（宿主按出口解析的结果，缺省为环境变量）。 */
export function systemProxyAddresses(): SystemProxyAddresses {
  return { ...resolvedSystemAddresses() }
}

function reapply(): void {
  const address = upstreamProxyAddress('default')
  if (appliedAddress === address) return
  appliedAddress = address
  setGlobalDispatcher(dispatcherForAddress(address))
}

/** 把设置应用到 Node 侧的上游请求；地址为空时恢复进程原来的 dispatcher。 */
export function applyUpstreamProxy(settings: ProxySettings): void {
  currentSettings = { ...settings }
  reapply()
}

/** 宿主解析到新的系统代理（用户在代理软件里开关了系统代理）时调用；只影响跟随系统的出口。 */
export function setSystemProxyAddresses(addresses: SystemProxyAddresses): void {
  systemAddresses = { ...addresses }
  reapply()
}

/** 某个出口的 dispatcher：Apple 单独出口供需要覆盖默认出口的请求显式传入。 */
export function dispatcherForTarget(target: ProxyTarget): Dispatcher {
  return dispatcherForAddress(upstreamProxyAddress(target))
}

/**
 * 测试连接用一次性 dispatcher：不进缓存、测完即关。用户反复试不同地址时，
 * 不会挤掉正在使用的出口，也不会让缓存里堆满没保存的地址。
 */
export async function withProbeDispatcher<T>(address: string, run: (dispatcher: Dispatcher) => Promise<T>): Promise<T> {
  if (!address) return run(original)
  const agent = createProxyDispatcher(address)
  try {
    return await run(agent)
  } finally {
    void agent.destroy().catch(() => {})
  }
}

/** 直连 Apple API（开发者令牌模式）时按 Apple 出口发请求，其余调用继续走全局 dispatcher。 */
export function appleFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: dispatcherForTarget('apple') } as unknown as RequestInit)
}

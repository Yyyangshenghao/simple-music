import { Agent, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'
import { nodeProxyAddress, type ProxySettings } from './proxy-config'

// 上游请求统一由 undici 的全局 dispatcher 承载：server 内二十多处 fetch 无需逐个改造，
// 测试里 stubGlobal('fetch') 的写法也继续有效。
const original: Dispatcher = getGlobalDispatcher()
const agents = new Map<string, Dispatcher>()
const MAX_AGENTS = 8
let appliedAddress: string | null = null

function dispatcherForAddress(address: string): Dispatcher {
  if (!address) return original
  const cached = agents.get(address)
  if (cached) return cached
  const agent = new ProxyAgent(address)
  if (agents.size >= MAX_AGENTS) {
    for (const [key, value] of agents) {
      agents.delete(key)
      void value.close().catch(() => {})
    }
  }
  agents.set(address, agent)
  return agent
}

/** 把默认出口应用到 Node 侧的上游请求；地址为空时恢复进程原来的 dispatcher。 */
export function applyUpstreamProxy(settings: ProxySettings): void {
  const address = nodeProxyAddress(settings, 'default')
  if (appliedAddress === address) return
  appliedAddress = address
  setGlobalDispatcher(dispatcherForAddress(address))
}

/** Apple 单独出口的 dispatcher，供需要覆盖默认出口的请求显式传入。 */
export function dispatcherForTarget(settings: ProxySettings, target: 'default' | 'apple'): Dispatcher {
  return dispatcherForAddress(nodeProxyAddress(settings, target))
}

/** 直连 Apple API（开发者令牌模式）时按 Apple 出口发请求，其余调用继续走全局 dispatcher。 */
export function appleFetch(url: string, init: RequestInit, settings: ProxySettings): Promise<Response> {
  const dispatcher = dispatcherForTarget(settings, 'apple')
  return fetch(url, { ...init, dispatcher } as unknown as RequestInit)
}

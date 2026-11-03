import { createRequire } from 'node:module'
import type { Agent } from 'node:http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { upstreamProxyAddress } from './upstream-proxy'

/**
 * NCM 内部用 axios 发请求，不经过 undici 全局 dispatcher。它自带的 `proxy` 参数也不能用：
 * HTTP 代理分支借 tunnel.httpOverHttp 建隧道却不做 TLS，请求会降级成明文 :80（登录 Cookie 明文过代理）；
 * PAC 分支没有关掉 axios 的 proxy 处理，在当前 axios 下代理 agent 根本不生效。
 * 这里在 NCM 自己解析到的那份 axios 上挂请求拦截器，只对网易域名换成 HttpsProxyAgent（CONNECT + TLS）
 * 或 SocksProxyAgent（socks5 地址）。
 */
const NETEASE_HOST_SUFFIXES = ['163.com', '126.net', '127.net', 'netease.com']

interface AxiosRequestLike {
  url?: string
  baseURL?: string
  httpAgent?: unknown
  httpsAgent?: unknown
  proxy?: unknown
}

interface AxiosLike {
  interceptors: { request: { use(onFulfilled: (config: AxiosRequestLike) => AxiosRequestLike): number } }
}

export function isNeteaseUpstream(url: string | undefined, baseURL?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url, baseURL).hostname.toLowerCase()
    return NETEASE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

let cachedAddress = ''
let cachedAgent: Agent | null = null
// 换地址后旧 agent 的长连接不会自己断：留出在途请求完成的时间后销毁。
const RETIRE_DELAY_MS = 60_000

function retire(agent: Agent): void {
  const timer = setTimeout(() => agent.destroy(), RETIRE_DELAY_MS)
  timer.unref?.()
}

function agentFor(address: string): Agent {
  if (cachedAgent && cachedAddress === address) return cachedAgent
  if (cachedAgent) retire(cachedAgent)
  cachedAddress = address
  cachedAgent = (address.startsWith('socks5:')
    // socks5h：域名交给代理解析，避免本地 DNS 被污染或泄露。
    ? new SocksProxyAgent(address.replace(/^socks5:/, 'socks5h:'), { keepAlive: true })
    : new HttpsProxyAgent(address, { keepAlive: true })) as unknown as Agent
  return cachedAgent
}

/** 按当前默认出口改写一次 axios 请求配置；直连或非网易请求原样返回。 */
export function applyNeteaseProxy(config: AxiosRequestLike, address: string): AxiosRequestLike {
  if (!address || !isNeteaseUpstream(config.url, config.baseURL)) return config
  const agent = agentFor(address)
  config.httpAgent = agent
  config.httpsAgent = agent
  // 必须关掉 axios 自带的代理处理（含环境变量），否则它会绕过上面的 agent。
  config.proxy = false
  return config
}

let installed = false

/** 给 NCM 使用的 axios 装一次拦截器；每个请求发出时读取当前出口，保存设置后无需重装。 */
export function installNeteaseProxy(axios?: AxiosLike): void {
  if (installed) return
  installed = true
  const target = axios ?? loadNcmAxios()
  target?.interceptors.request.use((config) => applyNeteaseProxy(config, upstreamProxyAddress('default')))
}

function loadNcmAxios(): AxiosLike | null {
  try {
    // 从 NCM 包所在位置解析 axios，拿到与 NCM 内部 require('axios') 同一个实例。
    const ncmRequire = createRequire(createRequire(import.meta.url).resolve('NeteaseCloudMusicApi'))
    return ncmRequire('axios') as AxiosLike
  } catch {
    return null
  }
}

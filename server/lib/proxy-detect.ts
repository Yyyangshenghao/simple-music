import { connect, type Socket } from 'node:net'
import { environmentProxy, stripProxyCredentials } from './proxy-config'

export interface ProxyCandidate {
  /** 可直接填入代理地址输入框的地址。 */
  address: string
  source: 'system' | 'env' | 'scan'
  /** 来源说明，例如「系统代理」「Clash / Mihomo」。 */
  label: string
}

/** 常见代理软件的本地默认端口；同一端口多家共用时合并说明。 */
const COMMON_PORTS: { port: number; label: string }[] = [
  { port: 7890, label: 'Clash / Mihomo / Stash' },
  { port: 7897, label: 'Clash Verge' },
  { port: 10809, label: 'v2rayN' },
  { port: 10808, label: 'v2rayN SOCKS' },
  { port: 1087, label: 'V2rayU / ShadowsocksX-NG' },
  { port: 1086, label: 'ShadowsocksX-NG SOCKS' },
  { port: 6152, label: 'Surge' },
  { port: 6153, label: 'Surge SOCKS' },
  { port: 2080, label: 'NekoRay / sing-box' },
  { port: 20171, label: 'v2rayA' },
  { port: 12334, label: 'Hiddify' },
  { port: 1080, label: 'SOCKS 通用端口' },
]
const PROBE_TIMEOUT_MS = 1500

type Protocol = 'http' | 'socks5' | null

function exchange(port: number, payload: Buffer | string, accept: (chunk: Buffer) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket | null = null
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      socket?.destroy()
      resolve(result)
    }
    socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false))
    socket.once('error', () => done(false))
    // 对端直接断开（协议不对）时不会有 error，也不再触发空闲超时。
    socket.once('close', () => done(false))
    socket.once('connect', () => socket?.write(payload))
    socket.once('data', (chunk) => done(accept(chunk)))
  })
}

/**
 * 判断本机端口上是哪种代理：先发 HTTP CONNECT（任意 HTTP 状态行即是 HTTP 代理，混合端口也走这里），
 * 不是再发 SOCKS5 无认证握手。只连 127.0.0.1，不会把探测流量发到别处。
 */
export async function probeLocalProxy(port: number): Promise<Protocol> {
  const http = await exchange(port, 'CONNECT www.apple.com:443 HTTP/1.1\r\nHost: www.apple.com:443\r\n\r\n', (chunk) => /^HTTP\/1\.[01] \d{3}/.test(chunk.toString('latin1', 0, 16)))
  if (http) return 'http'
  const socks = await exchange(port, Buffer.from([0x05, 0x01, 0x00]), (chunk) => chunk[0] === 0x05 && chunk[1] === 0x00)
  return socks ? 'socks5' : null
}

/** 汇总可用的代理候选：系统代理、环境变量、本机常见端口；按地址去重，系统代理排在最前。 */
export async function detectProxyCandidates(systemProxy: string): Promise<ProxyCandidate[]> {
  const candidates: ProxyCandidate[] = []
  const seen = new Set<string>()
  const add = (candidate: ProxyCandidate) => {
    const key = stripProxyCredentials(candidate.address)
    if (!candidate.address || seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }
  add({ address: systemProxy, source: 'system', label: '系统代理' })
  add({ address: environmentProxy(), source: 'env', label: '环境变量' })
  const scanned = await Promise.all(COMMON_PORTS.map(async ({ port, label }) => ({ port, label, protocol: await probeLocalProxy(port) })))
  // HTTP 端口排在 SOCKS 前：登录窗口与 HTTP 代理认证兼容性最好。
  for (const protocol of ['http', 'socks5'] as const) {
    for (const item of scanned) {
      if (item.protocol === protocol) add({ address: `${protocol}://127.0.0.1:${item.port}`, source: 'scan', label: item.label })
    }
  }
  return candidates
}

import { lookup } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { connect, isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { Dispatcher } from 'undici'
import { stripProxyCredentials, type ProxySettings, type ProxyTarget } from './proxy-config'
import { draftProxyAddress, withProbeDispatcher } from './upstream-proxy'

export type ProxyCheckId = 'netease' | 'qq' | 'apple' | 'egress'

export interface ProxyCheck {
  id: ProxyCheckId
  ok: boolean
  elapsedMs: number
  status?: number
  error?: string
  /** 能访问但响应过慢（超过 SLOW_CHECK_MS）：实际使用会卡顿，单独提示。 */
  slow?: boolean
  /** Apple 检查才有：Apple 按本次出口判定的地区（官网首页跳转地址里的两位地区码，小写）。 */
  appleRegion?: string
  /** 出口检查才有：出口 IP 与两位国家/地区码（大写）。 */
  ip?: string
  country?: string
}

export interface ProxyRouteReport {
  /** default 覆盖网易/QQ/通用；Apple 出口与默认不同时单列 apple。 */
  target: ProxyTarget
  /** 实际使用的代理（已去掉账号密码）；空字符串表示直连。 */
  address: string
  source: 'custom' | 'system' | 'direct'
  /** 代理端口能否连上；直连时省略。 */
  proxyReachable?: boolean
  proxyError?: string
  checks: ProxyCheck[]
}

export interface ProxyDiagnosis {
  routes: ProxyRouteReport[]
  /** 主进程解析到的系统代理（跟随系统时的真实出口）；空字符串表示系统未设代理。 */
  systemProxy: string
  /**
   * 代理软件以 TUN/增强模式在系统层接管了网络：应用选「直连」的流量同样会被导到代理节点。
   * 依据是域名被解析成 fake-ip（198.18.0.0/15）或本机存在该网段的虚拟网卡。
   */
  systemTakeover?: boolean
  findings: DiagnosisFinding[]
}

/**
 * 检测结论分两级：problem 影响使用、需要处理，界面用醒目卡片并给出可点的解决动作；
 * notice 只是告知，界面一行小字。标题要短，细节放 detail。
 */
export interface DiagnosisFinding {
  level: 'problem' | 'notice'
  title: string
  detail?: string
  /** proxy-rules：打开代理软件规则；apple-direct：把 Apple 出口改为直连；detect-proxy：自动检测本机代理。 */
  action?: 'proxy-rules' | 'apple-direct' | 'detect-proxy'
}

const CHECK_TIMEOUT_MS = 8000
// 一次 HEAD 含 DNS、TCP 与 TLS 握手；超过 3 秒时曲库加载与起播会明显卡顿。
export const SLOW_CHECK_MS = 3000
const PLATFORM_LABELS: Record<Exclude<ProxyCheckId, 'egress'>, string> = { netease: '网易云音乐', qq: 'QQ 音乐', apple: 'Apple Music' }
const PROXY_CONNECT_TIMEOUT_MS = 3000
const CHECK_URLS: Record<Exclude<ProxyCheckId, 'egress'>, string> = {
  netease: 'https://music.163.com/',
  qq: 'https://y.qq.com/',
  apple: 'https://music.apple.com/',
}
// Cloudflare trace 是几百字节的纯文本，国内外都能访问，给出出口 IP 与国家码。
const EGRESS_URLS = ['https://www.cloudflare.com/cdn-cgi/trace', 'https://1.1.1.1/cdn-cgi/trace']
const STOREFRONT_FILE = 'apple-music-storefront'

interface ErrorLike { name?: string; code?: string; message?: string; cause?: unknown }

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 5) {
    chain.push(current as ErrorLike)
    current = (current as ErrorLike).cause
  }
  return chain
}

/** 把 undici / 代理 / TLS 的报错翻译成用户能处理的原因。 */
export function describeNetworkError(error: unknown, viaProxy: boolean): string {
  const chain = errorChain(error)
  const codes = new Set(chain.map((item) => item.code).filter(Boolean))
  const text = chain.map((item) => item.message ?? '').join(' ')
  const proxyStatus = /Proxy response \((\d{3})\)/i.exec(text)?.[1]
  if (proxyStatus === '407' || (/authentication/i.test(text) && /socks/i.test(text))) return '代理需要认证或账号密码不正确'
  if (proxyStatus) return `代理拒绝了连接（${proxyStatus}）`
  if (chain.some((item) => item.name === 'TimeoutError') || codes.has('UND_ERR_CONNECT_TIMEOUT') || codes.has('ETIMEDOUT')) {
    return viaProxy ? '通过代理连接超时，节点可能不可用' : '连接超时'
  }
  if (codes.has('ECONNREFUSED')) return viaProxy ? '代理端口没有响应，请确认代理软件正在运行' : '连接被拒绝'
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) return viaProxy ? '代理地址无法解析' : '域名解析失败，请检查网络或 DNS'
  if (codes.has('ECONNRESET') || codes.has('UND_ERR_SOCKET')) return viaProxy ? '连接被代理或节点中断' : '连接被重置，可能被网络拦截'
  if ([...codes].some((code) => /CERT|SSL|TLS/i.test(String(code)))) return '证书校验失败，网络或代理可能在篡改 HTTPS'
  if (/socks/i.test(text)) return 'SOCKS5 代理握手失败，请确认端口协议'
  if (chain.some((item) => item.name === 'AbortError')) return '检测已取消'
  return viaProxy ? '通过代理连接失败' : '连接失败'
}

/** 先单独确认代理端口能连上，免得把「代理软件没开」误报成每个平台都不可用。 */
function probeProxyPort(address: string): Promise<string | null> {
  let url: URL
  try { url = new URL(address) } catch { return Promise.resolve('代理地址格式无效') }
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) })
    const finish = (error: string | null) => { socket.destroy(); resolve(error) }
    socket.setTimeout(PROXY_CONNECT_TIMEOUT_MS, () => finish('代理端口连接超时'))
    socket.once('connect', () => finish(null))
    socket.once('error', (error) => finish(describeNetworkError(error, true)))
  })
}

async function checkSite(id: Exclude<ProxyCheckId, 'egress'>, dispatcher: Dispatcher, viaProxy: boolean): Promise<ProxyCheck> {
  const startedAt = Date.now()
  try {
    // HEAD + 不跟随跳转：只关心能否握手拿到响应，不下载页面。
    const response = await fetch(CHECK_URLS[id], {
      method: 'HEAD',
      redirect: 'manual',
      dispatcher,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    } as unknown as RequestInit)
    const elapsedMs = Date.now() - startedAt
    if (response.status === 407) return { id, ok: false, elapsedMs, status: 407, error: '代理需要认证或账号密码不正确' }
    if (response.status >= 500) return { id, ok: false, elapsedMs, status: response.status, error: `服务器返回 ${response.status}` }
    const appleRegion = id === 'apple' ? appleRegionFromLocation(response.headers.get('location')) : ''
    return {
      id, ok: true, elapsedMs, status: response.status,
      ...(elapsedMs > SLOW_CHECK_MS ? { slow: true } : {}),
      ...(appleRegion ? { appleRegion } : {}),
    }
  } catch (error) {
    return { id, ok: false, elapsedMs: Date.now() - startedAt, error: describeNetworkError(error, viaProxy) }
  }
}

/**
 * music.apple.com 首页会按访问者 IP 301 到 `/{地区}/new`；这个地区就是 Apple 实际看到的位置，
 * 比通用出口检测更能说明 Apple Music 是否经过了代理。
 */
export function appleRegionFromLocation(location: string | null): string {
  if (!location) return ''
  try {
    const url = new URL(location, CHECK_URLS.apple)
    if (url.hostname !== 'music.apple.com') return ''
    return /^\/([a-z]{2})(?:\/|$)/.exec(url.pathname)?.[1] ?? ''
  } catch {
    return ''
  }
}

export function parseTrace(text: string): { ip?: string; country?: string } {
  const fields = Object.fromEntries(text.split('\n').map((line) => line.split('=')).filter((pair) => pair.length === 2).map(([k, v]) => [k.trim(), v.trim()]))
  const country = /^[A-Z]{2}$/.test(fields.loc ?? '') ? fields.loc : undefined
  return { ip: fields.ip || undefined, country }
}

async function checkEgress(dispatcher: Dispatcher, viaProxy: boolean): Promise<ProxyCheck> {
  const startedAt = Date.now()
  let lastError: unknown
  for (const url of EGRESS_URLS) {
    try {
      const response = await fetch(url, { dispatcher, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) } as unknown as RequestInit)
      const trace = parseTrace(await response.text())
      if (response.ok && trace.ip) return { id: 'egress', ok: true, elapsedMs: Date.now() - startedAt, ...trace }
    } catch (error) {
      lastError = error
    }
  }
  return { id: 'egress', ok: false, elapsedMs: Date.now() - startedAt, error: lastError ? describeNetworkError(lastError, viaProxy) : '无法识别出口地区' }
}

function routeSource(settings: ProxySettings, target: ProxyTarget, address: string): ProxyRouteReport['source'] {
  if (!address) return 'direct'
  if (target === 'apple' && settings.apple === 'custom') return 'custom'
  return settings.mode === 'custom' ? 'custom' : 'system'
}

async function diagnoseRoute(settings: ProxySettings, target: ProxyTarget, address: string, ids: Exclude<ProxyCheckId, 'egress'>[]): Promise<ProxyRouteReport> {
  const report: ProxyRouteReport = { target, address: stripProxyCredentials(address), source: routeSource(settings, target, address), checks: [] }
  if (address) {
    const portError = await probeProxyPort(address)
    report.proxyReachable = !portError
    if (portError) {
      report.proxyError = portError
      report.checks = [...ids, 'egress' as const].map((id) => ({ id, ok: false, elapsedMs: 0, error: '代理不可用，未检测' }))
      return report
    }
  }
  const viaProxy = !!address
  report.checks = await withProbeDispatcher(address, (dispatcher) => Promise.all([
    ...ids.map((id) => checkSite(id, dispatcher, viaProxy)),
    checkEgress(dispatcher, viaProxy),
  ]))
  return report
}

// Clash/Mihomo、sing-box、Surge 等 TUN 模式默认都用 198.18.0.0/15 做虚拟网卡与 fake-ip。
const TAKEOVER_PROBE_HOSTS = ['music.163.com', 'music.apple.com']
const TAKEOVER_LOOKUP_TIMEOUT_MS = 2000

export function isFakeIp(address: string): boolean {
  if (!isIPv4(address)) return false
  const [a, b] = address.split('.').map(Number)
  return a === 198 && (b === 18 || b === 19)
}

export interface TakeoverProbe {
  lookup(host: string): Promise<string[]>
  interfaces(): string[]
}

const systemProbe: TakeoverProbe = {
  lookup: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
  interfaces: () => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((item) => item.address)),
}

/** 识别代理软件的系统级接管：任一探测域名解析到 fake-ip，或本机有 fake-ip 网段的虚拟网卡。 */
export async function detectSystemTakeover(probe: TakeoverProbe = systemProbe): Promise<boolean> {
  try {
    if (probe.interfaces().some(isFakeIp)) return true
  } catch { /* 读不到网卡时只看 DNS */ }
  const results = await Promise.all(TAKEOVER_PROBE_HOSTS.map((host) => Promise.race([
    probe.lookup(host).catch(() => [] as string[]),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), TAKEOVER_LOOKUP_TIMEOUT_MS)),
  ])))
  return results.some((addresses) => addresses.some(isFakeIp))
}

function readStorefront(userDataDir: string): string {
  try {
    const value = readFileSync(join(userDataDir, STOREFRONT_FILE), 'utf8').trim().toLowerCase()
    return /^[a-z]{2}$/.test(value) ? value : ''
  } catch {
    return ''
  }
}

let regionNames: Intl.DisplayNames | null | undefined
// 系统语言给的全称（如“中国香港特别行政区”）放在短结论里太长，常见地区用短名。
const SHORT_REGION_NAMES: Record<string, string> = { HK: '中国香港', MO: '中国澳门', TW: '中国台湾' }
export function regionName(code: string): string {
  const short = SHORT_REGION_NAMES[code.toUpperCase()]
  if (short) return short
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' }) } catch { regionNames = null }
  }
  try { return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase() } catch { return code.toUpperCase() }
}

function egressOf(report: ProxyRouteReport | undefined): string {
  return report?.checks.find((check) => check.id === 'egress' && check.ok)?.country ?? ''
}

/** 根据诊断结果给出结论：先列影响使用的问题（带解决动作），再列提示；问题在前。 */
export function diagnosisFindings(diagnosis: Omit<ProxyDiagnosis, 'findings'>, settings: ProxySettings, storefront: string): DiagnosisFinding[] {
  const problems: DiagnosisFinding[] = []
  const notices: DiagnosisFinding[] = []
  const main = diagnosis.routes.find((route) => route.target === 'default')
  const apple = diagnosis.routes.find((route) => route.target === 'apple') ?? main

  for (const route of diagnosis.routes) {
    if (route.proxyReachable === false) {
      problems.push({ level: 'problem', title: '代理连不上', detail: `${route.address}：${route.proxyError ?? '不可用'}`, ...(route.source === 'custom' ? { action: 'detect-proxy' as const } : {}) })
    } else if (route.checks.every((check) => !check.ok)) {
      // 所有站点同一个原因（例如 407）就直接说原因，比笼统的「节点失效」更好处理。
      const reasons = new Set(route.checks.map((check) => check.error))
      const reason = reasons.size === 1 ? [...reasons][0] : undefined
      problems.push({ level: 'problem', title: route.address ? '经代理无法访问任何平台' : '无法联网', detail: reason ?? (route.address ? '节点可能失效' : '请检查网络连接') })
    }
  }

  // 优先用 Apple 自己判定的地区；拿不到（请求失败）再退回通用出口地区。
  const appleRegion = apple?.checks.find((check) => check.id === 'apple' && check.ok)?.appleRegion ?? ''
  const appleSeen = appleRegion || egressOf(apple).toLowerCase()
  if (apple && storefront && appleSeen && appleSeen !== storefront) {
    const detail = `${appleRegion ? 'Apple 判定' : '出口'}在${regionName(appleSeen)}，账号在${regionName(storefront)}，登录与曲库会被带到${regionName(appleSeen)}`
    if (apple.address) {
      // 应用自己设的代理把 Apple 带偏了：直接在应用里改成直连即可。
      problems.push({ level: 'problem', title: 'Apple Music 地区与账号不一致', detail, action: 'apple-direct' })
    } else {
      // 应用已是直连仍被带偏：只能在代理软件（TUN/VPN）里加规则。
      problems.push({ level: 'problem', title: diagnosis.systemTakeover ? 'Apple Music 正经过代理软件' : 'Apple Music 地区与账号不一致', detail, action: 'proxy-rules' })
    }
  }

  if (settings.mode === 'system' && !diagnosis.systemProxy && !diagnosis.systemTakeover) {
    notices.push({ level: 'notice', title: '系统没有开代理，跟随系统等于直连' })
  }
  for (const route of diagnosis.routes) {
    for (const check of route.checks) {
      if (!check.slow || check.id === 'egress') continue
      const seconds = (check.elapsedMs / 1000).toFixed(1)
      const detail = route.address ? '节点可能拥堵，可以换节点' : check.id === 'apple' ? '可以给 Apple Music 单独设代理' : '请检查本机网络'
      notices.push({ level: 'notice', title: `${PLATFORM_LABELS[check.id]}${check.id === 'apple' ? ' ' : ''}响应慢（${seconds} 秒）`, detail })
    }
  }
  const mainCountry = egressOf(main)
  if (mainCountry && mainCountry !== 'CN') {
    notices.push({ level: 'notice', title: `默认出口在${regionName(mainCountry)}`, detail: '网易云、QQ 音乐的部分歌曲可能受版权地区限制' })
  }
  return [...problems, ...notices]
}

/**
 * 按草稿设置（不必先保存）诊断每个出口：代理端口、网易/QQ/Apple 可达性与出口地区。
 * Apple 出口与默认出口相同时合并成一条，避免重复请求。
 */
export async function diagnoseProxy(settings: ProxySettings, userDataDir: string, systemProxy: string, probe?: TakeoverProbe): Promise<ProxyDiagnosis> {
  const defaultAddress = draftProxyAddress(settings, 'default', systemProxy)
  const appleAddress = draftProxyAddress(settings, 'apple', systemProxy)
  const separateApple = appleAddress !== defaultAddress
  const [systemTakeover, ...routes] = await Promise.all([
    detectSystemTakeover(probe),
    diagnoseRoute(settings, 'default', defaultAddress, separateApple ? ['netease', 'qq'] : ['netease', 'qq', 'apple']),
    ...(separateApple ? [diagnoseRoute(settings, 'apple', appleAddress, ['apple'])] : []),
  ])
  const partial = { routes, systemProxy: stripProxyCredentials(systemProxy), systemTakeover }
  return { ...partial, findings: diagnosisFindings(partial, settings, readStorefront(userDataDir)) }
}

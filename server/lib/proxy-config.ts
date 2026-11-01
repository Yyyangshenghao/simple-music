import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 默认出口。system=窗口与数据请求都跟随系统代理（Electron 解析系统设置后同步给 Node 侧，独立 server 只认环境变量）；
 * custom=都走指定代理；direct=都不走。
 */
export type ProxyMode = 'system' | 'custom' | 'direct'
/** Apple Music 单独出口：inherit 跟随默认；direct/custom 覆盖默认，避免国内节点把海外账号带回国内。 */
export type AppleProxyMode = 'inherit' | 'direct' | 'custom'
export type ProxyTarget = 'default' | 'apple'

export interface ProxySettings {
  mode: ProxyMode
  url: string
  apple: AppleProxyMode
  appleUrl: string
}

/** 传给 Electron 各会话 setProxy 的规则；与 Electron 类型解耦，便于单测。 */
export interface ElectronProxyRules {
  mode: 'system' | 'direct' | 'fixed_servers'
  proxyRules?: string
  proxyBypassRules?: string
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = { mode: 'system', url: '', apple: 'inherit', appleUrl: '' }

const PROXY_FILE = 'proxy.json'
const MODES: readonly ProxyMode[] = ['system', 'custom', 'direct']
const APPLE_MODES: readonly AppleProxyMode[] = ['inherit', 'direct', 'custom']
const SCHEME_ALIASES: Record<string, string> = { 'http:': 'http:', 'https:': 'https:', 'socks5:': 'socks5:', 'socks5h:': 'socks5:', 'socks:': 'socks5:' }
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443', 'socks5:': '1080' }
// 本地地址必须显式绕过：本地 API、壁纸与歌词服务不能被代理绕一圈。
const LOOPBACK_BYPASS = 'localhost,127.0.0.1,::1,<local>'
const ENV_PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const

export class ProxyConfigError extends Error {}

/**
 * 规范化代理地址：缺省协议按 http 补全（代理软件界面通常只给 127.0.0.1:7890），socks/socks5h 统一成 socks5，
 * 补齐默认端口并去掉末尾斜线。只接受 http/https/socks5，且不能带路径、查询或片段。
 */
export function normalizeProxyAddress(value: unknown, label = '代理地址'): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new ProxyConfigError(`${label}必须是字符串`)
  let address = value.trim()
  if (!address) return ''
  if (address.length > 2048) throw new ProxyConfigError(`${label}过长`)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) address = `http://${address}`
  let url: URL
  try { url = new URL(address) } catch { throw invalidAddress(label) }
  const protocol = SCHEME_ALIASES[url.protocol.toLowerCase()]
  if (!protocol) throw new ProxyConfigError(`${label}只支持 http://、https:// 或 socks5://，例如 http://127.0.0.1:7890`)
  if (!url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash) throw invalidAddress(label)
  if (protocol === 'socks5:' && (url.username || url.password)) {
    // Chromium 的 SOCKS 代理不支持认证：登录窗口会连不上，干脆在保存前拦下。
    throw new ProxyConfigError(`${label}：SOCKS5 代理不支持账号密码，请改用代理软件的 HTTP 端口`)
  }
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  return `${protocol}//${auth}${url.hostname}:${url.port || DEFAULT_PORTS[protocol]}`
}

function invalidAddress(label: string): ProxyConfigError {
  return new ProxyConfigError(`${label}格式无效，应为 主机:端口，例如 http://127.0.0.1:7890`)
}

/** 接口入参校验：字段缺失取默认值，明确写错则报错，避免把半截配置落盘。 */
export function validateProxySettings(input: unknown): ProxySettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProxyConfigError('代理设置格式无效')
  const raw = input as Record<string, unknown>
  const mode = raw.mode ?? DEFAULT_PROXY_SETTINGS.mode
  const apple = raw.apple ?? DEFAULT_PROXY_SETTINGS.apple
  if (!MODES.includes(mode as ProxyMode)) throw new ProxyConfigError('代理模式无效')
  if (!APPLE_MODES.includes(apple as AppleProxyMode)) throw new ProxyConfigError('Apple Music 代理模式无效')
  const settings: ProxySettings = {
    mode: mode as ProxyMode,
    url: normalizeProxyAddress(raw.url, '代理地址'),
    apple: apple as AppleProxyMode,
    appleUrl: normalizeProxyAddress(raw.appleUrl, 'Apple Music 代理地址'),
  }
  // 选了自定义却没填地址时，Node 与 Electron 会各自退回不同出口；直接拒绝，不让两侧不一致。
  if (settings.mode === 'custom' && !settings.url) throw new ProxyConfigError('请填写代理地址')
  if (settings.apple === 'custom' && !settings.appleUrl) throw new ProxyConfigError('请填写 Apple Music 代理地址')
  return settings
}

/** 读取磁盘配置：文件缺失、损坏或字段非法时退回默认，不让用户因为一个坏文件再也连不上网。 */
export function readProxySettings(userDataDir: string): ProxySettings {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(join(userDataDir, PROXY_FILE), 'utf8')) } catch { return { ...DEFAULT_PROXY_SETTINGS } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PROXY_SETTINGS }
  const record = { ...(raw as Record<string, unknown>) }
  // 旧版本可能落下「选了自定义却没地址」的配置：按跟随系统/跟随默认读出，而不是整份作废。
  if (record.mode === 'custom' && !record.url) record.mode = 'system'
  if (record.apple === 'custom' && !record.appleUrl) record.apple = 'inherit'
  try { return validateProxySettings(record) } catch { return { ...DEFAULT_PROXY_SETTINGS } }
}

export function writeProxySettings(userDataDir: string, settings: ProxySettings): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, PROXY_FILE), `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** 环境变量代理：没有 Electron 宿主（独立 server）时 system 模式唯一能读到的「系统设置」。 */
export function environmentProxy(): string {
  for (const key of ENV_PROXY_KEYS) {
    const value = process.env[key]
    if (!value) continue
    try { return normalizeProxyAddress(value, '环境变量代理') } catch { /* 环境变量写错时按直连处理 */ }
  }
  return ''
}

/**
 * 把 Chromium `resolveProxy` 的 PAC 结果（如 `PROXY 127.0.0.1:7890; DIRECT`）转成代理地址。
 * 取第一个可用条目；DIRECT 或无法识别时返回空字符串（直连）。SOCKS（v4）按 socks5 处理，主流代理软件都是混合端口。
 */
export function parsePacResult(raw: string): string {
  for (const entry of String(raw || '').split(';')) {
    const [type, target] = entry.trim().split(/\s+/)
    if (!type) continue
    const kind = type.toUpperCase()
    if (kind === 'DIRECT') return ''
    if (!target) continue
    const scheme = kind === 'PROXY' || kind === 'HTTP' ? 'http' : kind === 'HTTPS' ? 'https' : kind.startsWith('SOCKS') ? 'socks5' : ''
    if (!scheme) continue
    try { return normalizeProxyAddress(`${scheme}://${target}`) } catch { /* 下一个条目 */ }
  }
  return ''
}

/**
 * 某个出口实际使用的代理地址；空字符串表示直连。
 * `systemAddress` 是宿主解析出的系统代理（缺省读环境变量），只在 system 模式下使用。
 */
export function nodeProxyAddress(settings: ProxySettings, target: ProxyTarget = 'default', systemAddress = environmentProxy()): string {
  if (target === 'apple') {
    if (settings.apple === 'direct') return ''
    if (settings.apple === 'custom') return settings.appleUrl
  }
  if (settings.mode === 'custom') return settings.url
  if (settings.mode === 'direct') return ''
  return systemAddress
}

/** 去掉账号密码：Chromium 的 proxyRules 不认 userinfo，认证由主进程 login 事件补上。 */
export function stripProxyCredentials(address: string): string {
  try {
    const url = new URL(address)
    return `${url.protocol}//${url.host}`
  } catch {
    return address
  }
}

/** 代理地址里的账号密码；按 host:port 匹配 Chromium 的代理认证请求。 */
export function proxyCredentials(address: string): { host: string; port: number; username: string; password: string } | null {
  try {
    const url = new URL(address)
    if (!url.username) return null
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || DEFAULT_PORTS[url.protocol] || 0),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    }
  } catch {
    return null
  }
}

/** Electron 会话规则。system 交给 Chromium 读系统代理，custom 用固定代理并绕过本地地址。 */
export function electronProxyRules(settings: ProxySettings, target: ProxyTarget = 'default'): ElectronProxyRules {
  const fixed = (address: string): ElectronProxyRules => ({ mode: 'fixed_servers', proxyRules: stripProxyCredentials(address), proxyBypassRules: LOOPBACK_BYPASS })
  if (target === 'apple') {
    if (settings.apple === 'direct') return { mode: 'direct' }
    if (settings.apple === 'custom' && settings.appleUrl) return fixed(settings.appleUrl)
  }
  if (settings.mode === 'direct') return { mode: 'direct' }
  if (settings.mode === 'custom' && settings.url) return fixed(settings.url)
  return { mode: 'system' }
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 默认出口。system=窗口跟随系统代理（数据请求只认环境变量）；custom=窗口与数据请求都走指定
 * HTTP 代理；direct=都不走。Node 侧没有读取系统代理的标准能力，所以要让数据也走代理必须选 custom。
 */
export type ProxyMode = 'system' | 'custom' | 'direct'
/** Apple Music 单独出口：inherit 跟随默认；direct/custom 覆盖默认，避免国内节点把海外账号带回国内。 */
export type AppleProxyMode = 'inherit' | 'direct' | 'custom'

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
const PROXY_ADDRESS = /^https?:\/\/[^\s/?#]+(?::\d{1,5})?$/
// 自定义代理必须显式绕过本地地址：本地 API、壁纸与歌词服务不能被代理绕一圈。
const LOOPBACK_BYPASS = 'localhost,127.0.0.1,::1'
const ENV_PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

export class ProxyConfigError extends Error {}

function proxyAddress(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new ProxyConfigError(`${label}必须是字符串`)
  const address = value.trim().replace(/\/$/, '')
  if (!address) return ''
  if (address.length > 2048 || !PROXY_ADDRESS.test(address)) {
    throw new ProxyConfigError(`${label}必须是 http:// 或 https:// 地址，例如 http://127.0.0.1:7890`)
  }
  return address
}

/** 接口入参校验：字段缺失取默认值，明确写错则报错，避免把半截配置落盘。 */
export function validateProxySettings(input: unknown): ProxySettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProxyConfigError('代理设置格式无效')
  const raw = input as Record<string, unknown>
  const mode = raw.mode ?? DEFAULT_PROXY_SETTINGS.mode
  const apple = raw.apple ?? DEFAULT_PROXY_SETTINGS.apple
  if (!MODES.includes(mode as ProxyMode)) throw new ProxyConfigError('代理模式无效')
  if (!APPLE_MODES.includes(apple as AppleProxyMode)) throw new ProxyConfigError('Apple Music 代理模式无效')
  return {
    mode: mode as ProxyMode,
    url: proxyAddress(raw.url, '代理地址'),
    apple: apple as AppleProxyMode,
    appleUrl: proxyAddress(raw.appleUrl, 'Apple Music 代理地址'),
  }
}

/** 读取磁盘配置：文件缺失、损坏或字段非法时逐项退回默认，不让用户因为一个坏文件再也连不上网。 */
export function readProxySettings(userDataDir: string): ProxySettings {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(join(userDataDir, PROXY_FILE), 'utf8')) } catch { return { ...DEFAULT_PROXY_SETTINGS } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PROXY_SETTINGS }
  let settings: ProxySettings
  try { settings = validateProxySettings(raw) } catch { return { ...DEFAULT_PROXY_SETTINGS } }
  // custom 但地址为空时按跟随系统处理，避免把用户留在「选了代理却没地址」的死配置上。
  if (settings.mode === 'custom' && !settings.url) settings.mode = 'system'
  if (settings.apple === 'custom' && !settings.appleUrl) settings.apple = 'inherit'
  return settings
}

export function writeProxySettings(userDataDir: string, settings: ProxySettings): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, PROXY_FILE), `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** 环境变量代理：system 模式下 Node 侧唯一能利用的「系统设置」。 */
function environmentProxy(): string {
  for (const key of ENV_PROXY_KEYS) {
    const value = process.env[key]
    if (!value) continue
    try { return proxyAddress(value, '环境变量代理') } catch { /* 环境变量写错时按直连处理 */ }
  }
  return ''
}

/** Node 侧（主进程上游请求）实际使用的代理地址；空字符串表示直连。 */
export function nodeProxyAddress(settings: ProxySettings, target: 'default' | 'apple' = 'default'): string {
  if (target === 'apple') {
    if (settings.apple === 'direct') return ''
    if (settings.apple === 'custom') return settings.appleUrl
  }
  if (settings.mode === 'custom') return settings.url
  if (settings.mode === 'direct') return ''
  return environmentProxy()
}

/** Electron 会话规则。system 交给 Chromium 读系统代理，custom 用固定代理并绕过本地地址。 */
export function electronProxyRules(settings: ProxySettings, target: 'default' | 'apple' = 'default'): ElectronProxyRules {
  if (target === 'apple') {
    if (settings.apple === 'direct') return { mode: 'direct' }
    if (settings.apple === 'custom' && settings.appleUrl) return { mode: 'fixed_servers', proxyRules: settings.appleUrl, proxyBypassRules: LOOPBACK_BYPASS }
  }
  if (settings.mode === 'direct') return { mode: 'direct' }
  if (settings.mode === 'custom' && settings.url) return { mode: 'fixed_servers', proxyRules: settings.url, proxyBypassRules: LOOPBACK_BYPASS }
  return { mode: 'system' }
}

import { api } from './api'

export type ProxyMode = 'system' | 'custom' | 'direct'
export type AppleProxyMode = 'inherit' | 'direct' | 'custom'

export interface ProxySettings {
  mode: ProxyMode
  url: string
  apple: AppleProxyMode
  appleUrl: string
}

export interface ProxyTestResult {
  ok: boolean
  status?: number
  elapsedMs: number
  error?: string
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = { mode: 'system', url: '', apple: 'inherit', appleUrl: '' }

export function loadProxySettings(): Promise<ProxySettings> {
  return api.get<ProxySettings>('/api/network/proxy')
}

export function saveProxySettings(settings: ProxySettings): Promise<ProxySettings> {
  return api.post<ProxySettings>('/api/network/proxy', settings)
}

export function testProxySettings(settings: ProxySettings, target: 'default' | 'apple'): Promise<ProxyTestResult> {
  return api.post<ProxyTestResult>('/api/network/proxy/test', { settings, target }, undefined, { timeoutMs: 15_000 })
}

/** 测试结果的展示文案；成功时带上耗时，失败时透出服务端给出的可读原因。 */
export function proxyTestMessage(result: ProxyTestResult): string {
  if (result.ok) return `连接正常（${result.elapsedMs} ms）`
  return result.error || '通过代理连接失败'
}

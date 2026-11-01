import { api } from './api'
import { appleRegionLabel } from './apple-music-regions'

export type ProxyMode = 'system' | 'custom' | 'direct'
export type AppleProxyMode = 'inherit' | 'direct' | 'custom'

export interface ProxySettings {
  mode: ProxyMode
  url: string
  apple: AppleProxyMode
  appleUrl: string
}

export type ProxyCheckId = 'netease' | 'qq' | 'apple' | 'egress'

export interface ProxyCheck {
  id: ProxyCheckId
  ok: boolean
  elapsedMs: number
  status?: number
  error?: string
  slow?: boolean
  /** Apple 检查才有：Apple 按出口判定的地区（小写两位码）。 */
  appleRegion?: string
  ip?: string
  country?: string
}

export interface ProxyRouteReport {
  target: 'default' | 'apple'
  address: string
  source: 'custom' | 'system' | 'direct'
  proxyReachable?: boolean
  proxyError?: string
  checks: ProxyCheck[]
}

export interface ProxyDiagnosis {
  routes: ProxyRouteReport[]
  systemProxy: string
  systemProxyApple?: string
  /** 代理软件的 TUN/增强模式在系统层接管了网络，「直连」也会经过代理节点。 */
  systemTakeover?: boolean
  findings: DiagnosisFinding[]
}

export interface DiagnosisFinding {
  level: 'problem' | 'notice'
  title: string
  detail?: string
  action?: 'proxy-rules' | 'apple-direct' | 'detect-proxy'
}

export interface ProxyCandidate {
  address: string
  source: 'system' | 'env' | 'scan'
  label: string
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = { mode: 'system', url: '', apple: 'inherit', appleUrl: '' }

export function loadProxySettings(): Promise<ProxySettings> {
  return api.get<ProxySettings>('/api/network/proxy')
}

export function saveProxySettings(settings: ProxySettings): Promise<ProxySettings> {
  return api.post<ProxySettings>('/api/network/proxy', settings)
}

export interface SystemProxyInfo {
  /** 默认出口（网易域名）的系统代理；空字符串表示系统让它直连。 */
  address: string
  /** Apple 出口（Apple 域名）的系统代理；PAC/分流时可能与默认不同。 */
  apple: string
}

export async function loadSystemProxy(): Promise<SystemProxyInfo> {
  const result = await api.get<Partial<SystemProxyInfo>>('/api/network/proxy/system')
  return { address: result.address ?? '', apple: result.apple ?? result.address ?? '' }
}

/** 按草稿设置诊断各出口；服务端每项 8 秒超时，并发执行，整体留足余量。 */
export function diagnoseProxySettings(settings: ProxySettings): Promise<ProxyDiagnosis> {
  return api.post<ProxyDiagnosis>('/api/network/proxy/diagnose', { settings }, undefined, { timeoutMs: 30_000 })
}

export async function detectProxyCandidates(): Promise<ProxyCandidate[]> {
  return (await api.post<{ candidates: ProxyCandidate[] }>('/api/network/proxy/detect', {}, undefined, { timeoutMs: 15_000 })).candidates
}

export function sameProxySettings(a: ProxySettings, b: ProxySettings): boolean {
  return a.mode === b.mode && a.url === b.url && a.apple === b.apple && a.appleUrl === b.appleUrl
}

export const PROXY_CHECK_LABELS: Record<ProxyCheckId, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  apple: 'Apple Music',
  egress: '出口地区',
}

/** 出口国家码转短名；与 Apple 地区共用一份名称表（中国香港等用短名）。 */
export function regionLabel(code: string | undefined): string {
  return code ? appleRegionLabel(code.toLowerCase()) : ''
}

/** 单项检测结果的展示文案：可达带耗时；出口给地区与 IP；失败透出服务端原因。 */
export function proxyCheckMessage(check: ProxyCheck): string {
  if (!check.ok) return check.error || '无法访问'
  if (check.id === 'egress') return [regionLabel(check.country) || '未知地区', check.ip].filter(Boolean).join(' · ')
  return `${check.slow ? '很慢' : '可访问'} · ${check.elapsedMs} ms`
}

/** 线路说明：经哪个代理或直连，跟随系统时注明来源；直连被 TUN 接管时标出来。 */
export function proxyRouteLabel(route: Pick<ProxyRouteReport, 'address' | 'source'>, takeover = false): string {
  if (!route.address) return takeover ? '直连 · TUN 接管' : '直连'
  return route.source === 'system' ? `系统代理 ${route.address}` : route.address
}

/** 诊断总结：一句话；问题与提示另行分级展示。 */
export function proxyDiagnosisSummary(diagnosis: ProxyDiagnosis): string {
  const problems = diagnosis.findings.filter((finding) => finding.level === 'problem').length
  if (problems) return `发现 ${problems} 个问题`
  const checks = diagnosis.routes.flatMap((route) => route.checks)
  const failed = checks.filter((check) => !check.ok && check.id !== 'egress')
  if (failed.length) return `无法访问：${failed.map((check) => PROXY_CHECK_LABELS[check.id]).join('、')}`
  const notices = diagnosis.findings.length
  return notices ? `各平台均可访问，另有 ${notices} 条提示` : '各平台均可访问'
}

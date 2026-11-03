/**
 * 代理软件分流规则：开着 TUN/增强模式时，应用无法自行绕开代理，只能请用户在代理软件里让
 * Apple Music（或整个应用）直连。这里按常见客户端生成可直接粘贴的规则文本。
 */
export type ProxyClient = 'clash' | 'surge' | 'singbox'
export type RuleScope = 'apple' | 'app'
export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

/** Apple Music 网页、授权、曲库与音频 CDN 用到的域名后缀。 */
export const APPLE_DIRECT_DOMAINS = ['apple.com', 'mzstatic.com', 'cdn-apple.com', 'aaplimg.com', 'apple-cloudkit.com'] as const

/** 直连时用于解析 Apple 域名的国内 DoH；海外 DNS 会给出海外节点 IP，直连过去登录慢、播放超时。 */
export const DOMESTIC_DNS = ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'] as const

export const PROXY_CLIENTS: readonly { id: ProxyClient; label: string; where: string; dnsWhere: string }[] = [
  {
    id: 'clash', label: 'Clash / Mihomo',
    where: '放在 rules 最前面。Clash Verge：订阅 → 编辑规则 → 前置规则。',
    dnsWhere: '合并进 dns 段。Clash Verge：订阅 → 扩展覆写配置。',
  },
  { id: 'surge', label: 'Surge', where: '放在 [Rule] 段最前面。', dnsWhere: '放在 [Host] 段。' },
  { id: 'singbox', label: 'sing-box', where: '放在 route.rules 最前面，outbound 改成你的直连出站 tag。', dnsWhere: '放在 dns.rules 最前面，server 改成你的国内 DNS tag。' },
]

/**
 * 应用的进程名。Chromium 的网络请求跑在 Helper 进程里（登录窗口、MusicKit 播放），
 * 主进程负责搜索与曲库请求，两者都要直连才算整个应用直连。
 */
export function appProcessNames(platform: DesktopPlatform): string[] {
  if (platform === 'win32') return ['Simple Music.exe']
  if (platform === 'darwin') return ['Simple Music', 'Simple Music Helper']
  return ['simplemusic']
}

export function proxyRuleSnippet(client: ProxyClient, scope: RuleScope, platform: DesktopPlatform): string {
  const domains = [...APPLE_DIRECT_DOMAINS]
  const processes = appProcessNames(platform)
  if (client === 'singbox') {
    const rule = scope === 'apple' ? { domain_suffix: domains, outbound: 'direct' } : { process_name: processes, outbound: 'direct' }
    return JSON.stringify(rule, null, 2)
  }
  const lines = scope === 'apple'
    ? domains.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`)
    : processes.map((name) => `PROCESS-NAME,${name},DIRECT`)
  return client === 'clash' ? lines.map((line) => `- ${line}`).join('\n') : lines.join('\n')
}

/** 让 Apple 域名走国内 DNS 的配置片段；只配直连规则而 DNS 仍走海外时，Apple Music 照样连不上。 */
export function proxyDnsSnippet(client: ProxyClient): string {
  const domains = [...APPLE_DIRECT_DOMAINS]
  if (client === 'singbox') return JSON.stringify({ domain_suffix: domains, server: 'local' }, null, 2)
  if (client === 'surge') return domains.map((domain) => `*.${domain} = server:223.5.5.5`).join('\n')
  return [
    'dns:',
    '  nameserver-policy:',
    `    '${domains.map((domain) => `+.${domain}`).join(',')}':`,
    ...DOMESTIC_DNS.map((server) => `      - ${server}`),
  ].join('\n')
}

export function desktopPlatform(): DesktopPlatform {
  const platform = typeof window !== 'undefined' ? window.desktop?.platform : undefined
  if (platform === 'win32' || platform === 'linux') return platform
  return 'darwin'
}

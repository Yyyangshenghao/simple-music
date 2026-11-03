import { app, powerMonitor, session, type AuthInfo } from 'electron'
import { DEFAULT_PROXY_SETTINGS, electronProxyRules, parsePacResult, proxyCredentials, type ProxySettings, type SystemProxyAddresses } from '../../server/lib/proxy-config'

const APPLE_PARTITION = 'persist:simplemusic-apple-music'
// setProxy 只在单个会话上生效，不会从 defaultSession 继承；登录窗口与播放宿主各有独立分区。
const SHARED_PARTITIONS = [
  'persist:simplemusic-netease-login',
  'persist:simplemusic-qqmusic-login',
  'persist:simplemusic-playback-v1',
]
// 只用来读系统代理的内存分区：始终保持 system 模式，不受用户选的自定义代理影响。
const PROBE_PARTITION = 'simplemusic-proxy-probe'
// 分别代表两个出口：PAC/分流规则常让国内域名直连、海外域名走代理。
const PROBE_URLS: Record<keyof SystemProxyAddresses, string> = { default: 'https://music.163.com/', apple: 'https://music.apple.com/' }
const WATCH_INTERVAL_MS = 30_000
const FOCUS_THROTTLE_MS = 5_000
const AUTH_RETRY_WINDOW_MS = 10_000

let current: ProxySettings = { ...DEFAULT_PROXY_SETTINGS }
let probeReady: Promise<void> | null = null
let authRegistered = false

/**
 * 把代理规则同步到主窗口、登录窗口与 Apple Music 分区。
 * Apple Music 用独立出口：海外账号在国内节点下会被带回国内，触发地区与风控问题。
 */
export function applySessionProxy(settings: ProxySettings): Promise<void> {
  current = { ...settings }
  const base = electronProxyRules(settings)
  const apple = electronProxyRules(settings, 'apple')
  const pending = [session.defaultSession.setProxy(base)]
  for (const partition of SHARED_PARTITIONS) pending.push(session.fromPartition(partition).setProxy(base))
  pending.push(session.fromPartition(APPLE_PARTITION).setProxy(apple))
  return Promise.all(pending).then(() => {})
}

/** 按出口解析系统代理（含 PAC/自动配置）；空字符串表示该出口系统让它直连。 */
export async function resolveSystemProxy(): Promise<SystemProxyAddresses> {
  const probe = session.fromPartition(PROBE_PARTITION)
  probeReady ??= probe.setProxy({ mode: 'system' })
  await probeReady
  // 用户可能刚在代理软件里开关系统代理；强制重读，避免拿到 Chromium 缓存的旧配置。
  await probe.forceReloadProxyConfig()
  const [main, apple] = await Promise.all([probe.resolveProxy(PROBE_URLS.default), probe.resolveProxy(PROBE_URLS.apple)])
  return { default: parsePacResult(main), apple: parsePacResult(apple) }
}

/**
 * 盯住系统代理变化：定时、窗口获焦与唤醒后各重读一次，变了才回调。
 * Chromium 会话自己跟随系统，这里是为了让 Node 侧的数据请求同步切换。
 */
export function watchSystemProxy(onChange: (addresses: SystemProxyAddresses) => void): () => void {
  let last: string | null = null
  let lastRun = 0
  let running = false
  const refresh = async () => {
    if (running) return
    running = true
    lastRun = Date.now()
    try {
      const addresses = await resolveSystemProxy()
      const key = `${addresses.default}|${addresses.apple}`
      if (key !== last) {
        last = key
        onChange(addresses)
      }
    } catch { /* 读取失败保留上次结果 */ } finally {
      running = false
    }
  }
  const onFocus = () => { if (Date.now() - lastRun > FOCUS_THROTTLE_MS) void refresh() }
  const timer = setInterval(() => void refresh(), WATCH_INTERVAL_MS)
  timer.unref?.()
  app.on('browser-window-focus', onFocus)
  powerMonitor.on('resume', onFocus)
  void refresh()
  return () => {
    clearInterval(timer)
    app.off('browser-window-focus', onFocus)
    powerMonitor.off('resume', onFocus)
  }
}

/** 按 Chromium 的认证请求找对应的代理账号；只匹配用户自己填写的代理，不给任意服务器送凭据。 */
export function credentialsForProxy(settings: ProxySettings, host: string, port: number): { username: string; password: string } | null {
  for (const address of [settings.mode === 'custom' ? settings.url : '', settings.apple === 'custom' ? settings.appleUrl : '']) {
    const credentials = address ? proxyCredentials(address) : null
    if (credentials && credentials.host === host && credentials.port === port) return credentials
  }
  return null
}

/**
 * Chromium 的 proxyRules 不认地址里的账号密码，代理返回 407 时会触发 app 的 login 事件，这里补上认证。
 * 同一代理短时间内反复要求认证说明账号密码错误，不再重试，交给页面报错，避免死循环。
 */
export function registerProxyAuth(): void {
  if (authRegistered) return
  authRegistered = true
  const attempts = new Map<string, number[]>()
  app.on('login', (event, _webContents, _details, authInfo: AuthInfo, callback) => {
    if (!authInfo.isProxy) return
    const credentials = credentialsForProxy(current, authInfo.host, authInfo.port)
    if (!credentials) return
    const key = `${authInfo.host}:${authInfo.port}`
    const now = Date.now()
    const recent = (attempts.get(key) ?? []).filter((time) => now - time < AUTH_RETRY_WINDOW_MS)
    if (recent.length >= 3) return
    attempts.set(key, [...recent, now])
    event.preventDefault()
    callback(credentials.username, credentials.password)
  })
}

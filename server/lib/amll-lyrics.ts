import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafeUpstreamUrl } from './security'

/**
 * AMLL TTML DB（https://github.com/amll-dev/amll-ttml-db，CC0）逐字歌词兜底：
 * 文件按平台歌曲 ID 命名，网易取 YRC、QQ 取 QRC，与现有解析器格式一致。
 * 只在用户播放时按需拉取单曲，不打包歌词；结果（包括"库里没有"）缓存到磁盘，
 * 大多数歌不在库里，负缓存避免每次切歌重复请求。
 *
 * 线路：GitHub 官方 → 两个与仓库目录结构一致的社区镜像（国内可直连）。按顺序尝试，
 * 记住最近一次可用的线路下次优先；某条线路连不上就熔断一段时间，避免每首歌都等超时。
 */
export type AmllPlatform = 'ncm' | 'qq'

export interface AmllHost {
  id: string
  base: string
}

export const AMLL_HOSTS: readonly AmllHost[] = [
  { id: 'github', base: 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main' },
  { id: 'gbclstudio', base: 'https://amll-ttml-db.gbclstudio.cn' },
  { id: 'bikonoo', base: 'https://amlldb.bikonoo.com' }
]

const AMLL_FILES: Record<AmllPlatform, { dir: string; ext: string }> = {
  ncm: { dir: 'ncm-lyrics', ext: 'yrc' },
  qq: { dir: 'qq-lyrics', ext: 'qrc' }
}
const HOST_TIMEOUT_MS = 2500
const BREAKER_MS = 10 * 60 * 1000
const HIT_TTL_MS = 7 * 24 * 3600 * 1000
const MISS_TTL_MS = 6 * 3600 * 1000
const MAX_BYTES = 512 * 1024

export function isAmllPlatform(value: unknown): value is AmllPlatform {
  return value === 'ncm' || value === 'qq'
}

/** ID 只允许平台自身的字符集，拼进固定域名的固定目录，不接受任何路径片段。 */
export function isValidAmllId(platform: AmllPlatform, id: string): boolean {
  return platform === 'ncm' ? /^\d{1,20}$/.test(id) : /^(?:\d{1,20}|[0-9A-Za-z]{6,24})$/.test(id)
}

export function amllLyricUrl(platform: AmllPlatform, id: string, host: AmllHost = AMLL_HOSTS[0]): string {
  const { dir, ext } = AMLL_FILES[platform]
  return `${host.base}/${dir}/${id}.${ext}`
}

/** 线路状态：最近可用的线路与各线路的熔断截止时刻。导出 reset 供测试隔离。 */
const routeState = { preferred: AMLL_HOSTS[0].id, openUntil: new Map<string, number>() }

export function resetAmllRouteState(): void {
  routeState.preferred = AMLL_HOSTS[0].id
  routeState.openUntil.clear()
}

/** 当前线路状态：最近可用的线路与仍在熔断中的线路（已到期的不算）。 */
export function amllRouteSnapshot(now: number = Date.now()): { preferred: string; open: string[] } {
  return { preferred: routeState.preferred, open: [...routeState.openUntil].filter(([, until]) => until > now).map(([id]) => id) }
}

export function isAmllHostId(value: unknown): value is string {
  return typeof value === 'string' && AMLL_HOSTS.some((host) => host.id === value)
}

/**
 * 本次的尝试顺序：用户手动指定的线路最先，其次是最近可用的线路，其余按默认顺序；
 * 正在熔断的线路跳过（手动指定的也一样，连不上时照样回落到其他线路）。
 */
export function amllHostOrder(now: number, pinned?: string): AmllHost[] {
  const first = pinned && isAmllHostId(pinned) ? pinned : routeState.preferred
  const ordered = [
    ...AMLL_HOSTS.filter((host) => host.id === first),
    ...AMLL_HOSTS.filter((host) => host.id === routeState.preferred && host.id !== first),
    ...AMLL_HOSTS.filter((host) => host.id !== first && host.id !== routeState.preferred)
  ]
  return ordered.filter((host) => (routeState.openUntil.get(host.id) ?? 0) <= now)
}

interface CacheEntry {
  fetchedAt: number
  text: string | null
}

const inflight = new Map<string, Promise<string | null>>()

async function readCache(file: string, now: number): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
    if (typeof entry.fetchedAt !== 'number' || (entry.text !== null && typeof entry.text !== 'string')) return null
    const ttl = entry.text === null ? MISS_TTL_MS : HIT_TTL_MS
    return now - entry.fetchedAt < ttl ? entry : null
  } catch {
    return null
  }
}

/** 单条线路：200 返回原文，404 返回 null（库里没有），其余情况抛出（线路不可用）。 */
async function fetchFromHost(host: AmllHost, platform: AmllPlatform, id: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = amllLyricUrl(platform, id, host)
  if (!isSafeUpstreamUrl(url)) throw new Error('UNSAFE_UPSTREAM')
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(HOST_TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`UPSTREAM_${res.status}`)
  const body = await res.text()
  if (body.length > MAX_BYTES) throw new Error('TOO_LARGE')
  return body.trim() ? body : null
}

/**
 * 取一首歌的 AMLL 逐字歌词原文；库里没有返回 null。所有线路都不可用时抛出且不写缓存，
 * 下次播放再试（熔断期内直接抛出，不发请求）。
 */
export async function fetchAmllLyric(
  userDataDir: string,
  platform: AmllPlatform,
  id: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  pinned?: string
): Promise<string | null> {
  if (!isValidAmllId(platform, id)) throw new Error('INVALID_ID')
  const key = `${platform}-${id}`
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async () => {
    const dir = join(userDataDir, 'amll-lyrics')
    const file = join(dir, `${key}.json`)
    const cached = await readCache(file, now())
    if (cached) return cached.text
    const hosts = amllHostOrder(now(), pinned)
    if (!hosts.length) throw new Error('ALL_HOSTS_UNAVAILABLE')
    for (const host of hosts) {
      let text: string | null
      try {
        text = await fetchFromHost(host, platform, id, fetchImpl)
      } catch {
        routeState.openUntil.set(host.id, now() + BREAKER_MS)
        continue
      }
      routeState.openUntil.delete(host.id)
      routeState.preferred = host.id
      await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify({ fetchedAt: now(), text } satisfies CacheEntry))
      return text
    }
    throw new Error('ALL_HOSTS_UNAVAILABLE')
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

/** 测速用的探测 ID：库里不存在，线路只回一个 404，不下载任何歌词内容。 */
const PROBE_ID = '1'

export interface AmllHostLatency {
  id: string
  /** 往返毫秒；不可用时为 null */
  ms: number | null
}

/**
 * 逐条线路测速（并行），供设置页展示。404 / 200 都算可用；连不上或超时为 null。
 * 测速成功会解除该线路的熔断，失败不改变熔断状态（测速不应让正常线路被拉黑）。
 */
export async function probeAmllHosts(fetchImpl: typeof fetch = fetch, clock: () => number = () => performance.now()): Promise<AmllHostLatency[]> {
  return Promise.all(AMLL_HOSTS.map(async (host) => {
    const url = amllLyricUrl('ncm', PROBE_ID, host)
    if (!isSafeUpstreamUrl(url)) return { id: host.id, ms: null }
    const start = clock()
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(HOST_TIMEOUT_MS) })
      await res.arrayBuffer().catch(() => undefined)
      if (res.status !== 404 && !res.ok) return { id: host.id, ms: null }
      routeState.openUntil.delete(host.id)
      return { id: host.id, ms: Math.round(clock() - start) }
    } catch {
      return { id: host.id, ms: null }
    }
  }))
}


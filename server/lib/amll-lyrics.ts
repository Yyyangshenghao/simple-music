import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafeUpstreamUrl } from './security'

/**
 * AMLL TTML DB（https://github.com/amll-dev/amll-ttml-db，CC0）逐字歌词兜底：
 * 文件按平台歌曲 ID 命名，网易取 YRC、QQ 取 QRC，与现有解析器格式一致。
 * 只在用户播放时按需拉取单曲，不打包歌词；结果（包括"库里没有"）缓存到磁盘，
 * 大多数歌不在库里，负缓存避免每次切歌重复请求。
 */
export type AmllPlatform = 'ncm' | 'qq'

const AMLL_RAW_BASE = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main'
const AMLL_FILES: Record<AmllPlatform, { dir: string; ext: string }> = {
  ncm: { dir: 'ncm-lyrics', ext: 'yrc' },
  qq: { dir: 'qq-lyrics', ext: 'qrc' }
}
const FETCH_TIMEOUT_MS = 4000
const HIT_TTL_MS = 7 * 24 * 3600 * 1000
const MISS_TTL_MS = 6 * 3600 * 1000
const MAX_BYTES = 512 * 1024

export function isAmllPlatform(value: unknown): value is AmllPlatform {
  return value === 'ncm' || value === 'qq'
}

/** ID 只允许平台自身的字符集，拼进固定域名的固定目录，不接受任何路径片段。 */
export function isValidAmllId(platform: AmllPlatform, id: string): boolean {
  return platform === 'ncm' ? /^\d{1,20}$/.test(id) : /^[0-9A-Za-z]{6,24}$/.test(id)
}

export function amllLyricUrl(platform: AmllPlatform, id: string): string {
  const { dir, ext } = AMLL_FILES[platform]
  return `${AMLL_RAW_BASE}/${dir}/${id}.${ext}`
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

/**
 * 取一首歌的 AMLL 逐字歌词原文；库里没有返回 null。网络错误或非 404 的失败会抛出且不写缓存，
 * 下次播放再试。
 */
export async function fetchAmllLyric(
  userDataDir: string,
  platform: AmllPlatform,
  id: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
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
    const url = amllLyricUrl(platform, id)
    if (!isSafeUpstreamUrl(url)) throw new Error('UNSAFE_UPSTREAM')
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    let text: string | null
    if (res.status === 404) {
      text = null
    } else if (res.ok) {
      const body = await res.text()
      if (body.length > MAX_BYTES) throw new Error('TOO_LARGE')
      text = body.trim() ? body : null
    } else {
      throw new Error(`UPSTREAM_${res.status}`)
    }
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: now(), text } satisfies CacheEntry))
    return text
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

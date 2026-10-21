import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { isSafeUpstreamUrl } from './security'

/**
 * 酷狗逐字歌词（KRC）兜底：按"歌手 - 歌名 + 时长"在酷狗歌词库搜索，再下载并解密 KRC。
 * 接口与签名、解密方式参考 LDDC（https://github.com/chenmozhijin/LDDC，GPL-3.0）。
 * 只用歌词搜索与下载两个接口，不需要登录、设备注册或酷狗歌曲 hash。
 * 匹配是否可靠由渲染层用同曲规则判定；这里只按时长粗筛并返回候选原文。
 * 结果（包括"没找到"）缓存到磁盘；上游连不上时熔断一段时间，避免每首歌都等超时。
 */
const SEARCH_URL = 'https://lyrics.kugou.com/v1/search'
const DOWNLOAD_URL = 'https://lyrics.kugou.com/download'
const SIGN_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
const KRC_KEY = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])
const REQUEST_TIMEOUT_MS = 2500
const BREAKER_MS = 10 * 60 * 1000
const HIT_TTL_MS = 7 * 24 * 3600 * 1000
const MISS_TTL_MS = 6 * 3600 * 1000
const MAX_BYTES = 512 * 1024
const MAX_TEXT_LENGTH = 200
const MAX_CANDIDATES = 2
const DURATION_TOLERANCE_MS = 3000

export interface KugouLyricQuery {
  title: string
  artist: string
  /** 毫秒 */
  duration: number
}

export interface KugouLyricCandidate {
  /** KRC [ti:] 标签优先（带版本信息，如 Taylor's Version），缺失时用搜索结果的歌名 */
  title: string
  artist: string
  duration: number
  text: string
}

/** 标题、歌手只作搜索关键词；限制长度与控制字符，时长必须是合理的毫秒数。 */
export function parseKugouLyricQuery(params: URLSearchParams): KugouLyricQuery | null {
  const clean = (value: string | null) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  const title = clean(params.get('title'))
  const artist = clean(params.get('artist'))
  const duration = Number(params.get('duration'))
  if (!title || title.length > MAX_TEXT_LENGTH || artist.length > MAX_TEXT_LENGTH) return null
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 3_600_000) return null
  return { title, artist, duration }
}

/** 酷狗客户端签名：盐值 + 按键排序的 k=v 串 + 盐值，取 md5。 */
export function kugouSignature(params: Record<string, string>): string {
  const body = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('')
  return createHash('md5').update(`${SIGN_SALT}${body}${SIGN_SALT}`).digest('hex')
}

/** KRC 密文：去掉 4 字节文件头，按 16 字节密钥循环异或后 zlib 解压。 */
export function decryptKrc(content: Buffer): string {
  if (content.length <= 4) throw new Error('KRC_EMPTY')
  const body = Buffer.from(content.subarray(4))
  for (let i = 0; i < body.length; i++) body[i] ^= KRC_KEY[i % KRC_KEY.length]
  const text = inflateSync(body, { maxOutputLength: MAX_BYTES * 4 }).toString('utf8')
  if (text.length > MAX_BYTES * 2) throw new Error('TOO_LARGE')
  return text
}

const breaker = { openUntil: 0 }

export function resetKugouLyricState(): void {
  breaker.openUntil = 0
}

async function kugouRequest(url: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const signed = { appid: '3116', clientver: '11070', ...params }
  const target = `${url}?${new URLSearchParams({ ...signed, signature: kugouSignature(signed) })}`
  if (!isSafeUpstreamUrl(target)) throw new Error('UNSAFE_UPSTREAM')
  const res = await fetchImpl(target, {
    headers: { 'User-Agent': 'Android14-1070-11070-201-0-Lyric-wifi', 'KG-Rec': '1', 'KG-RC': '1' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`UPSTREAM_${res.status}`)
  const body = await res.text()
  if (body.length > MAX_BYTES * 2) throw new Error('TOO_LARGE')
  const json = JSON.parse(body) as unknown
  if (!json || typeof json !== 'object') throw new Error('BAD_RESPONSE')
  return json as Record<string, unknown>
}

function krcTag(text: string, name: string): string {
  const match = text.match(new RegExp(`^\\[${name}:([^\\]\\r\\n]*)\\]`, 'm'))
  return match ? match[1].trim() : ''
}

async function searchAndDownload(query: KugouLyricQuery, fetchImpl: typeof fetch): Promise<KugouLyricCandidate[]> {
  const search = await kugouRequest(SEARCH_URL, {
    keyword: query.artist ? `${query.artist} - ${query.title}` : query.title,
    duration: String(query.duration),
    lrctxt: '1',
    man: 'no',
  }, fetchImpl)
  // 没收录时上游返回 status 404 与空候选，按"没找到"处理。
  const list = Array.isArray(search.candidates) ? search.candidates as Record<string, unknown>[] : []
  const picked = list
    .filter((item) => typeof item.id === 'string' || typeof item.id === 'number')
    .filter((item) => typeof item.accesskey === 'string' && /^[0-9A-Za-z]{1,64}$/.test(item.accesskey))
    .filter((item) => Math.abs(Number(item.duration) - query.duration) <= DURATION_TOLERANCE_MS)
    .slice(0, MAX_CANDIDATES)
  const candidates: KugouLyricCandidate[] = []
  let failure: unknown = null
  for (const item of picked) {
    const id = String(item.id)
    if (!/^\d{1,20}$/.test(id)) continue
    let data: Record<string, unknown>
    try {
      data = await kugouRequest(DOWNLOAD_URL, {
        accesskey: String(item.accesskey), charset: 'utf8', client: 'mobi', fmt: 'krc', id, ver: '1',
      }, fetchImpl)
    } catch (err) {
      failure = err
      continue
    }
    // contenttype 2 是纯文本逐行歌词，没有逐字时序，对补全无用。
    if (Number(data.contenttype) === 2 || typeof data.content !== 'string' || !data.content) continue
    let text: string
    try { text = decryptKrc(Buffer.from(data.content, 'base64')) } catch { continue }
    if (!/^\[\d+,\d+\]/m.test(text)) continue
    candidates.push({
      title: krcTag(text, 'ti') || String(item.song ?? ''),
      artist: krcTag(text, 'ar') || String(item.singer ?? ''),
      duration: Number(item.duration),
      text,
    })
  }
  // 候选都下载失败时视为上游不可用，不能把"没找到"写进缓存。
  if (!candidates.length && failure) throw failure
  return candidates
}

interface CacheEntry {
  fetchedAt: number
  candidates: KugouLyricCandidate[]
}

async function readCache(file: string, now: number): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
    if (typeof entry.fetchedAt !== 'number' || !Array.isArray(entry.candidates)) return null
    const ttl = entry.candidates.length ? HIT_TTL_MS : MISS_TTL_MS
    return now - entry.fetchedAt < ttl ? entry : null
  } catch {
    return null
  }
}

const inflight = new Map<string, Promise<KugouLyricCandidate[]>>()

/**
 * 取酷狗逐字歌词候选；没收录返回空数组。上游不可用时抛出且不写缓存，
 * 熔断期内直接抛出不发请求。
 */
export async function fetchKugouLyric(
  userDataDir: string,
  query: KugouLyricQuery,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<KugouLyricCandidate[]> {
  // 时长取整到秒，同一首歌不同平台的毫秒差不会各占一份缓存。
  const key = createHash('sha1').update(JSON.stringify([query.title, query.artist, Math.round(query.duration / 1000)])).digest('hex')
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async () => {
    const dir = join(userDataDir, 'kugou-lyrics')
    const file = join(dir, `${key}.json`)
    const cached = await readCache(file, now())
    if (cached) return cached.candidates
    if (breaker.openUntil > now()) throw new Error('UPSTREAM_UNAVAILABLE')
    let candidates: KugouLyricCandidate[]
    try {
      candidates = await searchAndDownload(query, fetchImpl)
    } catch (err) {
      breaker.openUntil = now() + BREAKER_MS
      throw err
    }
    breaker.openUntil = 0
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: now(), candidates } satisfies CacheEntry))
    return candidates
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

import { isSafeUpstreamUrl } from './security'

/**
 * 哔哩哔哩视频音频流，只作跨源兜底：网易云/QQ 放不了时按「歌名 歌手」在音乐区搜同一首歌。
 * 只用网页端公开的游客接口：finger/spi 取 buvid3 作 Cookie，search/type 搜音乐区视频，
 * 旧版 x/player/playurl（fnval=16）取 DASH 音频。不签名、不登录，不请求大会员档位（Hi-Res/杜比）。
 * 搜索与 cid 查询、playurl 参考 MusicFreePlugins 的 bilibili 插件（GPL-3.0，仅参考接口形态）。
 * 风控（-412/-352、只回 v_voucher）时熔断一段时间，不反复重试。
 */
const API = 'https://api.bilibili.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
export const BILIBILI_REFERER = 'https://www.bilibili.com/'
const REQUEST_TIMEOUT_MS = 6000
const BREAKER_MS = 10 * 60 * 1000
const SEARCH_TTL_MS = 10 * 60 * 1000
const PLAY_URL_MARGIN_MS = 10 * 60 * 1000
const MAX_CACHE = 200
const MAX_KEYWORD_LENGTH = 200
/** 音乐区（tids=3）里不是原曲录音的分区：翻唱、演奏、现场、教学、乐评。 */
const EXCLUDED_ZONES = new Set(['翻唱', '演奏', '音乐现场', '音乐教学', '乐评盘点'])
/**
 * 标题里任何位置（含【】标签）出现这些词就不是原曲录音：翻唱、伴奏、现场、改编、变速、剪辑合集等。
 * 版本词常写在书名号外（「【史诗版】《夜曲》cover」），只看拆出的歌名会漏掉，宁可不匹配。
 * AI 只放行画面类（AI-MV、AI 修复），「AI 某歌手」多是合成翻唱。
 */
const NOT_ORIGINAL = /\bcover\b|翻唱|翻自|伴奏|\binst(?:rumental)?\b|\bkaraoke\b|\boff ?vocal\b|纯音乐|\blive\b|现场|演唱会|\bremix\b|\bdj\b|混音|钢琴|吉他|古筝|二胡|笛子|口琴|八音盒|改编|史诗版|交响|[男女]声(?:完整)?版|童声|加速|减速|倍速|降调|升调|片段|教学|教程|鼓谱|乱剪|串烧|合集|循环|\d+\s*(?:小时|分钟)|\bai\b(?!\s*-?\s*(?:mv|修复|超分|画质|4k|8k|高清))/iu

export interface BilibiliArtist {
  id: null
  name: string
}

export interface BilibiliTrack {
  provider: 'bilibili'
  source: 'bilibili'
  type: 'song'
  /** bvid；同一视频按标题拆出多种「歌名/歌手」读法时 id 相同。 */
  id: string
  name: string
  artist: string
  artists: BilibiliArtist[]
  album: string
  cover: string
  /** 毫秒 */
  duration: number
  bvid: string
  uploader: string
  /** 原视频标题，供界面说明来源。 */
  videoTitle: string
}

export interface BilibiliAudioCandidate {
  url: string
  level: 'exhigh' | 'higher' | 'standard'
  quality: string
  br: number
}

export interface BilibiliPlayInfo {
  candidates: BilibiliAudioCandidate[]
  /** 地址失效时间（毫秒时间戳），已扣掉余量。 */
  expiresAt: number
}

/** 游客可得的 DASH 音频档：30280≈192K、30232≈132K、30216≈64K。 */
const AUDIO_LEVELS: Record<number, { level: BilibiliAudioCandidate['level']; quality: string; br: number }> = {
  30280: { level: 'exhigh', quality: '192K', br: 192000 },
  30232: { level: 'higher', quality: '132K', br: 132000 },
  30216: { level: 'standard', quality: '64K', br: 64000 },
}

export class BilibiliRiskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BilibiliRiskError'
  }
}

const state = {
  breakerUntil: 0,
  buvid: '' as string,
  buvidPending: null as Promise<string> | null,
}
const searchCache = new Map<string, { tracks: BilibiliTrack[]; expiresAt: number }>()
const cidCache = new Map<string, number>()
const playCache = new Map<string, BilibiliPlayInfo>()

export function resetBilibiliState(): void {
  state.breakerUntil = 0
  state.buvid = ''
  state.buvidPending = null
  searchCache.clear()
  cidCache.clear()
  playCache.clear()
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_CACHE) map.delete(map.keys().next().value as K)
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function trip(message: string): never {
  state.breakerUntil = Date.now() + BREAKER_MS
  throw new BilibiliRiskError(message)
}

async function requestJson(path: string, params: Record<string, string>, fetchImpl: typeof fetch, cookie = ''): Promise<Record<string, unknown>> {
  if (state.breakerUntil > Date.now()) throw new BilibiliRiskError('BILIBILI_BREAKER_OPEN')
  const target = `${API}${path}?${new URLSearchParams(params)}`
  if (!isSafeUpstreamUrl(target)) throw new Error('UNSAFE_UPSTREAM')
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: BILIBILI_REFERER }
  if (cookie) headers.Cookie = cookie
  const res = await fetchImpl(target, { headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (res.status === 412) trip('BILIBILI_RISK_412')
  if (!res.ok) throw new Error(`BILIBILI_HTTP_${res.status}`)
  const body = asObj(await res.json())
  const code = Number(body.code)
  if (code === -412 || code === -352) trip(`BILIBILI_RISK_${code}`)
  if (code !== 0) throw new Error(`BILIBILI_CODE_${code}:${String(body.message ?? '')}`)
  return asObj(body.data)
}

/** 游客 buvid3：B 站搜索与播放接口按它识别设备，缺失时更容易触发风控。 */
async function guestCookie(fetchImpl: typeof fetch): Promise<string> {
  if (!state.buvid) {
    state.buvidPending ??= requestJson('/x/frontend/finger/spi', {}, fetchImpl)
      .then((data) => String(data.b_3 ?? ''))
      .finally(() => { state.buvidPending = null })
    state.buvid = await state.buvidPending
  }
  return state.buvid ? `buvid3=${state.buvid}` : ''
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/** "4:30" / "1:04:30" → 毫秒；无法解析时为 0。 */
export function parseDuration(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0
  const parts = String(value ?? '').split(':').map(Number)
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0
  return parts.reduce((sum, part) => sum * 60 + part, 0) * 1000
}

/** 画质、音质、上传形式等宣传词：不属于歌名或歌手。 */
const TITLE_NOISE = [
  /\bhi-?res\b|\bdolby\b|\bflac\b|\b(?:4k|8k)\b|\b\d{3,4}p\b|\b60\s?(?:fps|帧)\b|\bhd\b|\bhq\b|\bsq\b/giu,
  /\b(?:official\s+)?(?:music\s+video|mv|pv|lyrics?\s+video|audio|video)\b/giu,
  /无损(?:音质)?|高音质|高品质|高清|超清|蓝光|音质|杜比|全景声|母带|录音棚|百万级|试听|修复版?|官方|完整版|动态歌词|歌词版?|中日字幕|中英字幕|中字|字幕/gu,
]

function cleanSegment(text: string): string {
  const cleaned = TITLE_NOISE.reduce((value, pattern) => value.replace(pattern, ' '), text)
  return cleaned
    .replace(/[“”"‘’'|｜丨·•~～!！]+/gu, ' ')
    .replace(/[\s,，、:：]+$/u, '')
    .replace(/^[\s,，、:：]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface TitleReading {
  name: string
  artists: string[]
}

/**
 * 视频标题 → 若干种「歌名 + 歌手」读法。B 站标题没有固定格式，常见写法：
 * 「【Hi-Res】《晴天》- 周杰伦」「周杰伦 - 晴天MV」「米津玄師「Lemon」」。
 * 有书名号/直角引号时只取其中的歌名；否则按分隔符拆段，每段都试作歌名，其余段与 UP 主作歌手。
 * 是否同一首交给渲染层同曲评分（标题、歌手、时长±3秒）判定，读法错了只会不匹配。
 */
export function readingsFromTitle(rawTitle: string, uploader: string): TitleReading[] {
  let title = decodeEntities(rawTitle.replace(/<[^>]+>/g, '')).normalize('NFKC')
  const withoutTags = title.replace(/【[^】]*】|\[[^\]]*\]/gu, ' ')
  if (withoutTags.trim()) title = withoutTags
  title = title.replace(/[“"‘'][^”"’']{6,}[”"’']/gu, ' ')
  title = TITLE_NOISE.reduce((value, pattern) => value.replace(pattern, ' '), title)
  const owner = cleanSegment(uploader)
  const quoted = /《([^》]+)》/u.exec(title) ?? /「([^」]+)」/u.exec(title) ?? /『([^』]+)』/u.exec(title)
  if (quoted) {
    const name = cleanSegment(quoted[1])
    // 歌名之外的引号多是歌词摘句，不当作歌手。
    const rest = title.replace(quoted[0], ' - ').replace(/「[^」]*」|『[^』]*』/gu, ' ')
    const artists = splitSegments(rest)
    return name ? [{ name, artists: unique([...artists, owner]) }] : []
  }
  const segments = splitSegments(title)
  if (segments.length <= 1) return segments[0] ? [{ name: segments[0], artists: unique([owner]) }] : []
  return segments.slice(0, 3).map((name, index) => ({
    name,
    artists: unique([...segments.filter((_, other) => other !== index), owner]),
  }))
}

function splitSegments(text: string): string[] {
  return text
    // 英文名里的连字符（Jay-Z）不拆；紧挨中日韩文字的 - 才当分隔符。
    .split(/\s+[-–—/]+\s+|[–—]+|\s*[|｜丨]\s*|(?<=[^\x00-\x7f])-|-(?=[^\x00-\x7f])|\s+-|-\s+/u)
    .map(cleanSegment)
    .filter((segment) => segment && [...segment].length <= 40)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function coverUrl(value: unknown): string {
  const text = String(value ?? '')
  if (!text) return ''
  return text.startsWith('//') ? `https:${text}` : text.replace(/^http:/, 'https:')
}

export function mapSearchVideo(item: unknown): BilibiliTrack[] {
  const video = asObj(item)
  const bvid = String(video.bvid ?? '')
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return []
  if (EXCLUDED_ZONES.has(String(video.typename ?? ''))) return []
  const duration = parseDuration(video.duration)
  const uploader = String(video.author ?? '')
  const videoTitle = decodeEntities(String(video.title ?? '').replace(/<[^>]+>/g, ''))
  // 歌词摘句里的字（如「现场」）不算版本标记。
  const versionText = videoTitle.normalize('NFKC').replace(/「[^」]*」|『[^』]*』|[“"‘'][^”"’']{6,}[”"’']/gu, ' ')
  if (NOT_ORIGINAL.test(versionText)) return []
  return readingsFromTitle(String(video.title ?? ''), uploader).map((reading) => ({
    provider: 'bilibili',
    source: 'bilibili',
    type: 'song',
    id: bvid,
    name: reading.name,
    artist: reading.artists.join(' / '),
    artists: reading.artists.map((name) => ({ id: null, name })),
    album: '',
    cover: coverUrl(video.pic),
    duration,
    bvid,
    uploader,
    videoTitle,
  }))
}

export function parseBilibiliKeyword(value: string | null): string | null {
  const keyword = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return keyword && keyword.length <= MAX_KEYWORD_LENGTH ? keyword : null
}

export function isBvid(value: string | null): value is string {
  return !!value && /^BV[0-9A-Za-z]{10}$/.test(value)
}

/** 在音乐区按综合排序搜视频，第一页 20 条已够同曲匹配用。 */
export async function searchBilibiliTracks(keyword: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<BilibiliTrack[]> {
  const hit = searchCache.get(keyword)
  if (hit && hit.expiresAt > now) return hit.tracks
  const cookie = await guestCookie(fetchImpl)
  const data = await requestJson('/x/web-interface/search/type', {
    search_type: 'video',
    keyword,
    tids: '3',
    page: '1',
  }, fetchImpl, cookie)
  const tracks = (Array.isArray(data.result) ? data.result : []).flatMap(mapSearchVideo)
  remember(searchCache, keyword, { tracks, expiresAt: now + SEARCH_TTL_MS })
  return tracks
}

async function cidOf(bvid: string, fetchImpl: typeof fetch, cookie: string): Promise<number> {
  const cached = cidCache.get(bvid)
  if (cached) return cached
  const data = await requestJson('/x/web-interface/view', { bvid }, fetchImpl, cookie)
  const cid = Number(data.cid ?? asObj((data.pages as unknown[] | undefined)?.[0]).cid)
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error('BILIBILI_NO_CID')
  remember(cidCache, bvid, cid)
  return cid
}

/** 主站 upos/cn 节点优先；mcdn 与第三方 PCDN 节点不稳定，放最后。 */
function hostRank(url: string): number {
  try {
    const host = new URL(url).hostname
    if (host.endsWith('.mcdn.bilivideo.cn')) return 2
    return host.endsWith('.bilivideo.com') ? 0 : 3
  } catch {
    return 9
  }
}

export function mapPlayUrl(data: Record<string, unknown>, now = Date.now()): BilibiliPlayInfo {
  const dash = asObj(data.dash)
  const audios = Array.isArray(dash.audio) ? dash.audio.map(asObj) : []
  if (!audios.length) {
    if (data.v_voucher) trip('BILIBILI_RISK_VOUCHER')
    throw new Error('BILIBILI_NO_AUDIO')
  }
  const candidates: BilibiliAudioCandidate[] = []
  let deadline = Infinity
  const ordered = audios
    .filter((audio) => AUDIO_LEVELS[Number(audio.id)])
    .sort((a, b) => AUDIO_LEVELS[Number(b.id)].br - AUDIO_LEVELS[Number(a.id)].br)
  for (const audio of ordered) {
    const level = AUDIO_LEVELS[Number(audio.id)]
    const urls = [audio.baseUrl ?? audio.base_url, ...(Array.isArray(audio.backupUrl ?? audio.backup_url) ? (audio.backupUrl ?? audio.backup_url) as unknown[] : [])]
      .map((value) => String(value ?? ''))
      .filter((url) => url && isSafeUpstreamUrl(url))
    for (const url of [...new Set(urls)].sort((a, b) => hostRank(a) - hostRank(b))) {
      const seconds = Number(new URL(url).searchParams.get('deadline'))
      if (Number.isFinite(seconds) && seconds > 0) deadline = Math.min(deadline, seconds * 1000)
      candidates.push({ url, ...level })
    }
  }
  if (!candidates.length) throw new Error('BILIBILI_NO_AUDIO')
  const expiresAt = Number.isFinite(deadline) ? deadline - PLAY_URL_MARGIN_MS : now + 60 * 60 * 1000
  return { candidates, expiresAt }
}

export async function getBilibiliPlayInfo(bvid: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<BilibiliPlayInfo> {
  const cached = playCache.get(bvid)
  if (cached && cached.expiresAt > now) return cached
  const cookie = await guestCookie(fetchImpl)
  const cid = await cidOf(bvid, fetchImpl, cookie)
  const data = await requestJson('/x/player/playurl', { bvid, cid: String(cid), fnval: '16', fnver: '0' }, fetchImpl, cookie)
  const info = mapPlayUrl(data, now)
  remember(playCache, bvid, info)
  return info
}

/** 音频 CDN 校验 Referer：主站 upos/cn 节点与 PCDN 不带 B 站 Referer 返回 403。 */
export function isBilibiliMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host.endsWith('.bilivideo.com') || host.endsWith('.bilivideo.cn') || host.endsWith('.mountaintoys.cn') || host.endsWith('.hdslb.com')
}

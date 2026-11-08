import { fetchSafeUpstream } from './upstream-fetch'

/**
 * 汽水音乐（字节跳动）游客接口：只用网页端公开接口（与 www.qishui.com 网页相同），
 * 不登录、不注册设备、不做 X-Bogus/a_bogus 等应用签名。
 * - 搜索与歌单：api.qishui.com/luna 的 web 参数集
 * - 单曲详情、明文逐字歌词与播放信息：beta-luna.douyin.com 的 seo_track
 * - 专辑与歌手：www.qishui.com 分享页服务端渲染数据（_ROUTER_DATA）
 * 会员曲目网页只给 60 秒试听，如实标记 trial；不请求需应用签名的整曲接口，也不解密加密音频。
 * 接口形态参考 guohuiyuan/music-lib（AGPL-3.0，只参考不移植代码）。
 */
const API_BASE = 'https://api.qishui.com/luna'
const SEO_TRACK_URL = 'https://beta-luna.douyin.com/luna/h5/seo_track'
const SHARE_BASE = 'https://www.qishui.com/share'
const WEB_PARAMS = { aid: '386088', device_platform: 'web', channel: 'pc_web' }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
/** 只请求这些固定上游；播放信息地址由上游返回，同样要求落在汽水自己的点播域名。 */
const ALLOWED_HOSTS = new Set(['api.qishui.com', 'beta-luna.douyin.com', 'www.qishui.com', 'vod-luna.douyin.com'])
const REQUEST_TIMEOUT_MS = 8000
const MAX_BYTES = 4 * 1024 * 1024
const DETAIL_TTL_MS = 10 * 60 * 1000
const DETAIL_CACHE_LIMIT = 100
const MAX_PLAYLIST_PAGES = 20
const ID_PATTERN = /^\d{1,24}$/

export type QishuiFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>

const defaultFetch: QishuiFetch = (url, init) => fetchSafeUpstream(url, init)

export function isQishuiId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

async function qishuiText(url: string, fetchImpl: QishuiFetch): Promise<string> {
  const host = new URL(url).hostname
  if (!ALLOWED_HOSTS.has(host)) throw new Error('UNSAFE_UPSTREAM')
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json, text/html' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`QISHUI_HTTP_${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error('QISHUI_TOO_LARGE')
  return text
}

async function qishuiJson(url: string, fetchImpl: QishuiFetch): Promise<Record<string, any>> {
  const text = await qishuiText(url, fetchImpl)
  const data = JSON.parse(text) as Record<string, any>
  // 业务错误放在 status_info / status_code 中，HTTP 仍是 200。
  const code = data.status_code ?? data.status_info?.status_code
  if (code !== undefined && code !== 0) throw new Error(`QISHUI_API_${code}`)
  return data
}

function apiUrl(path: string, params: Record<string, string>): string {
  return `${API_BASE}${path}?${new URLSearchParams({ ...params, ...WEB_PARAMS })}`
}

// ---------- 字段映射 ----------

interface QishuiImage { uri?: string; urls?: string[]; template_prefix?: string }

/** 按上游提供的模板缩图，旧数据缺少模板时沿用 c5。 */
export function qishuiImageUrl(img: QishuiImage | undefined, size = 300): string {
  const uri = img?.uri
  const base = img?.urls?.find(item => typeof item === 'string' && item.startsWith('https://'))
  if (!uri || !base) return ''
  const template = img.template_prefix
  if (typeof template === 'string' && /^tplv-[a-z0-9]+$/.test(template)) {
    return `${base}${uri}~${template}-resize:${size}:${size}.image`
  }
  return `${base}${uri}~c5_${size}x${size}.jpg`
}

function artistList(raw: unknown): Array<{ id: string; name: string }> {
  return (Array.isArray(raw) ? raw : [])
    .map((item: any) => ({ id: String(item?.id ?? ''), name: String(item?.simple_display_name || item?.name || '').trim() }))
    .filter(item => item.name)
}

/** 会员整曲：网页只返回 60 秒试听。 */
function vipOnly(track: any): boolean {
  return track?.label_info?.only_vip_playable === true
}

export function mapQishuiTrack(track: any): Record<string, unknown> | null {
  const id = String(track?.id ?? '')
  const name = String(track?.name ?? '').trim()
  if (!isQishuiId(id) || !name) return null
  const artists = artistList(track.artists)
  const duration = Number(track.duration)
  return {
    provider: 'qishui',
    source: 'qishui',
    type: 'qishui',
    id,
    name,
    artist: artists.map(item => item.name).join(' / '),
    artists,
    artistId: artists[0]?.id,
    album: String(track.album?.name ?? ''),
    albumId: track.album?.id ? String(track.album.id) : undefined,
    cover: qishuiImageUrl(track.album?.url_cover) || undefined,
    // 汽水的 duration 已是毫秒，与 Track.duration 约定一致。
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    vipOnly: vipOnly(track),
  }
}

function mapTracks(list: unknown[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const raw of list) {
    const track = mapQishuiTrack(raw)
    if (!track || seen.has(track.id as string)) continue
    seen.add(track.id as string)
    out.push(track)
  }
  return out
}

function mapPlaylist(raw: any): Record<string, unknown> | null {
  const id = String(raw?.id ?? '')
  if (!isQishuiId(id)) return null
  return {
    provider: 'qishui', source: 'qishui', type: 'playlist', id,
    name: String(raw.title ?? raw.public_title ?? ''),
    cover: qishuiImageUrl(raw.url_cover),
    trackCount: Number(raw.count_tracks) || 0,
    playCount: 0,
    creator: String(raw.owner?.nickname ?? ''),
    description: typeof raw.desc === 'string' ? raw.desc : undefined,
  }
}

function mapAlbum(raw: any): Record<string, unknown> | null {
  const id = String(raw?.id ?? '')
  if (!isQishuiId(id)) return null
  const artists = artistList(raw.artists)
  const releaseDate = Number(raw.release_date)
  return {
    provider: 'qishui', source: 'qishui', type: 'album', id,
    name: String(raw.name ?? ''),
    cover: qishuiImageUrl(raw.url_cover),
    trackCount: Number(raw.count_tracks) || 0,
    playCount: 0,
    creator: artists.map(item => item.name).join(' / '),
    artistId: artists[0]?.id,
    publishTime: Number.isFinite(releaseDate) && releaseDate > 0 ? releaseDate * 1000 : undefined,
    description: Array.isArray(raw.pclines) ? raw.pclines.filter((line: unknown) => typeof line === 'string').join('\n') : undefined,
  }
}

function mapArtist(raw: any): Record<string, unknown> | null {
  const id = String(raw?.id ?? '')
  if (!isQishuiId(id)) return null
  return {
    id,
    name: String(raw.simple_display_name || raw.name || ''),
    avatar: qishuiImageUrl(raw.url_avatar),
    description: typeof raw.artist_profile?.intro === 'string' ? raw.artist_profile.intro : undefined,
    songNum: Number(raw.count_tracks) || undefined,
    musicSize: Number(raw.count_tracks) || undefined,
    source: 'qishui',
  }
}

// ---------- 搜索 ----------

type SearchType = 'track' | 'album' | 'playlist' | 'artist'

async function searchEntities(type: SearchType, keyword: string, limit: number, fetchImpl: QishuiFetch): Promise<any[]> {
  const data = await qishuiJson(apiUrl(`/search/${type}`, { q: keyword, cursor: '0', count: String(limit) }), fetchImpl)
  const groups = Array.isArray(data.result_groups) ? data.result_groups : []
  return groups.flatMap((group: any) => (Array.isArray(group?.data) ? group.data : []))
    .map((item: any) => item?.entity?.[type])
    .filter(Boolean)
    // 上游忽略 count，固定按页返回 20 条。
    .slice(0, limit)
}

export async function searchQishuiTracks(keyword: string, limit = 20, fetchImpl = defaultFetch) {
  return mapTracks(await searchEntities('track', keyword, limit, fetchImpl))
}

export async function searchQishuiAlbums(keyword: string, limit = 20, fetchImpl = defaultFetch) {
  return (await searchEntities('album', keyword, limit, fetchImpl)).map(mapAlbum).filter(Boolean)
}

export async function searchQishuiPlaylists(keyword: string, limit = 20, fetchImpl = defaultFetch) {
  return (await searchEntities('playlist', keyword, limit, fetchImpl)).map(mapPlaylist).filter(Boolean)
}

export async function searchQishuiArtists(keyword: string, limit = 5, fetchImpl = defaultFetch) {
  return (await searchEntities('artist', keyword, limit, fetchImpl)).map(mapArtist).filter(Boolean)
}

// ---------- 单曲详情（歌词 + 播放信息） ----------

interface QishuiTrackDetail {
  track: Record<string, unknown> | null
  lyric: string
  playerInfoUrl: string
}

const detailCache = new Map<string, { value: QishuiTrackDetail; expiresAt: number }>()
// 歌手页的详情、歌曲、专辑三个端点读同一张分享页，短期复用避免重复抓取。
const pageCache = new Map<string, { value: Record<string, any>; expiresAt: number }>()

export function resetQishuiState(): void {
  detailCache.clear()
  pageCache.clear()
}

function remember<T>(cache: Map<string, { value: T; expiresAt: number }>, key: string, value: T, now: number): void {
  cache.delete(key)
  cache.set(key, { value, expiresAt: now + DETAIL_TTL_MS })
  if (cache.size > DETAIL_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

export async function fetchQishuiTrackDetail(id: string, fetchImpl = defaultFetch, now = Date.now): Promise<QishuiTrackDetail> {
  if (!isQishuiId(id)) throw new Error('INVALID_ID')
  const hit = detailCache.get(id)
  if (hit && hit.expiresAt > now()) return hit.value
  const data = await qishuiJson(`${SEO_TRACK_URL}?${new URLSearchParams({ track_id: id, device_platform: 'web' })}`, fetchImpl)
  const lyric = data.seo_track?.lyric?.content ?? data.lyric?.content
  const value: QishuiTrackDetail = {
    track: mapQishuiTrack(data.seo_track?.track),
    lyric: typeof lyric === 'string' ? lyric : '',
    playerInfoUrl: typeof data.track_player?.url_player_info === 'string' ? data.track_player.url_player_info : '',
  }
  remember(detailCache, id, value, now())
  return value
}

/** 汽水档位：medium≈64k、higher≈128k、highest≈256k AAC；无损/Hi-Res/空间音频网页不返回（需会员）。 */
const QUALITY_LEVELS = [
  { upstream: 'highest', level: 'exhigh', label: '256k AAC', rank: 3 },
  { upstream: 'higher', level: 'higher', label: '128k AAC', rank: 2 },
  { upstream: 'medium', level: 'standard', label: '64k AAC', rank: 1 },
] as const

const REQUEST_RANK: Record<string, number> = { standard: 1, higher: 2, aac: 2 }

export interface QishuiStream {
  url: string
  level: string
  label: string
  br: number
  trial: boolean
}

/** 读取全部可用档位，按音质从高到低排列。 */
export async function fetchQishuiStreams(id: string, fetchImpl = defaultFetch, now = Date.now): Promise<QishuiStream[]> {
  const detail = await fetchQishuiTrackDetail(id, fetchImpl, now)
  if (!detail.playerInfoUrl) return []
  const target = new URL(detail.playerInfoUrl)
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) throw new Error('UNSAFE_UPSTREAM')
  const data = JSON.parse(await qishuiText(target.href, fetchImpl)) as Record<string, any>
  const list = Array.isArray(data.Result?.Data?.PlayInfoList) ? data.Result.Data.PlayInfoList : []
  const fullSeconds = Number(detail.track?.duration) / 1000
  const streams: QishuiStream[] = []
  for (const level of QUALITY_LEVELS) {
    const info = list.find((item: any) => item?.Quality === level.upstream)
    const url = String(info?.MainPlayUrl || info?.BackupPlayUrl || '')
    // 带 PlayAuth 的是加密流，不解密也不交给播放器。
    if (!url.startsWith('https://') || info?.PlayAuth) continue
    const seconds = Number(info.Duration)
    const trial = detail.track?.vipOnly === true
      || (Number.isFinite(fullSeconds) && fullSeconds > 0 && Number.isFinite(seconds) && seconds < fullSeconds - 5)
    streams.push({ url, level: level.level, label: level.label, br: Number(info.Bitrate) || 0, trial })
  }
  return streams
}

/** 按请求档位取不高于它的最好一档，没有时退到最低档；max/lossless 等取最高档。 */
export function pickQishuiStreams(streams: QishuiStream[], quality: string): QishuiStream[] {
  const cap = REQUEST_RANK[quality] ?? 3
  const rank = (stream: QishuiStream) => QUALITY_LEVELS.find(item => item.level === stream.level)?.rank ?? 0
  const within = streams.filter(stream => rank(stream) <= cap)
  return within.length ? within : streams.slice(-1)
}

// ---------- 歌单 ----------

export async function fetchQishuiPlaylist(id: string, fetchImpl = defaultFetch) {
  if (!isQishuiId(id)) throw new Error('INVALID_ID')
  let cursor = '0'
  let playlist: Record<string, unknown> | null = null
  const raw: unknown[] = []
  const cursors = new Set<string>()
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
    const data = await qishuiJson(apiUrl('/pc/playlist/detail', { playlist_id: id, cursor, cnt: '100' }), fetchImpl)
    playlist ??= mapPlaylist(data.playlist)
    const items = (Array.isArray(data.media_resources) ? data.media_resources : [])
      .filter((item: any) => item?.type === 'track')
      .map((item: any) => item?.entity?.track_wrapper?.track)
    raw.push(...items)
    const next = String(data.next_cursor ?? '')
    cursors.add(cursor)
    if (!items.length || !next || cursors.has(next)) break
    cursor = next
  }
  if (!playlist) throw new Error('NOT_FOUND')
  const tracks = mapTracks(raw)
  return { playlist, tracks }
}

// ---------- 专辑 / 歌手（分享页服务端渲染数据） ----------

/** 从 HTML 里截出 `_ROUTER_DATA = {...}` 的 JSON：按括号配对并跳过字符串内容。 */
export function extractRouterData(html: string): Record<string, any> | null {
  const marker = html.indexOf('_ROUTER_DATA = ')
  if (marker < 0) return null
  const start = html.indexOf('{', marker)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Record<string, any>
      } catch {
        return null
      }
    }
  }
  return null
}

async function sharePage(kind: 'album' | 'artist', id: string, fetchImpl: QishuiFetch): Promise<Record<string, any>> {
  if (!isQishuiId(id)) throw new Error('INVALID_ID')
  const key = `${kind}:${id}`
  const hit = pageCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const html = await qishuiText(`${SHARE_BASE}/${kind}?${new URLSearchParams({ [`${kind}_id`]: id })}`, fetchImpl)
  const page = extractRouterData(html)?.loaderData?.[`${kind}_page`]
  if (!page || typeof page !== 'object') throw new Error('QISHUI_PAGE_CHANGED')
  remember(pageCache, key, page, Date.now())
  return page
}

export async function fetchQishuiAlbum(id: string, fetchImpl = defaultFetch) {
  const page = await sharePage('album', id, fetchImpl)
  const album = mapAlbum(page.albumInfo)
  if (!album) throw new Error('NOT_FOUND')
  return { album, tracks: mapTracks(Array.isArray(page.trackList) ? page.trackList : []) }
}

/** 分享页只带少量热门歌曲与专辑；歌曲再用歌手名搜索、按歌手 ID 过滤补足。 */
export async function fetchQishuiArtist(id: string, fetchImpl = defaultFetch) {
  const page = await sharePage('artist', id, fetchImpl)
  const artist = mapArtist(page.artistInfo)
  if (!artist) throw new Error('NOT_FOUND')
  return {
    artist,
    tracks: mapTracks(Array.isArray(page.trackList) ? page.trackList : []),
    albums: (Array.isArray(page.albumList) ? page.albumList : []).map(mapAlbum).filter(Boolean),
  }
}

export async function fetchQishuiArtistSongs(id: string, fetchImpl = defaultFetch) {
  const { artist, tracks } = await fetchQishuiArtist(id, fetchImpl)
  const found = await searchQishuiTracks(String(artist.name), 50, fetchImpl).catch(() => [])
  const byArtist = found.filter(track => (track.artists as Array<{ id: string }>).some(item => item.id === id))
  return mapTracksById([...tracks, ...byArtist])
}

function mapTracksById(tracks: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return tracks.filter(track => !seen.has(track.id as string) && !!seen.add(track.id as string))
}

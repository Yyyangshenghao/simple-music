import { createHash } from 'node:crypto'
import { isSafeUpstreamUrl } from './security'

/**
 * 酷狗音乐游客接口：搜索、歌单/专辑/歌手/榜单读取与播放地址，均不需要登录、签名或设备注册。
 * 接口参考 KuGouMusicApi 等公开项目，参数以 2026-11 的真实请求核实；网关（gateway.kugou.com）签名接口
 * 依赖设备注册，留给登录阶段。
 * - 列表类走移动端 mobilecdn v3；搜歌走 songsearch v2（带歌手 ID 与封面）。
 * - 播放地址走 trackercdn cmd=25：免费曲返回完整直链；付费曲改取 60 秒试听片段（clip_hash），标记 trial。
 * Track.id 统一为小写的 128 档 hash；duration 为毫秒。
 */

const MOBILE_BASE = 'http://mobilecdn.kugou.com/api/v3'
const SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2'
const SONG_INFO_URL = 'http://m.kugou.com/app/i/getSongInfo.php'
const PLIST_URL = 'http://m.kugou.com/plist/index'
const TRACKER_URL = 'http://trackercdn.kugou.com/i/v2/'
const ALLOWED_HOSTS = new Set(['mobilecdn.kugou.com', 'songsearch.kugou.com', 'm.kugou.com', 'trackercdn.kugou.com'])
const REQUEST_TIMEOUT_MS = 8000
const MAX_BYTES = 4 * 1024 * 1024
const COVER_SIZE = '480'
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

type Rec = Record<string, unknown>

const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {})
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '').trim()
const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 酷狗文件 hash：32 位十六进制，统一小写作为曲目 ID。 */
export function normalizeKugouHash(value: unknown): string {
  const text = str(value).toLowerCase()
  return /^[0-9a-f]{32}$/.test(text) ? text : ''
}

/** 正整数 ID（专辑/歌手/歌单/榜单）；其余一律视为无效。 */
export function normalizeKugouId(value: unknown): string {
  const text = str(value)
  return /^\d{1,15}$/.test(text) && text !== '0' ? text : ''
}

/** 封面地址里的 {size} 占位换成固定尺寸，并升级为 https。 */
export function kugouCover(value: unknown): string {
  const text = str(value)
  if (!text) return ''
  return text.replace('{size}', COVER_SIZE).replace(/^http:\/\//, 'https://')
}

/** 列表接口只给 "歌手A、歌手B - 歌名"：拆出歌手与歌名。 */
export function splitKugouFilename(filename: string): { artist: string; name: string } {
  const index = filename.indexOf(' - ')
  if (index < 0) return { artist: '', name: filename.trim() }
  return { artist: filename.slice(0, index).trim(), name: filename.slice(index + 3).trim() }
}

// 缺歌手 ID 时 id 为 null：渲染层据此不提供歌手页跳转。
function artistsFromNames(names: string, ids: unknown[] = []): Array<{ id: unknown; name: string }> {
  return names.split(/、|\s*&\s*|\s*\/\s*/).map((name) => name.trim()).filter(Boolean)
    .map((name, i) => ({ id: normalizeKugouId(ids[i]) || null, name }))
}

export function kugouTrackUrlKey(hash: string): string {
  return createHash('md5').update(`${hash}kgcloudv2`).digest('hex')
}

export async function kugouGet(target: string, fetchImpl: typeof fetch = fetch): Promise<Rec> {
  let url: URL
  try { url = new URL(target) } catch { throw new Error('UNSAFE_UPSTREAM') }
  if (!ALLOWED_HOSTS.has(url.hostname) || !isSafeUpstreamUrl(target)) throw new Error('UNSAFE_UPSTREAM')
  const res = await fetchImpl(target, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://m.kugou.com/' },
    // 白名单只校验了这一跳，不跟随重定向。
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`UPSTREAM_${res.status}`)
  const body = await res.text()
  if (body.length > MAX_BYTES) throw new Error('TOO_LARGE')
  // 个别接口在 JSON 前带 JSONP 包裹或 BOM。
  const start = body.search(/[{[]/)
  const json = JSON.parse(start > 0 ? body.slice(start, body.lastIndexOf(body[start] === '{' ? '}' : ']') + 1) : body) as unknown
  return rec(json)
}

function mobileUrl(path: string, params: Record<string, string | number>): string {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  return `${MOBILE_BASE}/${path}?${query}`
}

const pageOf = (offset: number, limit: number) => Math.floor(Math.max(0, offset) / Math.max(1, limit)) + 1

// ───────────────────────────── 映射 ─────────────────────────────

/** 歌曲的各档 hash 与试听片段；字段名在不同接口里大小写不一。 */
function hashesOf(raw: Rec): Rec {
  const trans = rec(raw.trans_param)
  const clip = normalizeKugouHash(rec(trans.hash_offset).clip_hash)
  const h320 = normalizeKugouHash(raw['320hash'] ?? raw.HQFileHash)
  const sq = normalizeKugouHash(raw.sqhash ?? raw.SQFileHash)
  return {
    ...(h320 ? { hash320: h320 } : {}),
    ...(sq ? { hashSq: sq } : {}),
    ...(clip ? { clipHash: clip } : {}),
  }
}

function trackRecord(fields: {
  hash: string
  name: string
  artist: string
  artists: Array<{ id: unknown; name: string }>
  album?: string
  albumId?: string
  cover?: string
  durationSec: number
  privilege: number
  albumAudioId?: string
}, raw: Rec): Rec {
  const artistId = fields.artists.find((artist) => artist.id)?.id
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'song',
    id: fields.hash,
    name: fields.name,
    artist: fields.artist,
    artists: fields.artists,
    ...(artistId ? { artistId } : {}),
    album: fields.album ?? '',
    ...(fields.albumId ? { albumId: fields.albumId } : {}),
    cover: fields.cover ?? '',
    duration: Math.round(fields.durationSec * 1000),
    // 0 免费；8/10 等为付费或会员，游客只能试听。
    fee: fields.privilege,
    ...(fields.albumAudioId ? { albumAudioId: fields.albumAudioId } : {}),
    ...hashesOf(raw),
  }
}

/** songsearch v2 的搜索结果。 */
export function mapKugouSearchSong(raw: Rec): Rec | null {
  const hash = normalizeKugouHash(raw.FileHash)
  const name = str(raw.SongName).replace(/<\/?em>/g, '')
  if (!hash || !name) return null
  const singers = arr(raw.Singers).map(rec)
  const artistNames = str(raw.SingerName).replace(/<\/?em>/g, '')
  const artists = singers.length
    ? singers.map((singer) => ({ id: normalizeKugouId(singer.id) || null, name: str(singer.name) })).filter((a) => a.name)
    : artistsFromNames(artistNames, arr(raw.SingerId))
  return trackRecord({
    hash,
    name,
    artist: artistNames || artists.map((a) => a.name).join(' / '),
    artists,
    album: str(raw.AlbumName),
    albumId: normalizeKugouId(raw.AlbumID),
    cover: kugouCover(raw.Image),
    durationSec: num(raw.Duration),
    privilege: num(raw.Privilege),
    albumAudioId: normalizeKugouId(raw.MixSongID),
  }, raw)
}

/** mobilecdn 列表（专辑/歌单/歌手单曲/榜单）里的歌曲：多数只有 filename。 */
export function mapKugouListSong(raw: Rec, context: { album?: string; albumId?: string; cover?: string; artistId?: string } = {}): Rec | null {
  const hash = normalizeKugouHash(raw.hash)
  if (!hash) return null
  const split = splitKugouFilename(str(raw.filename))
  const name = str(raw.songname) || split.name
  if (!name) return null
  const authors = arr(raw.authors).map(rec)
  const artistNames = str(raw.singername) || split.artist || authors.map((a) => str(a.author_name)).join('、')
  const artists = authors.length
    ? authors.map((a) => ({ id: normalizeKugouId(a.author_id) || null, name: str(a.author_name) })).filter((a) => a.name)
    : artistsFromNames(artistNames, context.artistId ? [context.artistId] : [])
  return trackRecord({
    hash,
    name,
    artist: artistNames,
    artists,
    album: str(raw.album_name ?? raw.remark) || context.album || '',
    albumId: normalizeKugouId(raw.album_id) || context.albumId,
    cover: kugouCover(rec(raw.trans_param).union_cover ?? raw.album_sizable_cover) || context.cover || '',
    durationSec: num(raw.duration),
    privilege: num(raw.privilege),
    albumAudioId: normalizeKugouId(raw.album_audio_id),
  }, raw)
}

export function mapKugouAlbum(raw: Rec): Rec | null {
  const id = normalizeKugouId(raw.albumid)
  const name = str(raw.albumname)
  if (!id || !name) return null
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'album',
    id,
    name,
    cover: kugouCover(raw.imgurl),
    trackCount: num(raw.songcount),
    // 专辑详情接口的 songcount 常为 0，只有正数才算平台确认的数量。
    trackCountKnown: num(raw.songcount) > 0,
    playCount: 0,
    creator: str(raw.singername),
    ...(normalizeKugouId(raw.singerid) ? { artistId: normalizeKugouId(raw.singerid) } : {}),
    ...(str(raw.publishtime) ? { publishTime: str(raw.publishtime).slice(0, 10) } : {}),
    description: str(raw.intro),
  }
}

export function mapKugouSpecial(raw: Rec): Rec | null {
  const id = normalizeKugouId(raw.specialid)
  const name = str(raw.specialname)
  if (!id || !name) return null
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'playlist',
    id,
    name,
    cover: kugouCover(raw.imgurl ?? raw.img),
    trackCount: num(raw.songcount),
    // 专辑详情接口的 songcount 常为 0，只有正数才算平台确认的数量。
    trackCountKnown: num(raw.songcount) > 0,
    playCount: num(raw.playcount),
    creator: str(raw.nickname ?? raw.username),
    description: str(raw.intro),
  }
}

// ───────────────────────────── 搜索 ─────────────────────────────

export async function kugouSearchSongs(keyword: string, limit = 20, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const size = Math.max(1, Math.min(30, limit))
  const json = await kugouGet(`${SEARCH_URL}?${new URLSearchParams({ keyword: kw, page: '1', pagesize: String(size), platform: 'WebFilter' })}`, fetchImpl)
  const seen = new Set<string>()
  return arr(rec(json.data).lists).map((item) => mapKugouSearchSong(rec(item)))
    .filter((song): song is Rec => !!song && !seen.has(String(song.id)) && !!seen.add(String(song.id)))
}

export async function kugouSearchArtists(keyword: string, limit = 5, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const json = await kugouGet(mobileUrl('search/singer', { keyword: kw, page: 1, pagesize: limit }), fetchImpl)
  // 歌手搜索只返回名字与 ID，头像按需在详情里补。
  return arr(json.data).map(rec).slice(0, limit).map((raw) => ({
    id: normalizeKugouId(raw.singerid), name: str(raw.singername), avatar: kugouCover(raw.imgurl), source: 'kugou',
  })).filter((artist) => artist.id && artist.name)
}

export async function kugouSearchAlbums(keyword: string, limit = 20, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const json = await kugouGet(mobileUrl('search/album', { keyword: kw, page: 1, pagesize: limit }), fetchImpl)
  return arr(rec(json.data).info).map((item) => mapKugouAlbum(rec(item))).filter((a): a is Rec => !!a)
}

export async function kugouSearchPlaylists(keyword: string, limit = 20, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const json = await kugouGet(mobileUrl('search/special', { keyword: kw, page: 1, pagesize: limit }), fetchImpl)
  return arr(rec(json.data).info).map((item) => mapKugouSpecial(rec(item))).filter((p): p is Rec => !!p)
}

export async function kugouSearchHotkeys(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const json = await kugouGet(mobileUrl('search/hot', { format: 'json', plat: 0, count: 20 }), fetchImpl)
  return arr(rec(json.data).info).map((item) => str(rec(item).keyword)).filter(Boolean)
}

// ───────────────────────────── 详情读取 ─────────────────────────────

/** 单曲详情（按 hash）：同时给出各档 hash 与试听片段，播放解析依赖它。 */
export async function kugouSongInfo(hash: string, fetchImpl: typeof fetch = fetch): Promise<Rec | null> {
  const id = normalizeKugouHash(hash)
  if (!id) return null
  const json = await kugouGet(`${SONG_INFO_URL}?${new URLSearchParams({ cmd: 'playInfo', hash: id })}`, fetchImpl)
  if (!normalizeKugouHash(json.hash)) return null
  const extra = rec(json.extra)
  const authors = arr(json.authors).map(rec)
  const artistNames = str(json.author_name ?? json.singerName) || authors.map((a) => str(a.author_name)).join('、')
  return trackRecord({
    hash: id,
    name: str(json.songName) || splitKugouFilename(str(json.fileName)).name,
    artist: artistNames,
    artists: authors.length
      ? authors.map((a) => ({ id: normalizeKugouId(a.author_id) || null, name: str(a.author_name) })).filter((a) => a.name)
      : artistsFromNames(artistNames, [json.singerId]),
    album: '',
    albumId: normalizeKugouId(json.albumid),
    cover: kugouCover(json.album_img ?? json.imgUrl),
    durationSec: num(json.timeLength) || num(extra['128timelength']) / 1000,
    privilege: num(json.privilege),
    albumAudioId: normalizeKugouId(json.album_audio_id),
  }, { ...json, '320hash': extra['320hash'], sqhash: extra.sqhash })
}

export async function kugouSongDetails(hashes: string[], fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const ids = [...new Set(hashes.map(normalizeKugouHash).filter(Boolean))].slice(0, 50)
  const out: Rec[] = []
  // 详情接口不支持批量；小并发逐个取。
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map((id) => kugouSongInfo(id, fetchImpl).catch(() => null)))
    for (const song of batch) if (song) out.push(song)
  }
  return out
}

export async function kugouAlbumDetail(albumId: string, fetchImpl: typeof fetch = fetch): Promise<Rec | null> {
  const id = normalizeKugouId(albumId)
  if (!id) return null
  const json = await kugouGet(mobileUrl('album/info', { albumid: id }), fetchImpl)
  const data = rec(json.data)
  return mapKugouAlbum({ ...data, albumid: data.albumid ?? id })
}

export async function kugouAlbumSongs(albumId: string, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const id = normalizeKugouId(albumId)
  if (!id) return []
  const [album, json] = await Promise.all([
    kugouAlbumDetail(id, fetchImpl).catch(() => null),
    kugouGet(mobileUrl('album/song', { albumid: id, page: 1, pagesize: 200 }), fetchImpl),
  ])
  const context = { album: str(album?.name), albumId: id, cover: str(album?.cover), artistId: str(album?.artistId) }
  return arr(rec(json.data).info).map((item) => mapKugouListSong(rec(item), context)).filter((s): s is Rec => !!s)
}

export async function kugouArtistDetail(singerId: string, fetchImpl: typeof fetch = fetch): Promise<Rec | null> {
  const id = normalizeKugouId(singerId)
  if (!id) return null
  const json = await kugouGet(mobileUrl('singer/info', { singerid: id }), fetchImpl)
  const data = rec(json.data)
  const name = str(data.singername)
  if (!name) return null
  return {
    id,
    name,
    avatar: kugouCover(data.imgurl),
    description: str(data.intro ?? data.profile),
    songNum: num(data.songcount),
    musicSize: num(data.songcount),
    source: 'kugou',
  }
}

export async function kugouArtistSongs(singerId: string, offset = 0, limit = 50, fetchImpl: typeof fetch = fetch): Promise<{ songs: Rec[]; total: number }> {
  const id = normalizeKugouId(singerId)
  if (!id) return { songs: [], total: 0 }
  const size = Math.max(1, Math.min(100, limit))
  const json = await kugouGet(mobileUrl('singer/song', { singerid: id, page: pageOf(offset, size), pagesize: size, sorttype: 0 }), fetchImpl)
  const data = rec(json.data)
  return {
    songs: arr(data.info).map((item) => mapKugouListSong(rec(item), { artistId: id })).filter((s): s is Rec => !!s),
    total: num(data.total),
  }
}

export async function kugouArtistAlbums(singerId: string, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const id = normalizeKugouId(singerId)
  if (!id) return []
  const json = await kugouGet(mobileUrl('singer/album', { singerid: id, page: 1, pagesize: 100 }), fetchImpl)
  return arr(rec(json.data).info).map((item) => mapKugouAlbum(rec(item))).filter((a): a is Rec => !!a)
}

export async function kugouPlaylistDetail(specialId: string, fetchImpl: typeof fetch = fetch): Promise<Rec | null> {
  const id = normalizeKugouId(specialId)
  if (!id) return null
  const json = await kugouGet(mobileUrl('special/info', { specialid: id }), fetchImpl)
  const data = rec(json.data)
  return mapKugouSpecial({ ...data, specialid: data.specialid ?? id })
}

export async function kugouPlaylistPage(specialId: string, offset = 0, limit = 100, fetchImpl: typeof fetch = fetch): Promise<{ songs: Rec[]; total: number }> {
  const id = normalizeKugouId(specialId)
  if (!id) return { songs: [], total: 0 }
  const size = Math.max(1, Math.min(300, limit))
  const json = await kugouGet(mobileUrl('special/song', { specialid: id, page: pageOf(offset, size), pagesize: size }), fetchImpl)
  const data = rec(json.data)
  return {
    songs: arr(data.info).map((item) => mapKugouListSong(rec(item))).filter((s): s is Rec => !!s),
    total: num(data.total),
  }
}

/** 歌单全部曲目：按页取到上游总数为止，最多 2000 首。 */
export async function kugouPlaylistTracks(specialId: string, fetchImpl: typeof fetch = fetch): Promise<{ playlist: Rec | null; songs: Rec[] }> {
  const pageSize = 300
  const [playlist, first] = await Promise.all([
    kugouPlaylistDetail(specialId, fetchImpl).catch(() => null),
    kugouPlaylistPage(specialId, 0, pageSize, fetchImpl),
  ])
  const songs = [...first.songs]
  const total = Math.min(first.total, 2000)
  for (let offset = pageSize; offset < total; offset += pageSize) {
    const page = await kugouPlaylistPage(specialId, offset, pageSize, fetchImpl)
    if (!page.songs.length) break
    songs.push(...page.songs)
  }
  return { playlist, songs }
}

export async function kugouRecommendPlaylists(page = 0, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const json = await kugouGet(`${PLIST_URL}?${new URLSearchParams({ json: 'true', page: String(Math.max(0, page) + 1) })}`, fetchImpl)
  return arr(rec(rec(json.plist).list).info)
    .map((item) => mapKugouSpecial(rec(item))).filter((p): p is Rec => !!p)
}

export const KUGOU_TOPLIST_PREFIX = 'rank:'

/** 官方榜单：榜单本身当作歌单，id 加前缀以与普通歌单区分。 */
export async function kugouToplists(fetchImpl: typeof fetch = fetch): Promise<Array<{ title: string; entries: Rec[] }>> {
  const json = await kugouGet(mobileUrl('rank/list', { withsong: 0 }), fetchImpl)
  const entries = arr(rec(json.data).info).map(rec).map((raw) => {
    const id = normalizeKugouId(raw.rankid)
    const name = str(raw.rankname)
    if (!id || !name) return null
    return {
      playlist: {
        provider: 'kugou', source: 'kugou', type: 'playlist', id: `${KUGOU_TOPLIST_PREFIX}${id}`, name,
        cover: kugouCover(raw.img_cover ?? raw.album_img_9 ?? raw.imgurl), trackCount: 0, trackCountKnown: false, playCount: num(raw.play_times),
        creator: '酷狗音乐', description: str(raw.intro),
      },
      updateFrequency: str(raw.update_frequency),
      preview: [],
    }
  }).filter((entry): entry is NonNullable<typeof entry> => !!entry)
  return entries.length ? [{ title: '酷狗榜单', entries }] : []
}

export async function kugouToplistSongs(rankId: string, fetchImpl: typeof fetch = fetch): Promise<Rec[]> {
  const id = normalizeKugouId(rankId.startsWith(KUGOU_TOPLIST_PREFIX) ? rankId.slice(KUGOU_TOPLIST_PREFIX.length) : rankId)
  if (!id) return []
  const songs: Rec[] = []
  for (let page = 1; page <= 5; page++) {
    const json = await kugouGet(mobileUrl('rank/song', { rankid: id, page, pagesize: 100 }), fetchImpl)
    const data = rec(json.data)
    const batch = arr(data.info).map((item) => mapKugouListSong(rec(item))).filter((s): s is Rec => !!s)
    songs.push(...batch)
    if (!batch.length || songs.length >= num(data.total)) break
  }
  return songs
}

export async function kugouToplistPreview(rankId: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ name: string; artist: string }>> {
  const id = normalizeKugouId(rankId.startsWith(KUGOU_TOPLIST_PREFIX) ? rankId.slice(KUGOU_TOPLIST_PREFIX.length) : rankId)
  if (!id) return []
  const json = await kugouGet(mobileUrl('rank/song', { rankid: id, page: 1, pagesize: 3 }), fetchImpl)
  return arr(rec(json.data).info).map((item) => mapKugouListSong(rec(item)))
    .filter((s): s is Rec => !!s).map((song) => ({ name: str(song.name), artist: str(song.artist) }))
}

// ───────────────────────────── 播放 ─────────────────────────────

export interface KugouQualityTier {
  level: 'standard' | 'exhigh' | 'lossless'
  label: string
  br: number
  hashKey: 'id' | 'hash320' | 'hashSq'
}

export const KUGOU_QUALITY_TIERS: readonly KugouQualityTier[] = [
  { level: 'lossless', label: '无损', br: 999000, hashKey: 'hashSq' },
  { level: 'exhigh', label: '极高', br: 320000, hashKey: 'hash320' },
  { level: 'standard', label: '标准', br: 128000, hashKey: 'id' },
]

/** 从请求档位起向下回退的候选档（max/hires 等更高档视为无损起步）。 */
export function kugouTiersFrom(quality: string): KugouQualityTier[] {
  const start = quality === 'standard' || quality === 'higher' ? 2 : quality === 'exhigh' ? 1 : 0
  return KUGOU_QUALITY_TIERS.slice(start)
}

interface TrackerResult { url: string; bitrate: number }

/** trackercdn 取单个文件的直链；status 非 1（付费/下架）返回 null。 */
export async function kugouTrackerUrl(hash: string, fetchImpl: typeof fetch = fetch): Promise<TrackerResult | null> {
  const id = normalizeKugouHash(hash)
  if (!id) return null
  const params = new URLSearchParams({
    cmd: '25', hash: id, key: kugouTrackUrlKey(id), pid: '1', behavior: 'play', appid: '1005', version: '8981',
  })
  const json = await kugouGet(`${TRACKER_URL}?${params}`, fetchImpl)
  if (num(json.status) !== 1) return null
  const url = arr(json.url).map(str).find((item) => isSafeUpstreamUrl(item))
  return url ? { url, bitrate: num(json.bitRate) } : null
}

// 详情里的各档 hash 短期复用，避免同一首歌换档、预加载时反复查。
const SONG_INFO_TTL_MS = 10 * 60 * 1000
const SONG_INFO_LIMIT = 200
const songInfoCache = new Map<string, { song: Rec; expiresAt: number }>()

async function cachedSongInfo(hash: string, fetchImpl: typeof fetch): Promise<Rec | null> {
  const hit = songInfoCache.get(hash)
  if (hit && hit.expiresAt > Date.now()) return hit.song
  const song = await kugouSongInfo(hash, fetchImpl)
  if (song) {
    songInfoCache.set(hash, { song, expiresAt: Date.now() + SONG_INFO_TTL_MS })
    if (songInfoCache.size > SONG_INFO_LIMIT) songInfoCache.delete(songInfoCache.keys().next().value as string)
  }
  return song
}

export function resetKugouClientState(): void {
  songInfoCache.clear()
}

/**
 * 单曲游客实际能取到完整文件的档位：详情给出各档 hash 后并发探测 trackercdn。
 * 付费档（以及只能试听的整首）不列出，避免音质菜单出现选了也放不了的档。
 */
export async function kugouSongQualities(hash: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ level: string; label: string; br: number }>> {
  const id = normalizeKugouHash(hash)
  if (!id) return []
  const song = await cachedSongInfo(id, fetchImpl)
  if (!song) return []
  const probes = await Promise.all(KUGOU_QUALITY_TIERS.map(async (tier) => {
    const tierHash = tier.hashKey === 'id' ? id : normalizeKugouHash(song[tier.hashKey])
    if (!tierHash) return false
    return !!(await kugouTrackerUrl(tierHash, fetchImpl).catch(() => null))
  }))
  return KUGOU_QUALITY_TIERS.filter((_, i) => probes[i]).map(({ level, label, br }) => ({ level, label, br }))
}

/**
 * 解析播放地址：从请求档位起逐档向下取完整文件；全都拿不到（付费曲）时取 60 秒试听片段并标记 trial。
 * 返回结构对齐网易/QQ 的 /song/url。
 */
export async function kugouSongUrl(hash: string, quality: string, fetchImpl: typeof fetch = fetch): Promise<Rec> {
  const id = normalizeKugouHash(hash)
  if (!id) return { provider: 'kugou', url: '', error: 'MISSING_HASH', message: '缺少酷狗歌曲 hash' }
  // 详情或单档探测失败时仍按 128 档 hash 尝试，不让一次网络错误拖垮整首歌。
  let failure: unknown = null
  const attempt = <T>(task: Promise<T>) => task.catch((err: unknown) => { failure = err; return null })
  const song = await attempt(cachedSongInfo(id, fetchImpl))
  const candidates: Rec[] = []
  for (const tier of kugouTiersFrom(quality)) {
    const tierHash = tier.hashKey === 'id' ? id : normalizeKugouHash(song?.[tier.hashKey])
    if (!tierHash) continue
    const result = await attempt(kugouTrackerUrl(tierHash, fetchImpl))
    if (result) candidates.push({ url: result.url, quality: tier.label, level: tier.level, trial: false })
    // 取到最高可得档即可；低档留给播放失败时回退。
    if (candidates.length >= 2) break
  }
  if (!candidates.length) {
    const clip = normalizeKugouHash(song?.clipHash)
    const result = clip ? await attempt(kugouTrackerUrl(clip, fetchImpl)) : null
    if (result) candidates.push({ url: result.url, quality: '试听', level: 'standard', trial: true })
  }
  // 全都取不到且途中有网络错误：按上游故障报出，不误报成会员限制。
  if (!candidates.length && failure) throw failure
  if (!candidates.length) {
    return {
      provider: 'kugou', url: '', error: 'UNAVAILABLE',
      restriction: { message: Number(song?.fee) ? '酷狗音乐需要会员或购买，游客无法播放' : '酷狗音乐没有返回可播放地址' },
    }
  }
  const [first] = candidates
  return { provider: 'kugou', url: first.url, quality: first.quality, level: first.level, trial: first.trial, candidates }
}

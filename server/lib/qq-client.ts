/**
 * QQ 音乐上游请求封装与辅助函数。
 *
 * 忠实移植自参考项目 server.js（原生 http.createServer 版本）中与 QQ 音乐相关的
 * 全局常量、cookie 解析、上游 HTTP 请求与各业务 handler。
 *
 * 与原文件的差异：
 * - 上游请求改用 Node 内置全局 `fetch`（原文件用 http/https.request 的 requestText）。
 *   保留原有 UA / Referer / Cookie / Content-Type 等 header 与 10s 超时、>=400 抛错语义。
 * - 原全局可变 `qqCookie` 改为按调用显式传入 cookie 字符串（由 ctx 读取）。
 */

// ---------- 通用类型与取值助手 ----------

export type CookieMap = Record<string, string>

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const numOf = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// ---------- 常量（移植自原文件） ----------

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
export const QQ_HEADERS: Record<string, string> = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
}

interface QualityTemplate {
  prefix: string
  ext: string
  level: string
  label: string
}

export const QQ_QUALITY_CANDIDATE_TEMPLATES: QualityTemplate[] = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
]

// ---------- 上游 HTTP（fetch 实现） ----------

interface RequestTextOptions {
  method?: string
  headers?: Record<string, string>
}

export async function requestText(
  targetUrl: string,
  opts: RequestTextOptions = {},
  body?: string
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), 10000)
  try {
    const response = await fetch(targetUrl, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    if (response.status >= 400) {
      const err = new Error('HTTP ' + response.status) as Error & {
        statusCode?: number
        body?: string
      }
      err.statusCode = response.status
      err.body = text
      throw err
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

export function parseJSONText(text: unknown): unknown {
  const raw = String(text || '').trim()
  const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1')
  return JSON.parse(json)
}

// ---------- Cookie 解析 / 规范化 ----------

const COOKIE_ATTRIBUTE_NAMES = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'samesite',
  'secure',
  'httponly',
])

function collectCookiePair(picked: Map<string, string>, key: unknown, value: unknown): void {
  const k = String(key || '').trim()
  if (!k || COOKIE_ATTRIBUTE_NAMES.has(k.toLowerCase())) return
  if (value === null || value === undefined) return
  picked.set(k, String(value).trim())
}

function collectCookieInput(input: unknown, picked: Map<string, string>): void {
  if (input === null || input === undefined) return
  if (Array.isArray(input)) {
    input.forEach((item) => collectCookieInput(item, picked))
    return
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (obj.name && Object.prototype.hasOwnProperty.call(obj, 'value')) {
      collectCookiePair(picked, obj.name, obj.value)
      return
    }
    Object.keys(obj).forEach((key) => {
      const value = obj[key]
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, (value as Record<string, unknown>).value)
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value)
      }
    })
    return
  }
  String(input)
    .split(/\r?\n/)
    .forEach((line) => {
      line.split(';').forEach((part) => {
        const raw = String(part || '').trim()
        const idx = raw.indexOf('=')
        if (idx <= 0) return
        collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1))
      })
    })
}

export function normalizeCookieHeader(input: unknown): string {
  const picked = new Map<string, string>()
  collectCookieInput(input, picked)
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

export function rawCookieFallback(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (Array.isArray(input) && input.every((item) => typeof item === 'string')) {
    return (input as string[]).join('; ').trim()
  }
  return ''
}

/**
 * 等价于原 `saveQQCookie(c)` 内部对入参的规范化结果：
 * `normalizeCookieHeader(c) || rawCookieFallback(c)`。
 * 路由据此决定 setCookie / clearCookie。
 */
export function computeSavedQQCookie(input: unknown): string {
  return normalizeCookieHeader(input) || rawCookieFallback(input)
}

export function parseCookieString(cookieText: unknown): CookieMap {
  const out: CookieMap = {}
  String(cookieText || '')
    .split(';')
    .forEach((part) => {
      const raw = String(part || '').trim()
      if (!raw) return
      const idx = raw.indexOf('=')
      if (idx <= 0) return
      const key = raw.slice(0, idx).trim()
      const value = raw.slice(idx + 1).trim()
      if (key) out[key] = value
    })
  return out
}

function serializeCookieObject(obj: Record<string, unknown>): string {
  return Object.keys(obj || {})
    .filter((k) => obj[k] != null && String(obj[k]) !== '')
    .map((k) => k + '=' + String(obj[k]))
    .join('; ')
}

export function normalizeQQUin(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.replace(/^0+/, '') || digits
}

export function qqCookieUin(obj: CookieMap): string {
  const raw =
    Number(obj.login_type) === 2
      ? obj.wxuin || obj.uin || obj.p_uin
      : obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin
  return normalizeQQUin(raw)
}

export function qqCookieMusicKey(obj: CookieMap): string {
  return (
    obj.qm_keyst ||
    obj.qqmusic_key ||
    obj.music_key ||
    obj.p_skey ||
    obj.skey ||
    obj.psrf_qqaccess_token ||
    obj.psrf_qqrefresh_token ||
    obj.wxrefresh_token ||
    obj.wxskey ||
    ''
  )
}

export function qqCookiePlaybackKey(obj: CookieMap): string {
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || ''
}

/** 个性化接口(雷达/猜你喜欢等)的鉴权 comm 块,与 handleQQSongUrl 的 vkey 请求同构:带 uin+authst,ct 随是否有票据切换。 */
function qqAuthComm(cookie: string): { uin: string; format: string; ct: number; cv: number; authst?: string } {
  const cookieObj = parseCookieString(cookie)
  const uin = qqCookieUin(cookieObj) || '0'
  const musicKey = qqCookieMusicKey(cookieObj)
  const comm: { uin: string; format: string; ct: number; cv: number; authst?: string } = {
    uin,
    format: 'json',
    ct: musicKey ? 19 : 24,
    cv: 0,
  }
  if (musicKey) comm.authst = musicKey
  return comm
}

function decodeQQCookieValue(value: unknown): string {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim()
  } catch {
    return String(value || '').trim()
  }
}

function qqCookieNickname(obj: CookieMap, uinInput?: string): string {
  const uin = normalizeQQUin(uinInput || qqCookieUin(obj))
  const padded = uin ? '0' + uin : ''
  const keys = [
    uin && 'ptnick_' + uin,
    padded && 'ptnick_' + padded,
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname',
  ].filter(Boolean) as string[]
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key])
      if (nick) return nick
    }
  }
  const ptnickKey = Object.keys(obj).find((key) => /^ptnick_/i.test(key) && obj[key])
  return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : ''
}

function qqCookieAvatar(obj: CookieMap, uinInput?: string): string {
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || ''
  if (direct) return decodeQQCookieValue(direct)
  const uin = normalizeQQUin(uinInput || qqCookieUin(obj))
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : ''
}

export function normalizeQQCookieInput(cookieText: string): string {
  const obj = parseCookieString(cookieText)
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin)
  return serializeCookieObject(obj)
}

// ---------- 播放限制分类 ----------

interface PlaybackRestriction {
  provider: string
  category: string
  action: string
  message: string
  [key: string]: unknown
}

function playbackRestriction(
  provider: string,
  category: string,
  message: string,
  action?: string,
  extra?: Record<string, unknown>
): PlaybackRestriction {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  }
}

interface QQPlaybackSession {
  hasSession?: boolean
  hasPlaybackKey?: boolean
}

function classifyQQPlaybackRestriction(
  info: unknown,
  session: QQPlaybackSession | boolean,
  feeHint?: boolean
): PlaybackRestriction {
  const sessionObj = typeof session === 'object' ? session : { hasSession: !!session, hasPlaybackKey: !!session }
  const hasSession = !!sessionObj.hasSession
  const hasPlaybackKey =
    typeof session === 'object' ? !!sessionObj.hasPlaybackKey : hasSession
  const infoRec = rec(info)
  const rawMsg = String(
    infoRec.msg || infoRec.tips || infoRec.errmsg || infoRec.message || ''
  ).trim()
  const code = Number(infoRec.result || infoRec.code || infoRec.errtype || 0)
  const lower = rawMsg.toLowerCase()
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', {
      code,
      rawMessage: rawMsg,
    })
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction(
      'qq',
      'login_required',
      'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权',
      'login',
      { code, rawMessage: rawMsg, missingPlaybackKey: true }
    )
  }
  if (code === 104003 && feeHint) {
    return playbackRestriction(
      'qq',
      'paid_required',
      'QQ 音乐显示这首歌是付费/会员曲目，需要开通会员或购买后才能播放，也可以换一首或切到网易云源',
      'upgrade',
      { code, rawMessage: rawMsg }
    )
  }
  if (code === 104003) {
    return playbackRestriction(
      'qq',
      'copyright_unavailable',
      'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源',
      'switch_source',
      { code, rawMessage: rawMsg }
    )
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', {
      code,
      rawMessage: rawMsg,
    })
  }
  if (code && code !== 0) {
    return playbackRestriction(
      'qq',
      'copyright_unavailable',
      rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播',
      'switch_source',
      { code, rawMessage: rawMsg }
    )
  }
  return playbackRestriction(
    'qq',
    'url_unavailable',
    'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制',
    'switch_source',
    { code, rawMessage: rawMsg }
  )
}

// ---------- 音质偏好 ----------

function normalizeQualityPreference(value: unknown): string {
  const raw = String(value || '').toLowerCase().trim()
  // max = 逐首歌取实际可得的最高档;candidates 里无此 level,findIndex 落空后从头(Hi-Res)开始整链回退
  if (['max', 'best', 'highest', 'auto'].includes(raw)) return 'max'
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster'
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires'
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless'
  // QQ 无 192k 档，较高归入 320k
  if (['exhigh', 'high', 'higher', 'medium', '192', '192k', '320', '320k', 'hq'].includes(raw)) return 'exhigh'
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard'
  if (['aac', 'm4a', 'c400'].includes(raw)) return 'aac'
  return 'hires'
}

function qualityCandidatesFrom(target: unknown, candidates: QualityTemplate[]): QualityTemplate[] {
  const t = normalizeQualityPreference(target)
  let start = candidates.findIndex((item) => item.level === t)
  if (start < 0) start = 0
  return candidates.slice(start)
}

// ---------- 歌单 / 收藏过滤 ----------

interface QQPlaylist {
  provider: string
  source: string
  id: string
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator: string
  subscribed: boolean
  specialType: number
}

export const QQ_LIKED_PLAYLIST_ID = 'qq-liked:201'
export const QQ_TOPLIST_PREFIX = 'qq-toplist:'

export function isQQLikedPlaylistReference(value: unknown): boolean {
  return String(value || '').trim() === QQ_LIKED_PLAYLIST_ID
}

export function qqAuthErrorStatus(error: unknown): 401 | 403 | null {
  const statusCode = Number(rec(error).statusCode)
  if (statusCode === 401 || statusCode === 403) return statusCode
  const message = error instanceof Error ? error.message : str(error)
  if (message === 'AUTH_REQUIRED') return 401
  if (message === 'AUTH_EXPIRED') return 403
  return null
}

export function isQQToplistReference(value: unknown): boolean {
  return /^qq-toplist:\d+$/.test(String(value || '').trim())
}

export type QQPlaylistReference =
  | { kind: 'playlist'; id: string }
  | { kind: 'liked'; id: '201' }
  | { kind: 'toplist'; id: string }

export function qqPlaylistReference(value: unknown): QQPlaylistReference {
  const id = String(value || '').trim()
  if (isQQLikedPlaylistReference(id)) return { kind: 'liked', id: '201' }
  if (id.startsWith(QQ_TOPLIST_PREFIX)) {
    return { kind: 'toplist', id: id.slice(QQ_TOPLIST_PREFIX.length) }
  }
  return { kind: 'playlist', id }
}

function isQQFavoritePlaylist(raw: Record<string, unknown>): boolean {
  return String(raw.dirid ?? raw.dirId ?? '').trim() === '201'
}

function isQzoneBackgroundPlaylist(pl: QQPlaylist): boolean {
  const text = String(((pl && pl.name) || '') + ' ' + ((pl && pl.creator) || '')).toLowerCase()
  return /qzone|空间|背景音乐/i.test(text)
}

// ---------- 封面 / 头像 ----------

function qqAlbumCover(albumMid: string, size?: number): string {
  if (!albumMid) return ''
  const px = size || 300
  return (
    'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000'
  )
}

function qqSingerAvatar(singerMid: string, size?: number): string {
  if (!singerMid) return ''
  const px = size || 300
  return (
    'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000'
  )
}

/**
 * QQ 的用户歌单接口偶尔把 `?n=1` 这类图片查询串放进封面字段。
 * 它是上游的缺图占位值，不是可独立加载的图片地址；同时兼容常见的协议相对地址。
 */
export function pickQQImageUrl(...values: unknown[]): string {
  for (const value of values) {
    const raw = str(value).trim()
    if (!raw) continue
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return normalized
    } catch {
      // 继续尝试后续候选字段
    }
  }
  return ''
}

/** 歌单元数据缺图时，继续使用曲目列表里第一张有效专辑图。 */
export function pickQQPlaylistCover(detail: unknown, tracks: unknown[]): string {
  const playlist = rec(detail)
  return pickQQImageUrl(
    playlist.logo,
    playlist.diss_cover,
    playlist.cover,
    ...tracks.map((track) => rec(track).cover)
  )
}

// ---------- 字段映射 ----------

interface QQArtist {
  id: string | null
  mid: string
  qqArtistId: unknown
  name: string
}

function mapQQArtists(raw: unknown): QQArtist[] {
  return arr(raw)
    .map((a) => {
      const o = rec(a)
      const mid = str(o.mid || o.singerMid || o.singermid)
      return {
        id: mid || null,
        mid,
        qqArtistId: o.id || o.singerId || o.singerID || '',
        name: str(o.name || o.title || o.singerName),
      }
    })
    .filter((a) => a.name)
}

function plainTextDescription(raw: unknown): string {
  return str(raw)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function mapQQTrack(track: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  const t = rec(track)
  const fb = rec(fallback)
  const album = rec(t.album)
  const rawArtists = t.singer || []
  const artists = mapQQArtists(rawArtists)
  const displayArtists = artists.length ? artists : mapQQArtists(fb.artists)
  const linkedArtist = displayArtists.find((artist) => artist.mid)
  const mid = str(t.mid || fb.mid || fb.songmid)
  const albumMid = str(album.mid || album.pmid)
  const pay = rec(t.pay)
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: t.id || fb.qqId || fb.id || '',
    mid,
    songmid: mid,
    mediaMid: rec(t.file).media_mid,
    name: str(t.name || t.title || fb.name),
    artist: artists.map((a) => a.name).join(' / ') || str(fb.artist) || displayArtists.map((a) => a.name).join(' / '),
    artists: displayArtists,
    artistId: linkedArtist?.id,
    artistMid: linkedArtist?.mid,
    album: str(album.name || album.title || fb.album),
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || str(fb.cover),
    duration: numOf(t.interval) * 1000,
    fee: pay && numOf(pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

function mapQQPlaylist(raw: unknown, kind: string): QQPlaylist {
  const pl = rec(raw)
  const upstreamId = pl.dissid || pl.tid || pl.dirid || pl.id || pl.diss_id
  const playlist = {
    provider: 'qq',
    source: 'qq',
    id: upstreamId ? String(upstreamId) : '',
    name: str(pl.diss_name || pl.name || pl.title),
    cover: pickQQImageUrl(pl.diss_cover, pl.logo, pl.picurl, pl.cover),
    trackCount: numOf(pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count),
    playCount: numOf(pl.listen_num || pl.visitnum || pl.play_count),
    creator: str(pl.hostname || pl.nick || pl.creator) || 'QQ 音乐',
    subscribed: kind === 'collect',
    specialType: 0,
  }
  if (isQQFavoritePlaylist(pl)) {
    playlist.id = QQ_LIKED_PLAYLIST_ID
  }
  return playlist
}

/** GetRecommendFeed 返回的歌单是嵌套结构(item.Playlist.basic,封面/创建者也是对象),与其余接口的扁平字段不同源,单独映射。 */
function mapQQFeedPlaylist(raw: unknown): Record<string, unknown> {
  const item = rec(raw)
  const pl = rec(item.Playlist || item.playlist || item)
  const basic = rec(pl.basic || pl)
  const cover = rec(basic.cover)
  const creator = rec(basic.creator)
  const id = basic.tid || basic.dirid || basic.id
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    name: str(basic.title || basic.name),
    cover: pickQQImageUrl(
      cover.medium_url,
      cover.big_url,
      cover.default_url,
      cover.small_url,
      basic.cover
    ),
    trackCount: numOf(basic.song_cnt || basic.songnum),
    playCount: numOf(basic.play_cnt || basic.listen_num),
    creator: str(creator.nick || creator.name) || 'QQ 音乐',
    subscribed: false,
    specialType: 0,
  }
}

function mapQQPlaylistTrack(raw: unknown): Record<string, unknown> {
  const r = rec(raw)
  const track = r.songid || r.songmid || r.mid || r.name ? r : rec(r.track_info || r.songInfo || r.songinfo || r.song)
  const album = rec(track.album)
  const artists = mapQQArtists(track.singer || track.singers || [])
  const linkedArtist = artists.find((artist) => artist.mid)
  const mid = str(track.mid || track.songmid || r.mid || r.songmid)
  const albumMid = str(album.mid || track.albummid || r.albummid)
  const pay = rec(track.pay)
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || track.songid || r.id || r.songid || '',
    mid,
    songmid: mid,
    mediaMid: str(rec(track.file).media_mid || track.strMediaMid || track.media_mid || r.strMediaMid),
    name: str(track.name || track.songname || r.songname),
    artist: artists.map((a) => a.name).join(' / ') || str(track.singername || r.singername),
    artists,
    artistId: linkedArtist?.id,
    artistMid: linkedArtist?.mid,
    album: str(album.name || album.title || track.albumname || r.albumname),
    albumMid,
    cover: qqAlbumCover(albumMid, 300),
    duration: numOf(track.interval || r.interval) * 1000,
    fee: pay && numOf(pay.pay_play) ? 1 : 0,
    playable: false,
  }
}

function mapQQComment(raw: unknown): Record<string, unknown> {
  const r = rec(raw)
  const user = rec(r.user || r.uin)
  const nickname = str(
    r.nick || r.nickname || r.encrypt_uin || user.nick || user.nickname || user.name
  ) || 'QQ 音乐用户'
  const avatar = str(r.avatarurl || r.avatar || user.avatarurl || user.avatar)
  const timeRaw = numOf(r.time || r.commenttime || r.createTime)
  return {
    id: r.commentid || r.commentId || r.id || '',
    content: str(r.rootcommentcontent || r.content || r.comment),
    likedCount: numOf(r.praisenum || r.praise_num || r.likedCount),
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: r.encrypt_uin || r.uin || user.uin || '',
      nickname,
      avatar,
    },
  }
}

// ---------- HTML / 歌词解码 ----------

function decodeHtmlEntities(text: unknown): string {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

function decodeQQLyricText(text: unknown): string {
  let raw = decodeHtmlEntities(String(text || '').trim())
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '')
  const looksBase64 =
    compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^﻿/, '')
      if (decoded && (decoded.includes('[') || /[一-龥]/.test(decoded))) raw = decoded
    } catch (e) {
      console.warn('[QQLyric] base64 decode failed:', (e as Error).message)
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim()
}

function normalizeQQSongId(id: unknown): number {
  const raw = String(id || '').trim()
  if (!/^\d+$/.test(raw)) return 0
  return Number(raw)
}

// ---------- 上游请求封装 ----------

export async function qqMusicRequest(
  cookie: string,
  payload: unknown,
  opts: { cookie?: boolean } = {}
): Promise<unknown> {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': String(Buffer.byteLength(body)),
  }
  // 移植自原文件 2252 行：仅当显式要求且存在 cookie 时注入。
  if (opts.cookie && cookie) headers.Cookie = cookie
  const text = await requestText(QQ_MUSICU_URL, { method: 'POST', headers }, body)
  return parseJSONText(text)
}

export async function qqGetJSON(
  cookie: string,
  targetUrl: string,
  params: Record<string, string | number | undefined> = {},
  opts: { headers?: Record<string, string>; cookie?: boolean } = {}
): Promise<unknown> {
  const u = new URL(targetUrl)
  Object.keys(params).forEach((k) => {
    if (params[k] != null) u.searchParams.set(k, String(params[k]))
  })
  const headers: Record<string, string> = { ...QQ_HEADERS, ...(opts.headers || {}) }
  // 移植自原文件 2337 行：默认注入 cookie，opts.cookie === false 时关闭。
  if (opts.cookie !== false && cookie) headers.Cookie = cookie
  const text = await requestText(u.toString(), { headers })
  return parseJSONText(text)
}

// ---------- 登录信息 ----------

export interface QQLoginInfo {
  provider: 'qq'
  loggedIn: boolean
  hasCookie?: boolean
  preview?: boolean
  userId?: string
  nickname?: string
  avatar?: string
  vipType?: number
  playbackKeyReady?: boolean
  profileSource?: string
  profileUnavailable?: boolean
  [key: string]: unknown
}

function normalizeQQProfile(cookie: string, body: unknown, cookieObj: CookieMap): QQLoginInfo {
  const uin = qqCookieUin(cookieObj)
  const b = rec(body)
  const data = rec(b.data || b.profile || b.creator || b.result)
  const creator = rec(data.creator || data.user || data.profile || data)
  const vipInfo = rec(data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo)
  const profileNick = str(
    creator.nick || creator.nickname || creator.name || creator.hostname || creator.title
  )
  const profileAvatar = str(creator.headpic || creator.avatar || creator.avatarUrl || creator.logo)
  const cookieNick = qqCookieNickname(cookieObj, uin)
  const nick = profileNick || cookieNick || ''
  const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin)
  let vipType =
    Number(
      cookieObj.vipType ||
        cookieObj.vip_type ||
        data.vipType ||
        data.vip_type ||
        data.viptype ||
        data.music_vip_level ||
        data.green_vip_level ||
        data.luxury_vip_level ||
        creator.vipType ||
        creator.vip_type ||
        creator.music_vip_level ||
        creator.green_vip_level ||
        creator.luxury_vip_level ||
        vipInfo.vipType ||
        vipInfo.vip_type ||
        vipInfo.music_vip_level ||
        vipInfo.green_vip_level ||
        vipInfo.luxury_vip_level ||
        0
    ) || 0
  if (!vipType) {
    const vipFlag =
      data.isVip ||
      data.is_vip ||
      data.vipFlag ||
      data.vipflag ||
      creator.isVip ||
      creator.is_vip ||
      vipInfo.isVip ||
      vipInfo.is_vip ||
      vipInfo.vipFlag
    if (vipFlag === true || Number(vipFlag) > 0 || String(vipFlag || '').toLowerCase() === 'true') {
      vipType = 1
    }
  }
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
    preview: false,
    userId: uin,
    nickname: nick || (uin ? 'QQ ' + uin : 'QQ 音乐'),
    avatar,
    vipType,
    hasCookie: !!cookie,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : cookieNick || avatar ? 'cookie' : 'fallback',
  }
}

export async function getQQLoginInfo(cookie: string): Promise<QQLoginInfo> {
  const cookieObj = parseCookieString(cookie)
  const uin = qqCookieUin(cookieObj)
  const musicKey = qqCookieMusicKey(cookieObj)
  if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, hasCookie: !!cookie }
  const fallback = normalizeQQProfile(cookie, null, cookieObj)
  try {
    const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')
    u.searchParams.set('cid', '205360838')
    u.searchParams.set('userid', uin)
    u.searchParams.set('reqfrom', '1')
    u.searchParams.set('g_tk', '5381')
    u.searchParams.set('loginUin', uin)
    u.searchParams.set('hostUin', '0')
    u.searchParams.set('format', 'json')
    u.searchParams.set('inCharset', 'utf8')
    u.searchParams.set('outCharset', 'utf-8')
    u.searchParams.set('notice', '0')
    u.searchParams.set('platform', 'yqq.json')
    u.searchParams.set('needNewCode', '0')
    const text = await requestText(u.toString(), {
      headers: { ...QQ_HEADERS, Cookie: cookie },
    })
    const body = rec(parseJSONText(text))
    const info = normalizeQQProfile(cookie, body, cookieObj)
    if (body && (body.code === 1000 || body.result === 301)) {
      return { ...fallback, profileUnavailable: true }
    }
    return info
  } catch (e) {
    console.warn('[QQLogin] profile check failed:', (e as Error).message)
    return { ...fallback, profileUnavailable: true }
  }
}

// ---------- 业务 handler ----------

export async function handleQQUserPlaylists(cookie: string): Promise<Record<string, unknown>> {
  const info = await getQQLoginInfo(cookie)
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] }
  const uin = info.userId
  const createdReq = qqGetJSON(
    cookie,
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
    {
      hostUin: 0,
      hostuin: uin,
      sin: 0,
      size: 200,
      g_tk: 5381,
      loginUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    { headers: { Referer: 'https://y.qq.com/portal/profile.html' } }
  )
  const collectReq = qqGetJSON(
    cookie,
    'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
    { ct: 20, cid: 205360956, userid: uin, reqtype: 3, sin: 0, ein: 80 },
    { headers: { Referer: 'https://y.qq.com/portal/profile.html' } }
  )
  const [createdRaw, collectRaw] = await Promise.allSettled([createdReq, collectReq])
  const created =
    createdRaw.status === 'fulfilled' && Array.isArray(rec(rec(createdRaw.value).data).disslist)
      ? (rec(rec(createdRaw.value).data).disslist as unknown[]).map((pl) => mapQQPlaylist(pl, 'created'))
      : []
  const collected =
    collectRaw.status === 'fulfilled' && Array.isArray(rec(rec(collectRaw.value).data).cdlist)
      ? (rec(rec(collectRaw.value).data).cdlist as unknown[]).map((pl) => mapQQPlaylist(pl, 'collect'))
      : []
  const seen = new Set<string>()
  const playlists = created
    .concat(collected)
    .filter((pl) => {
      if (!pl.id || !pl.name || seen.has(pl.id)) return false
      if (isQzoneBackgroundPlaylist(pl)) return false
      seen.add(pl.id)
      return true
    })
    .sort((a, b) => Number(b.id === QQ_LIKED_PLAYLIST_ID) - Number(a.id === QQ_LIKED_PLAYLIST_ID))
  return { loggedIn: true, provider: 'qq', userId: uin, playlists }
}

export async function handleQQRadarSong(cookie: string): Promise<Record<string, unknown>> {
  const info = await getQQLoginInfo(cookie)
  if (!info.loggedIn) return { provider: 'qq', playlist: null, tracks: [] }
  const comm = qqAuthComm(cookie)
  const seen = new Set<string>()
  const tracks: Record<string, unknown>[] = []
  // 上游按 Page 增量分页(Page1 仅 1 首"种子曲",Page2+ 每页约 10 首),循环凑够一份完整雷达歌单。
  for (let page = 1; page <= 4 && tracks.length < 30; page++) {
    let json: Record<string, unknown>
    try {
      json = rec(
        await qqMusicRequest(
          cookie,
          {
            comm,
            radar: {
              module: 'music.recommend.TrackRelationServer',
              method: 'GetRadarSong',
              param: { Page: page },
            },
          },
          { cookie: true }
        )
      )
    } catch (e) {
      console.warn('[QQRadar] batch failed:', (e as Error).message)
      break
    }
    const block = rec(json.radar)
    const data = rec(block.data)
    const rawList =
      [data.VecSongs, data.songList, data.vec_song, data.tracks, data.List, data.data]
        .map(arr)
        .find((list) => list.length) || []
    if (rawList.length === 0) break
    for (const raw of rawList) {
      const song = mapQQPlaylistTrack(rec(raw).Track || raw)
      const key = str(song.mid) || str(song.id)
      if (!key || seen.has(key) || !song.name) continue
      seen.add(key)
      tracks.push(song)
      if (tracks.length >= 30) break
    }
    if (!data.HasMore) break
  }
  if (tracks.length === 0) return { provider: 'qq', playlist: null, tracks: [] }
  const playlist = {
    provider: 'qq',
    source: 'qq',
    type: 'playlist',
    id: 'qq-radar',
    name: '私人雷达',
    cover: str(tracks[0].cover),
    trackCount: tracks.length,
    playCount: 0,
    creator: 'QQ 音乐',
  }
  return { provider: 'qq', playlist, tracks }
}

export async function handleQQRecommendFeed(cookie: string, page: number): Promise<Record<string, unknown>> {
  const from = Math.max(0, page) * 20
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      feed: {
        module: 'music.playlist.PlaylistSquare',
        method: 'GetRecommendFeed',
        param: { From: from, Size: 20 },
      },
    })
  )
  const block = rec(json.feed)
  const data = rec(block.data)
  const rawList =
    [data.content, data.List, data.v_playlist, data.playlist, data.disslist].map(arr).find((list) => list.length) ||
    []
  const playlists = rawList.map(mapQQFeedPlaylist).filter((pl) => pl.id && pl.name)
  return { provider: 'qq', playlists }
}

export async function handleQQRecommendSongs(cookie: string): Promise<Record<string, unknown>> {
  const info = await getQQLoginInfo(cookie)
  if (!info.loggedIn) return { provider: 'qq', songs: [] }
  const seen = new Set<string>()
  const songs: Record<string, unknown>[] = []
  for (let i = 0; i < 4 && songs.length < 20; i++) {
    let json: Record<string, unknown>
    try {
      json = rec(
        await qqMusicRequest(
          cookie,
          {
            comm: qqAuthComm(cookie),
            radio: {
              module: 'music.radioProxy.MbTrackRadioSvr',
              method: 'get_radio_track',
              param: {},
            },
          },
          { cookie: true }
        )
      )
    } catch (e) {
      console.warn('[QQRecommendSongs] batch failed:', (e as Error).message)
      break
    }
    const block = rec(json.radio)
    const data = rec(block.data)
    const rawList =
      [data.track, data.songList, data.vec_song, data.tracks].map(arr).find((list) => list.length) || []
    if (rawList.length === 0) break
    for (const raw of rawList) {
      const song = mapQQPlaylistTrack(raw)
      const key = str(song.mid) || str(song.id)
      if (!key || seen.has(key) || !song.name) continue
      seen.add(key)
      songs.push(song)
      if (songs.length >= 20) break
    }
  }
  return { provider: 'qq', songs }
}

const QQ_PLAYLIST_PAGE_SIZE = 100
const QQ_PLAYLIST_MAX_PAGES = 100

function qqHasLoginCookie(cookie: string): boolean {
  const cookieObj = parseCookieString(cookie)
  return !!(qqCookieUin(cookieObj) && qqCookieMusicKey(cookieObj))
}

function qqPlaylistTotal(data: Record<string, unknown>, detail: Record<string, unknown>): number {
  return numOf(
    data.total_song_num ||
    data.songlist_size ||
    data.totalNum ||
    detail.total_song_num ||
    detail.songlist_size ||
    detail.totalNum
  )
}

function qqPageHasMore(data: Record<string, unknown>, offset: number, rawCount: number, total: number): boolean {
  const marker = data.hasmore ?? data.hasMore
  if (marker !== undefined) return marker === true || Number(marker) > 0
  if (total > 0) return offset + rawCount < total
  return rawCount >= QQ_PLAYLIST_PAGE_SIZE
}

async function fetchQQDissPage(
  cookie: string,
  ref: Extract<QQPlaylistReference, { kind: 'playlist' | 'liked' }>,
  offset: number,
  num = QQ_PLAYLIST_PAGE_SIZE
): Promise<{ data: Record<string, unknown>; detail: Record<string, unknown>; rawTracks: unknown[] }> {
  const liked = ref.kind === 'liked'
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm: qqAuthComm(cookie),
        playlist: {
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: {
            disstid: liked ? 0 : ref.id,
            dirid: liked ? 201 : 0,
            tag: true,
            song_begin: offset,
            song_num: num,
            userinfo: true,
            orderlist: true,
            onlysonglist: false,
          },
        },
      },
      { cookie: true }
    )
  )
  const block = rec(json.playlist)
  if (!json.playlist || Number(block.code || 0) !== 0) {
    const code = Number(block.code || block.result || 0)
    const message = str(block.message || block.msg)
    if (
      liked
      && qqHasLoginCookie(cookie)
      && ([301, 1000, 2000].includes(code) || /auth|cookie|login|登录|未登陆|过期|失效|票据/i.test(message))
    ) {
      const error = new Error('AUTH_EXPIRED') as Error & { statusCode?: number }
      error.statusCode = 403
      throw error
    }
    throw new Error(message || 'QQ_PLAYLIST_DETAIL_FAILED')
  }
  const data = rec(block.data)
  return { data, detail: rec(data.dirinfo), rawTracks: arr(data.songlist) }
}

async function fetchQQToplistPage(
  cookie: string,
  topId: string,
  offset: number,
  num = QQ_PLAYLIST_PAGE_SIZE
): Promise<{ data: Record<string, unknown>; detail: Record<string, unknown>; rawTracks: unknown[] }> {
  if (!/^\d+$/.test(topId)) throw new Error('Invalid QQ toplist id')
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm: qqAuthComm(cookie),
        toplist: {
          module: 'music.musicToplist.Toplist',
          method: 'GetDetail',
          param: { topId: Number(topId), offset, num, withTags: true },
        },
      },
      { cookie: true }
    )
  )
  const block = rec(json.toplist)
  if (!json.toplist || Number(block.code || 0) !== 0) {
    throw new Error(str(block.message || block.msg) || 'QQ_TOPLIST_DETAIL_FAILED')
  }
  const data = rec(block.data)
  return { data, detail: rec(data.data), rawTracks: arr(data.songInfoList) }
}

function mapQQToplistPreviewTrack(raw: unknown): { name: string; artist: string } {
  const item = rec(raw)
  const song = rec(item.songInfo || item.songinfo || item)
  const artists = mapQQArtists(song.singer || song.singers)
  return {
    name: str(song.name || song.title || song.songname || item.title),
    artist: artists.map((artist) => artist.name).join(' / ')
      || str(song.singerName || song.singername || item.singerName),
  }
}

function mapQQToplistEntry(raw: unknown): Record<string, unknown> {
  const item = rec(raw)
  const topId = str(item.topId || item.topid || item.id)
  const preview = arr(item.song || item.songList || item.songlist)
    .map(mapQQToplistPreviewTrack)
    .filter((track) => track.name)
    .slice(0, 3)
  return {
    playlist: {
      provider: 'qq',
      source: 'qq',
      type: 'playlist',
      id: topId ? `${QQ_TOPLIST_PREFIX}${topId}` : '',
      name: str(item.title || item.name),
      cover: pickQQImageUrl(
        item.frontPicUrl,
        item.frontpic,
        item.headPicUrl,
        item.picUrl,
        item.toplistPic,
        item.cover
      ),
      trackCount: numOf(item.songNum || item.totalNum || item.total_song_num),
      playCount: numOf(item.listenNum || item.listen_num || item.playCount),
      creator: 'QQ 音乐',
      tag: '排行榜',
      description: plainTextDescription(item.intro || item.desc),
    },
    updateFrequency: str(item.updateTips || item.updateTime || item.period),
    preview,
  }
}

export async function handleQQToplists(cookie: string): Promise<Record<string, unknown>> {
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm: qqAuthComm(cookie),
        toplists: {
          module: 'music.musicToplist.Toplist',
          method: 'GetAll',
          param: {},
        },
      },
      { cookie: true }
    )
  )
  const block = rec(json.toplists)
  if (!json.toplists || Number(block.code || 0) !== 0) {
    throw new Error(str(block.message || block.msg || block.code) || 'QQ_TOPLISTS_FAILED')
  }
  const groups = arr(rec(block.data).group)
    .map((rawGroup) => {
      const group = rec(rawGroup)
      const entries = arr(group.toplist || group.list)
        .map(mapQQToplistEntry)
        .filter((entry) => {
          const playlist = rec(entry.playlist)
          return playlist.id && playlist.name
        })
      return {
        title: str(group.groupName || group.groupTitle || group.title || group.name) || '排行榜',
        entries,
      }
    })
    .filter((group) => group.entries.length > 0)
  return { provider: 'qq', groups }
}

export async function handleQQToplistPreview(
  cookie: string,
  id: string
): Promise<Record<string, unknown>> {
  if (!isQQToplistReference(id)) {
    return { provider: 'qq', error: 'INVALID_QQ_TOPLIST_ID', preview: [] }
  }
  const ref = qqPlaylistReference(id)
  const topId = ref.kind === 'toplist' ? ref.id : ''
  const result = await fetchQQToplistPage(cookie, topId, 0, 3)
  const preview = result.rawTracks
    .map(mapQQToplistPreviewTrack)
    .filter((track) => track.name)
    .slice(0, 3)
  return { provider: 'qq', preview }
}

export async function handleQQLikedPlaylist(cookie: string): Promise<Record<string, unknown>> {
  if (!qqHasLoginCookie(cookie)) {
    return { loggedIn: false, provider: 'qq', playlist: null }
  }
  const result = await fetchQQDissPage(cookie, { kind: 'liked', id: '201' }, 0, 1)
  const tracks = result.rawTracks
    .map(mapQQPlaylistTrack)
    .filter((track) => track.name && track.mid)
  const detail = result.detail
  return {
    loggedIn: true,
    provider: 'qq',
    playlist: {
      provider: 'qq',
      source: 'qq',
      type: 'playlist',
      id: QQ_LIKED_PLAYLIST_ID,
      name: str(detail.title || detail.name || detail.dissname || detail.diss_name) || '我喜欢的音乐',
      cover: pickQQPlaylistCover(detail, tracks),
      trackCount: qqPlaylistTotal(result.data, detail),
      playCount: numOf(detail.listen_num || detail.visitnum || detail.play_count),
      creator: str(detail.nick || detail.hostname || detail.creator) || 'QQ 音乐',
      tag: '收藏',
    },
  }
}

export async function handleQQPlaylistTracks(cookie: string, id: string): Promise<Record<string, unknown>> {
  const ref = qqPlaylistReference(id)
  const loggedIn = qqHasLoginCookie(cookie)
  if (!ref.id) {
    return { loggedIn, provider: 'qq', error: 'Missing QQ playlist id', trackIds: [], tracks: [] }
  }
  if (ref.kind === 'liked' && !loggedIn) {
    return { loggedIn: false, provider: 'qq', trackIds: [], tracks: [] }
  }

  const tracks: Record<string, unknown>[] = []
  let detail: Record<string, unknown> = {}
  let total = 0
  let offset = 0

  for (let page = 0; page < QQ_PLAYLIST_MAX_PAGES; page++) {
    const result = ref.kind === 'toplist'
      ? await fetchQQToplistPage(cookie, ref.id, offset)
      : await fetchQQDissPage(cookie, ref, offset)
    if (page === 0) detail = result.detail
    total = qqPlaylistTotal(result.data, result.detail) || total
    const mapped = result.rawTracks
      .map(ref.kind === 'toplist' ? (raw) => mapQQTrack(raw, {}) : mapQQPlaylistTrack)
      .filter((track) => track.name && track.mid)
    tracks.push(...mapped)
    const rawCount = result.rawTracks.length
    if (!rawCount || !qqPageHasMore(result.data, offset, rawCount, total)) break
    offset += rawCount
  }

  const playlistId = ref.kind === 'liked'
    ? QQ_LIKED_PLAYLIST_ID
    : ref.kind === 'toplist' ? `${QQ_TOPLIST_PREFIX}${ref.id}` : ref.id
  const playlist = {
    provider: 'qq',
    source: 'qq',
    type: ref.kind === 'toplist' ? 'toplist' : 'playlist',
    id: playlistId,
    name: str(detail.title || detail.name || detail.dissname || detail.diss_name)
      || (ref.kind === 'liked' ? '我喜欢的音乐' : ''),
    cover: pickQQPlaylistCover(detail, tracks),
    trackCount: total || tracks.length,
  }
  return {
    loggedIn,
    provider: 'qq',
    playlist,
    trackIds: tracks.map((track) => track.id),
    tracks,
  }
}

async function qqSongDetail(
  cookie: string,
  mid: string,
  fallback: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!mid) return fallback
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      songinfo: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_mid: mid },
      },
    })
  )
  const data = rec(rec(json.songinfo).data)
  return mapQQTrack(data.track_info, fallback)
}

export async function handleQQArtistDetail(
  cookie: string,
  mid: string,
  limit: number
): Promise<Record<string, unknown>> {
  const singerMid = String(mid || '').trim()
  const num = Math.max(10, Math.min(80, parseInt(String(limit || '36'), 10) || 36))
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm: { ct: 24, cv: 0 },
        singer: {
          module: 'music.web_singer_info_svr',
          method: 'get_singer_detail_info',
          param: { sort: 5, singermid: singerMid, sin: 0, num },
        },
      },
      { cookie: true }
    )
  )
  const block = rec(json.singer)
  if (!json.singer || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: (block && (block.message || block.msg || block.code)) || 'QQ_ARTIST_DETAIL_FAILED',
      artist: null,
      songs: [],
    }
  }
  const data = rec(block.data)
  const info = rec(data.singer_info || data.singerInfo)
  const rawSongs = arr(data.songlist)
  const songs = rawSongs
    .map((raw) => {
      const r = rec(raw)
      return mapQQTrack(r.track_info || r.songInfo || r.songinfo || r.song || raw, {})
    })
    .filter((song) => song && song.name && (song.mid || song.id))
  const firstArtists = songs[0] ? (songs[0].artists as QQArtist[] | undefined) : undefined
  const matchedSongArtist = firstArtists && firstArtists.find((a) => a && a.mid === singerMid)
  const artistMid = str(info.mid || info.singerMid || info.singermid) || singerMid
  const artistName = str(info.name || info.title) || (matchedSongArtist && matchedSongArtist.name) || ''
  const totalSong = numOf(data.total_song || data.song_count) || songs.length
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      source: 'qq',
      id: artistMid,
      mid: artistMid,
      qqArtistId: info.id || '',
      name: artistName,
      avatar: str(info.pic || info.avatar) || qqSingerAvatar(artistMid, 300),
      fans: numOf(info.fans),
      musicSize: totalSong,
      albumSize: numOf(data.total_album),
      mvSize: numOf(data.total_mv),
    },
    total: totalSong,
    songs,
  }
}

export async function handleQQArtistSimilar(
  cookie: string,
  mid: string,
  limit: number
): Promise<Record<string, unknown>> {
  const singerMid = String(mid || '').trim()
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artists: [] }
  const number = Math.max(1, Math.min(30, limit || 10))
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm: qqAuthComm(cookie),
        similarSinger: {
          module: 'music.SimilarSingerSvr',
          method: 'GetSimilarSingerList',
          param: { singerMid, number },
        },
      },
      { cookie: true }
    )
  )
  const block = rec(json.similarSinger)
  if (!json.similarSinger || Number(json.code || 0) !== 0 || Number(block.code || 0) !== 0) {
    throw new Error(str(block.message || block.msg) || 'QQ_ARTIST_SIMILAR_FAILED')
  }
  const seen = new Set([singerMid])
  const artists = arr(rec(block.data).singerlist || rec(block.data).singerList)
    .map((raw) => {
      const artist = rec(raw)
      const artistMid = str(artist.singerMid || artist.singerMID || artist.mid)
      return {
        provider: 'qq',
        source: 'qq',
        id: artistMid,
        mid: artistMid,
        qqArtistId: artist.singerId || artist.singerID || artist.id || '',
        name: str(artist.singerName || artist.name),
        avatar: pickQQImageUrl(artist.singerPic, artist.pic, artist.avatar)
          || qqSingerAvatar(artistMid, 300),
      }
    })
    .filter((artist) => {
      if (!artist.mid || !artist.name || seen.has(artist.mid)) return false
      seen.add(artist.mid)
      return true
    })
  return { provider: 'qq', artists }
}

// ---------- 业务: 歌手搜索 / 相似歌手 / 歌手歌曲 / 歌手专辑 ----------

interface QQArtistSearchResult {
  provider: 'qq'
  id: string
  mid: string
  qqArtistId: unknown
  name: string
  avatar: string
  musicSize: number
}

export async function handleQQArtistSearch(
  cookie: string,
  keywords: string,
  limit: number
): Promise<QQArtistSearchResult[]> {
  const kw = String(keywords || '').trim()
  if (!kw) return []
  const num = Math.max(1, Math.min(limit || 5, 10))
  // 该模块要求信封 key 与 module 同名(且不能带顶层 comm),与本文件其余接口的 req_1/自定义 key 约定不同,已实测确认。
  const json = rec(
    await qqMusicRequest(cookie, {
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: { search_type: 1, query: kw, page_num: 1, num_per_page: num },
      },
    })
  )
  const block = rec(json['music.search.SearchCgiService'])
  const list = arr(rec(rec(rec(block.data).body).singer).list)
  return list
    .map((raw) => {
      const s = rec(raw)
      const mid = str(s.singerMID || s.singermid)
      return {
        provider: 'qq' as const,
        id: mid,
        mid,
        qqArtistId: s.singerID || s.singerId || '',
        name: str(s.singerName),
        avatar: str(s.singerPic) || qqSingerAvatar(mid, 300),
        musicSize: numOf(s.songNum),
      }
    })
    .filter((a) => a.name && a.mid)
}

export async function handleQQArtistSongs(
  cookie: string,
  mid: string,
  limit: number,
  offset: number
): Promise<Record<string, unknown>> {
  const singerMid = String(mid || '').trim()
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', songs: [] }
  const num = Math.max(1, Math.min(100, limit || 30))
  const begin = Math.max(0, offset || 0)
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      singerSongList: {
        module: 'musichall.song_list_server',
        method: 'GetSingerSongList',
        param: { singerMid, order: 1, begin, num },
      },
    })
  )
  const block = rec(json.singerSongList)
  if (!json.singerSongList || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: str(block.message || block.msg) || 'QQ_ARTIST_SONGS_FAILED',
      songs: [],
    }
  }
  const data = rec(block.data)
  const songs = arr(data.songList)
    .map((raw) => mapQQTrack(rec(raw).songInfo, {}))
    .filter((s) => s && s.name && (s.mid || s.id))
  return { provider: 'qq', total: numOf(data.totalNum) || songs.length, songs }
}

function mapQQAlbum(raw: unknown): Record<string, unknown> {
  const a = rec(raw)
  const albumMid = str(a.albumMid)
  return {
    provider: 'qq',
    source: 'qq',
    type: 'album',
    id: albumMid,
    name: str(a.albumName),
    cover: qqAlbumCover(albumMid, 300),
    trackCount: numOf(a.totalNum),
    playCount: 0,
    creator: str(a.singerName),
    tag: '专辑',
    description: str(a.albumTranName),
  }
}

export async function handleQQAlbumDetail(
  cookie: string,
  albumMid: string
): Promise<Record<string, unknown>> {
  const mid = String(albumMid || '').trim()
  if (!mid) return { provider: 'qq', error: 'MISSING_ALBUM_MID', playlist: null }
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: qqAuthComm(cookie),
      albumInfo: {
        module: 'music.musichallAlbum.AlbumInfoServer',
        method: 'GetAlbumDetail',
        param: { albumMId: mid },
      },
    })
  )
  const block = rec(json.albumInfo)
  if (!json.albumInfo || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: str(block.message || block.msg) || 'QQ_ALBUM_DETAIL_FAILED',
      playlist: null,
    }
  }
  const data = rec(block.data)
  const basic = rec(data.basicInfo)
  if (Object.keys(basic).length === 0) {
    return { provider: 'qq', error: 'QQ_ALBUM_DETAIL_FAILED', playlist: null }
  }
  const company = rec(data.company)
  const artists = mapQQArtists(rec(data.singer).singerList)
  const resolvedMid = str(basic.albumMid || basic.mid) || mid
  const publishDate = str(basic.publishDate || basic.publish_date || basic.time_public)
  const companyName = str(company.name)
  return {
    provider: 'qq',
    playlist: {
      provider: 'qq',
      source: 'qq',
      type: 'album',
      id: resolvedMid,
      qqAlbumId: basic.albumID || basic.albumId || basic.id || '',
      name: str(basic.albumName || basic.name || basic.title),
      cover: qqAlbumCover(resolvedMid, 300),
      // AlbumInfo 没有可靠的曲目数，详情页使用 AlbumSongList 的实际列表长度。
      trackCount: 0,
      playCount: 0,
      creator: artists.map((artist) => artist.name).join(' / '),
      tag: [publishDate, companyName].filter(Boolean).join(' · '),
      description: str(basic.desc || basic.description || basic.intro),
    },
  }
}

export async function handleQQArtistAlbums(
  cookie: string,
  mid: string,
  limit: number,
  offset: number
): Promise<Record<string, unknown>> {
  const singerMid = String(mid || '').trim()
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', albums: [] }
  const num = Math.max(1, Math.min(80, limit || 30))
  const begin = Math.max(0, offset || 0)
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      singerAlbum: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: { singerMid, order: 1, begin, num },
      },
    })
  )
  const block = rec(json.singerAlbum)
  if (!json.singerAlbum || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: str(block.message || block.msg) || 'QQ_ARTIST_ALBUMS_FAILED',
      albums: [],
    }
  }
  const data = rec(block.data)
  const albums = arr(data.albumList).map(mapQQAlbum).filter((a) => a.id && a.name)
  return { provider: 'qq', albums }
}

export async function handleQQAlbumSongs(cookie: string, albumMid: string): Promise<Record<string, unknown>> {
  const mid = String(albumMid || '').trim()
  if (!mid) return { provider: 'qq', error: 'MISSING_ALBUM_MID', songs: [] }
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      albumSongs: {
        module: 'music.musichallAlbum.AlbumSongList',
        method: 'GetAlbumSongList',
        // 专辑曲目一次拉全(专辑规模小,300 足够覆盖合集类)
        param: { albumMid: mid, begin: 0, num: 300, order: 2 },
      },
    })
  )
  const block = rec(json.albumSongs)
  if (!json.albumSongs || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: str(block.message || block.msg) || 'QQ_ALBUM_SONGS_FAILED',
      songs: [],
    }
  }
  const data = rec(block.data)
  const songs = arr(data.songList)
    .map((raw) => mapQQTrack(rec(raw).songInfo, {}))
    .filter((s) => s && s.name && (s.mid || s.id))
  return { provider: 'qq', total: numOf(data.totalNum) || songs.length, songs }
}

/** 相关内容只接受真实数字 ID，不能把歌曲 MID 中的数字拼成 ID。 */
export function parseQQRelatedId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function requestQQRelated(method: string, songId: number, params: Record<string, unknown> = {}) {
  if (parseQQRelatedId(songId) === null) throw new Error('INVALID_QQ_SONG_ID')
  const json = rec(await qqMusicRequest('', {
    comm: { ct: 24, cv: 0, format: 'json', uin: '0' },
    related: { module: 'music.recommend.TrackRelationServer', method, param: { songid: songId, ...params } },
  }))
  const block = rec(json.related)
  const data = rec(block.data)
  if (!json.related || Number(json.code || 0) !== 0
    || Number(block.code || 0) !== 0 || Number(data.retcode || 0) !== 0) {
    throw new Error('QQ_RELATED_CONTENT_FAILED')
  }
  return data
}

export async function handleQQSimilarSongs(songId: number): Promise<Record<string, unknown>[]> {
  const data = await requestQQRelated('GetSimilarSongs', songId)
  const raw = [
    ...arr(data.vecSong),
    ...arr(data.vecSongNew).flatMap((group) => arr(rec(group).songs)),
  ]
  const seen = new Set<string>()
  return raw.map((item) => mapQQTrack(rec(item).track || item, {})).filter((track) => {
    const id = str(track.id)
    if (!id || !track.name || Number(track.qqId) === songId || seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, 10)
}

export async function handleQQRelatedPlaylists(
  songId: number, previousIds: number[] = []
): Promise<{ playlists: Record<string, unknown>[]; hasMore: boolean }> {
  if (previousIds.length > 30 || previousIds.some((id) => parseQQRelatedId(id) === null)) {
    throw new Error('INVALID_QQ_PLAYLIST_IDS')
  }
  const data = await requestQQRelated('GetRelatedPlaylist', songId, { vecPlaylist: [...new Set(previousIds)] })
  const seen = new Set(previousIds.map(String))
  const playlists = [
    ...arr(data.vecPlaylist),
    ...arr(data.vecPlaylistNew).flatMap((group) => arr(rec(group).playlists)),
  ].map((raw) => {
    const item = rec(raw)
    return {
      ...mapQQPlaylist({ ...item, song_cnt: item.songNum, listen_num: item.playCnt }, 'related'),
      type: 'playlist',
    }
  }).filter((playlist) => {
    if (parseQQRelatedId(playlist.id) === null || !playlist.name || seen.has(playlist.id)) return false
    seen.add(playlist.id)
    return true
  }).slice(0, 30)
  return { playlists, hasMore: Number(data.hasMore) === 1 && playlists.length > 0 }
}

/** 公开热搜仅作快捷填词，不透传登录凭据或上游跳转指令。 */
export async function handleQQSearchHotkeys(): Promise<string[]> {
  const json = rec(await qqMusicRequest('', {
    comm: { ct: 24, cv: 0, format: 'json', uin: '0' },
    hotkeys: {
      module: 'music.musicsearch.HotkeyService',
      method: 'GetHotkeyForQQMusicMobile',
      param: { search_id: `${Date.now()}${Math.floor(Math.random() * 1e6)}` },
    },
  }))
  const block = rec(json.hotkeys)
  const data = rec(block.data)
  if (!json.hotkeys || Number(json.code || 0) !== 0
    || Number(block.code || 0) !== 0 || Number(data.ret_code || 0) !== 0) {
    throw new Error('QQ_SEARCH_HOTKEYS_FAILED')
  }
  const keywords = arr(data.vec_hotkey).map((raw) => {
    const item = rec(raw)
    return typeof item.query === 'string' ? item.query.trim() : ''
  }).filter(Boolean)
  return [...new Set(keywords)].slice(0, 10)
}

export async function handleQQSearch(
  cookie: string,
  keywords: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  const kw = String(keywords || '').trim()
  if (!kw) return []
  const num = Math.max(1, Math.min(20, parseInt(String(limit || '20'), 10) || 20))
  console.log('[QQSearch]', kw, 'limit:', num)
  const module = 'music.search.SearchCgiService'
  // 该模块要求信封 key 与 module 同名，且不能附加顶层 comm；否则 Web 通道可能返回空结果。
  const json = rec(
    await qqMusicRequest(cookie, {
      [module]: {
        module,
        method: 'DoSearchForQQMusicDesktop',
        param: { search_type: 0, query: kw, page_num: 1, num_per_page: num },
      },
    })
  )
  const block = rec(json[module])
  if (!json[module] || Number(block.code || 0) !== 0) {
    throw new Error(str(block.message || block.msg || block.code) || 'QQ_SEARCH_FAILED')
  }
  const list = arr(rec(rec(rec(block.data).body).song).list)
  const mapped = list
    .map((raw) => mapQQTrack(raw, {}))
    .filter((song) => song.name && song.mid)
  const seen = new Set<string>()
  return mapped.filter((song) => {
    const mid = str(song.mid)
    if (seen.has(mid)) return false
    seen.add(mid)
    return true
  })
}

export async function handleQQSongUrl(
  cookie: string,
  mid: string,
  mediaMid: string,
  qualityPreference: string,
  feeHint?: unknown
): Promise<Record<string, unknown>> {
  const isFeeSong = feeHint === true || feeHint === '1' || Number(feeHint) === 1
  const songmid = String(mid || '').trim()
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' }
  const guid = String(10000000 + Math.floor(Math.random() * 90000000))
  const cookieObj = parseCookieString(cookie)
  const uin = qqCookieUin(cookieObj) || '0'
  const musicKey = qqCookieMusicKey(cookieObj)
  const playbackKey = qqCookiePlaybackKey(cookieObj)
  const fileMediaMid = String(mediaMid || '').trim()
  const requestedQuality = normalizeQualityPreference(qualityPreference)
  const mediaIds: string[] = []
  if (fileMediaMid) mediaIds.push(fileMediaMid)
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid)
  const fileCandidates = mediaIds.flatMap((mediaId) =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES).map((item) => ({
      ...item,
      mediaId,
      filename: item.prefix + mediaId + item.ext,
    }))
  )
  const filenames = fileCandidates.map((item) => item.filename)
  const param: {
    guid: string
    songmid: string[]
    songtype: number[]
    uin: string
    loginflag: number
    platform: string
    filename?: string[]
  } = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  }
  if (filenames.length) param.filename = filenames
  const comm: { uin: string; format: string; ct: number; cv: number; authst?: string } = {
    uin,
    format: 'json',
    ct: musicKey ? 19 : 24,
    cv: 0,
  }
  if (musicKey) comm.authst = musicKey
  const json = rec(
    await qqMusicRequest(
      cookie,
      {
        comm,
        req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param },
      },
      { cookie: true }
    )
  )
  const data = rec(rec(json.req_0).data)
  const infos = arr(data.midurlinfo)
  const playableInfos = infos
    .map((item) => rec(item))
    .filter((item) => item.purl)
    .sort((a, b) => {
      const aIndex = fileCandidates.findIndex((candidate) => candidate.filename === a.filename)
      const bIndex = fileCandidates.findIndex((candidate) => candidate.filename === b.filename)
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex)
    })
  const info = (playableInfos[0] || infos[0]) as Record<string, unknown> | undefined
  const purl = info ? info.purl : undefined
  if (info && purl) {
    const sips = arr(data.sip).map(str).filter(Boolean)
    if (sips.length === 0) sips.push('https://ws.stream.qqmusic.qq.com/')
    const fileMeta = fileCandidates.find((item) => item.filename === info.filename) || ({} as Partial<QualityTemplate & { filename: string }>)
    const seenUrls = new Set<string>()
    const candidates = playableInfos.flatMap((playable) => {
      const meta = fileCandidates.find((item) => item.filename === playable.filename) || ({} as Partial<QualityTemplate & { filename: string }>)
      return sips.flatMap((sip) => {
        const url = sip + str(playable.purl)
        if (!url || seenUrls.has(url)) return []
        seenUrls.add(url)
        return [{
          url,
          trial: false,
          level: meta.level || str(playable.filename),
          quality: meta.label || str(playable.filename),
          filename: str(playable.filename),
        }]
      })
    })
    return {
      provider: 'qq',
      url: sips[0] + purl,
      trial: false,
      playable: true,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      candidates,
      requestedQuality,
    }
  }
  const restriction = classifyQQPlaybackRestriction(
    info,
    {
      hasSession: !!(uin && musicKey),
      hasPlaybackKey: !!(uin && playbackKey),
    },
    isFeeSong
  )
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map((item) => item.label + ' · ' + item.filename),
    requestedQuality,
  }
}

/**
 * 探测单曲实际可得的音质档:一次 vkey 请求带上全部候选 filename,
 * 有 purl 的档即真实存在(游客/无 VIP 时上游只对可播档发 purl)。
 */
export async function handleQQSongQualities(
  cookie: string,
  mid: string,
  mediaMid: string
): Promise<{ qualities: { level: string; label: string }[] }> {
  const songmid = String(mid || '').trim()
  if (!songmid) return { qualities: [] }
  const guid = String(10000000 + Math.floor(Math.random() * 90000000))
  const cookieObj = parseCookieString(cookie)
  const uin = qqCookieUin(cookieObj) || '0'
  const musicKey = qqCookieMusicKey(cookieObj)
  const fileMediaMid = String(mediaMid || '').trim()
  const mediaIds: string[] = []
  if (fileMediaMid) mediaIds.push(fileMediaMid)
  if (!mediaIds.includes(songmid)) mediaIds.push(songmid)
  const fileCandidates = mediaIds.flatMap((mediaId) =>
    QQ_QUALITY_CANDIDATE_TEMPLATES.map((item) => ({ ...item, filename: item.prefix + mediaId + item.ext }))
  )
  const filenames = fileCandidates.map((item) => item.filename)
  const param = {
    guid,
    songmid: filenames.map(() => songmid),
    songtype: filenames.map(() => 0),
    uin,
    loginflag: 1,
    platform: '20',
    filename: filenames,
  }
  const comm: { uin: string; format: string; ct: number; cv: number; authst?: string } = {
    uin,
    format: 'json',
    ct: musicKey ? 19 : 24,
    cv: 0,
  }
  if (musicKey) comm.authst = musicKey
  const json = rec(
    await qqMusicRequest(
      cookie,
      { comm, req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param } },
      { cookie: true }
    )
  )
  const infos = arr(rec(rec(json.req_0).data).midurlinfo)
  const okFiles = new Set(
    infos.filter((item) => rec(item).purl).map((item) => str(rec(item).filename))
  )
  const seen = new Set<string>()
  const qualities: { level: string; label: string }[] = []
  for (const c of fileCandidates) {
    if (!okFiles.has(c.filename) || seen.has(c.level)) continue
    seen.add(c.level)
    qualities.push({ level: c.level, label: c.label })
  }
  return { qualities }
}

export async function handleQQSongComments(
  cookie: string,
  id: string,
  mid: string,
  limit: number,
  offset: number
): Promise<Record<string, unknown>> {
  let topid = String(id || '').replace(/\D/g, '')
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(cookie, mid, { mid })
      topid = String(detail.qqId || detail.id || '').replace(/\D/g, '')
    } catch (e) {
      console.warn('[QQComments] detail fallback failed:', (e as Error).message)
    }
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] }
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)))
  const uin = qqCookieUin(parseCookieString(cookie)) || '0'
  const body = rec(
    await qqGetJSON(
      cookie,
      'https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg',
      {
        g_tk: '5381',
        loginUin: uin,
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
        cid: '205360772',
        reqtype: '2',
        biztype: '1',
        topid,
        cmd: '8',
        needmusiccrit: '0',
        pagenum: String(page),
        pagesize: String(limit || 20),
      },
      { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } }
    )
  )
  const hotList = rec(body.hot_comment).commentlist
  const normalList = rec(body.comment).commentlist
  const raw = offset === 0 && Array.isArray(hotList) && hotList.length ? hotList : (Array.isArray(normalList) ? normalList : [])
  const comments = arr(raw).map(mapQQComment).filter((c) => c.content)
  const commentRec = rec(body.comment)
  const total = numOf(commentRec.commenttotal || commentRec.comment_total) || comments.length
  return {
    provider: 'qq',
    id: topid,
    total,
    comments,
    hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length),
  }
}

export async function handleQQLyric(cookie: string, mid: string, id: string): Promise<Record<string, unknown>> {
  const songMID = String(mid || '').trim()
  const songID = normalizeQQSongId(id)
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }

  let lyricText = ''
  let transText = ''
  let qrcText = ''
  let romaText = ''
  let source = 'qq-musicu'

  try {
    const param: { songMID?: string; songID?: number } = {}
    if (songMID) param.songMID = songMID
    if (songID) param.songID = songID
    const json = rec(
      await qqMusicRequest(
        cookie,
        {
          comm: { ct: 24, cv: 0 },
          lyric: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param,
          },
        },
        { cookie: true }
      )
    )
    const data = rec(rec(json.lyric).data)
    lyricText = decodeQQLyricText(data.lyric)
    transText = decodeQQLyricText(data.trans)
    qrcText = decodeQQLyricText(data.qrc)
    romaText = decodeQQLyricText(data.roma)
  } catch (e) {
    console.warn('[QQLyric] musicu failed:', (e as Error).message)
  }

  if (!lyricText && songMID) {
    try {
      const body = rec(
        await qqGetJSON(
          cookie,
          'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
          {
            songmid: songMID,
            songtype: '0',
            format: 'json',
            nobase64: '1',
            g_tk: '5381',
            loginUin: qqCookieUin(parseCookieString(cookie)) || '0',
            hostUin: '0',
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: '0',
            platform: 'yqq.json',
            needNewCode: '0',
          },
          { headers: { Referer: 'https://y.qq.com/portal/player.html' } }
        )
      )
      lyricText = decodeQQLyricText(body.lyric)
      transText = decodeQQLyricText(body.trans || body.tlyric) || transText
      source = 'qq-legacy'
    } catch (e) {
      console.warn('[QQLyric] legacy failed:', (e as Error).message)
    }
  }

  return {
    provider: 'qq',
    id: songID || '',
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    qrc: qrcText,
    roma: romaText,
    source: lyricText ? source : 'qq-empty',
  }
}

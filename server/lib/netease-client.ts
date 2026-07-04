import * as NCM from 'NeteaseCloudMusicApi'
import type { ServerContext } from '../types'
import { getCookie, clearCookie } from './cookie'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ---------- NeteaseCloudMusicApi 调用封装 ----------
// NCM 的响应 body 带索引签名，统一视为 Record<string, unknown> 处理。
export interface NcmResponse {
  status: number
  body: Record<string, unknown>
  cookie: string[]
}
type NcmParams = Record<string, unknown>
type NcmFn = (params: NcmParams) => Promise<NcmResponse>

// NeteaseCloudMusicApi 是 CommonJS 包：ESM 下 `import * as NCM` 会把接口函数
// 放在 `NCM.default` 上，命名空间本身只有 default/get。这里统一解包到接口表。
const ncmNs = NCM as unknown as Record<string, unknown>
const ncmTable = (ncmNs.default as Record<string, unknown> | undefined) ?? ncmNs

/** 与原项目 `typeof fn === 'function'` 等价的可用性探测。 */
export function has(name: string): boolean {
  return typeof ncmTable[name] === 'function'
}

/** 调用 NCM 接口；未导出时抛错（仅用于必然存在的接口）。 */
export function call(name: string, params: NcmParams): Promise<NcmResponse> {
  const fn = ncmTable[name]
  if (typeof fn !== 'function') throw new Error(`${name} not available`)
  return (fn as NcmFn)(params)
}

// ---------- 通用取值收窄 ----------
export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
export function asObj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {}
}
export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
export function asStr(v: unknown): string {
  return v == null ? '' : String(v)
}
export function asNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------- Cookie 规范化 ----------
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
export function parseCookieString(cookieText: unknown): Record<string, string> {
  const out: Record<string, string> = {}
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
export function readCookieFromResponse(resp: unknown): string {
  const r = asObj(resp)
  const body = asObj(r.body)
  const data = asObj(body.data)
  const candidates: unknown[] = [r.cookie, body.cookie, data.cookie, data.cookies]
  for (const candidate of candidates) {
    const cookie = normalizeCookieHeader(candidate)
    if (cookie) return cookie
  }
  return ''
}

// ---------- API code/message 归一 ----------
export function normalizeApiCode(payload: unknown): number {
  const p = asObj(payload)
  const body = isObj(p.body) ? p.body : p
  const inner = asObj(body.body)
  return Number(asNum(body.code) || asNum(inner.code) || asNum(p.status) || 0)
}
export function normalizeApiMessage(payload: unknown): string {
  const p = asObj(payload)
  const body = isObj(p.body) ? p.body : p
  const inner = asObj(body.body)
  return (
    asStr(body.message || body.msg || body.error) ||
    asStr(inner.message || inner.msg || inner.error) ||
    ''
  )
}

// ---------- 业务: 数据映射 ----------
export interface MappedArtist {
  id: unknown
  name: string
}
export function mapArtists(raw: unknown): MappedArtist[] {
  return asArr(raw)
    .map((a) => {
      const o = asObj(a)
      return { id: o.id, name: asStr(o.name) }
    })
    .filter((a) => a.name)
}

export interface MappedSong {
  provider: string
  source: string
  type: string
  id: unknown
  name: unknown
  artist: string
  artists: MappedArtist[]
  artistId: unknown
  album: string
  cover: string
  duration: number
  fee: unknown
}
export function mapSongRecord(song: unknown): MappedSong {
  const s = asObj(song)
  const artists = mapArtists(s.ar ?? s.artists)
  const album = asObj(s.al ?? s.album)
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map((a) => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: asStr(album.name),
    cover: asStr(album.picUrl || album.coverUrl),
    duration: asNum(s.dt || s.duration),
    fee: s.fee,
  }
}

export interface MappedPlaylist {
  provider: string
  source: string
  type: string
  id: unknown
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator: string
  tag: string
  description: string
}
export function mapDiscoverPlaylist(playlist: unknown, tag?: string): MappedPlaylist {
  const pl = asObj(playlist)
  const creator = asObj(pl.creator || pl.user)
  const id = pl.id || pl.resourceId || pl.creativeId
  const uiImage = asObj(asObj(pl.uiElement).image)
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: asStr(pl.name || pl.title),
    cover: asStr(pl.picUrl || pl.coverImgUrl || pl.coverUrl || uiImage.imageUrl),
    trackCount: asNum(pl.trackCount || pl.songCount || pl.programCount),
    playCount: asNum(pl.playCount || pl.playcount),
    creator: asStr(creator.nickname || creator.name),
    tag: tag || asStr(pl.alg),
    description: asStr(pl.copywriter || pl.description),
  }
}

export interface MappedPodcastRadio {
  id: unknown
  rid: unknown
  name: string
  cover: string
  desc: string
  djName: string
  category: string
  programCount: number
  subCount: number
}
export function mapPodcastRadio(radio: unknown): MappedPodcastRadio {
  const r = asObj(radio)
  const dj = asObj(r.dj || r.djSimple || r.djUser || r.creator)
  const id = r.id || r.rid || r.radioId
  return {
    id,
    rid: id,
    name: asStr(r.name || r.radioName),
    cover: asStr(r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl),
    desc: asStr(r.desc || r.description || r.rcmdText),
    djName: asStr(dj.nickname || r.djName || r.nickname),
    category: asStr(r.category || r.categoryName),
    programCount: asNum(r.programCount || r.programNum || r.programCnt),
    subCount: asNum(r.subCount || r.subedCount || r.subscriberCount),
  }
}

function lowSignalText(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}
export function isLowSignalPodcastItem(item: unknown): boolean {
  const o = asObj(item)
  const name = lowSignalText(o.name || o.title || o.radioName)
  const sub = lowSignalText(o.djName || o.category || o.desc || o.sub)
  const text = name + ' ' + sub
  return /购买播客|付费精品|qzone|空间背景音乐|背景音乐|四只烤翅|试纸烤翅/i.test(text)
}

// ---------- 音频/封面代理 header ----------
export function audioProxyHeadersFor(audioUrl: string, range: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: 'https://music.163.com/' }
  try {
    const host = new URL(audioUrl).hostname.toLowerCase()
    if (host.includes('qq.com') || host.includes('qpic.cn')) headers.Referer = 'https://y.qq.com/'
  } catch {
    /* ignore */
  }
  if (range) headers.Range = range
  return headers
}
export function audioContentTypeForUrl(audioUrl: string, upstreamType: string | null): string {
  let pathname = ''
  try {
    pathname = new URL(audioUrl).pathname.toLowerCase()
  } catch {
    /* ignore */
  }
  if (/\.flac$/.test(pathname)) return 'audio/flac'
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg'
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4'
  if (/\.ogg$/.test(pathname)) return 'audio/ogg'
  if (/\.wav$/.test(pathname)) return 'audio/wav'
  return upstreamType || 'audio/mpeg'
}

// ---------- 音质偏好 / 播放限制 ----------
export interface PlaybackRestriction {
  provider: string
  category: string
  action: string
  message: string
  [k: string]: unknown
}
export function playbackRestriction(
  provider: string,
  category: string,
  message: string,
  action?: string,
  extra?: Record<string, unknown>
): PlaybackRestriction {
  return { provider, category, action: action || '', message, ...(extra || {}) }
}
export function classifyNeteasePlaybackRestriction(
  lastData: unknown,
  loginInfo: LoginInfo | null
): PlaybackRestriction {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn)
  const d = asObj(lastData)
  const fee = Number(d.fee)
  const code = Number(d.code)
  const freeTrial = d.freeTrialInfo
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee })
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee })
  }
  if (fee === 1) {
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee })
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee })
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee })
  }
  return playbackRestriction(
    'netease',
    'url_unavailable',
    '网易云没有返回可播放地址，可能是版权、会员或地区限制',
    loggedIn ? 'switch_source' : 'login',
    { code, fee }
  )
}

interface QualityCandidate {
  level: string
  br: number
  label: string
  svip?: boolean
}
const NETEASE_QUALITY_CANDIDATES: QualityCandidate[] = [
  { level: 'jymaster', br: 1999000, label: '超清母带', svip: true },
  { level: 'hires', br: 1999000, label: '高清臻音' },
  { level: 'lossless', br: 1411000, label: '无损' },
  { level: 'exhigh', br: 999000, label: '极高' },
  { level: 'standard', br: 128000, label: '标准' },
]
export function normalizeQualityPreference(value: unknown): string {
  const raw = String(value || '').toLowerCase().trim()
  if (['jymaster', 'master', 'studio', 'svip'].includes(raw)) return 'jymaster'
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires'
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless'
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh'
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard'
  return 'hires'
}
function qualityCandidatesFrom(target: string, candidates: QualityCandidate[]): QualityCandidate[] {
  const t = normalizeQualityPreference(target)
  let start = candidates.findIndex((item) => item.level === t)
  if (start < 0) start = 0
  return candidates.slice(start)
}
export function hasNeteaseSvip(loginInfo: LoginInfo | null): boolean {
  return !!(
    loginInfo &&
    loginInfo.loggedIn &&
    (loginInfo.vipLevel === 'svip' || loginInfo.isSvip || Number(loginInfo.vipType || 0) >= 10)
  )
}

// ---------- 登录态 / 用户信息 ----------
export interface VipInfo {
  vipType: number
  vipLevel: string
  isVip: boolean
  isSvip: boolean
  vipLabel: string
}
export interface LoginInfo extends Partial<VipInfo> {
  loggedIn: boolean
  userId?: string | number
  nickname?: string
  avatar?: string
  hasCookie?: boolean
  pendingProfile?: boolean
}

function firstPositiveNumberFrom(objects: unknown[], keys: string[]): number {
  for (const obj of objects) {
    if (!isObj(obj)) continue
    for (const key of keys) {
      const value = Number(obj[key])
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return 0
}
function collectStringValues(value: unknown, out: string[], depth: number): string[] {
  if (depth > 4 || value == null) return out
  if (typeof value === 'string') {
    if (value) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, out, depth + 1))
    return out
  }
  if (typeof value === 'object') {
    Object.keys(value as Record<string, unknown>).forEach((key) =>
      collectStringValues((value as Record<string, unknown>)[key], out, depth + 1)
    )
  }
  return out
}
function collectVipStringValues(value: unknown, out: string[], depth: number): string[] {
  if (depth > 4 || value == null) return out
  if (Array.isArray(value)) {
    value.forEach((item) => collectVipStringValues(item, out, depth + 1))
    return out
  }
  if (typeof value !== 'object') return out
  const obj = value as Record<string, unknown>
  Object.keys(obj).forEach((key) => {
    const child = obj[key]
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type/i.test(key)) {
      collectStringValues(child, out, depth + 1)
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1)
    }
  })
  return out
}
function normalizeNeteaseVip(profile: unknown, account: unknown, extra: unknown): VipInfo {
  const p = asObj(profile)
  const a = asObj(account)
  const e = asObj(extra)
  const vipInfo = asObj(p.vipInfo || p.vipinfo || a.vipInfo || a.vipinfo || e.vipInfo || e.vipinfo)
  const objects = [a, p, vipInfo, e]
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'redVipLevel', 'red_vip_level',
    'blackVipLevel', 'black_vip_level', 'luxuryVipLevel', 'luxury_vip_level',
    'svipType', 'svip_type',
  ])
  const text = collectVipStringValues({ account: a, profile: p, vipInfo, extra: e }, [], 0)
    .join(' ')
    .toLowerCase()
  const svipFlag =
    objects.some(
      (obj) =>
        obj.isSvip === true ||
        obj.is_svip === true ||
        obj.svip === true ||
        Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || 0) > 0
    ) || /svip|supervip|super_vip|blackvip|black_vip|黑胶svip|超级会员/.test(text)
  const vipFlag =
    objects.some(
      (obj) =>
        obj.isVip === true ||
        obj.is_vip === true ||
        obj.vip === true ||
        Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
    ) || /vip|黑胶|会员/.test(text)
  const isSvip = svipFlag || vipType >= 10
  const isVip = isSvip || vipFlag || vipType > 0
  const vipLevel = isSvip ? 'svip' : isVip ? 'vip' : 'none'
  return {
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : vipLevel === 'vip' ? 'VIP' : '无VIP',
  }
}
export function normalizeLoginInfo(profile: unknown, account: unknown, extra: unknown): LoginInfo {
  const p = asObj(profile)
  const a = asObj(account)
  const userId = p.userId || p.user_id || p.id || a.userId || a.id || ''
  if (!(userId || userId === 0)) return { loggedIn: false }
  const vip = normalizeNeteaseVip(p, a, extra)
  return {
    loggedIn: true,
    userId: userId as string | number,
    nickname: asStr(p.nickname || p.userName) || '网易云用户',
    avatar: asStr(p.avatarUrl || p.avatar),
    ...vip,
  }
}
function isNeteaseAuthInvalidPayload(payload: unknown): boolean {
  const code = normalizeApiCode(payload)
  if (code === 301 || code === 401) return true
  const msg = normalizeApiMessage(payload)
  return /未登录|需要登录|请先登录|login/i.test(msg) && code >= 300
}

const LOGGED_OUT: LoginInfo = {
  loggedIn: false,
  vipType: 0,
  vipLevel: 'none',
  isVip: false,
  isSvip: false,
  vipLabel: '无VIP',
}

export async function getLoginInfo(ctx: ServerContext): Promise<LoginInfo> {
  const cookie = getCookie(ctx, 'netease')
  if (!cookie) return { ...LOGGED_OUT }

  // login_status 对二维码 cookie 的资料刷新通常更及时；失败时再降级到 user_account。
  try {
    const st = await call('login_status', { cookie, timestamp: Date.now() })
    const body = asObj(st.body)
    const data = isObj(body.data) ? body.data : body
    const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account, data)
    if (info.loggedIn) return info
  } catch (e) {
    console.warn('[Login] login_status failed:', (e as Error).message)
  }

  try {
    const acc = await call('user_account', { cookie, timestamp: Date.now() })
    const body = asObj(acc.body)
    const info = normalizeLoginInfo(body.profile, body.account, body)
    if (info.loggedIn) return info
    if (isNeteaseAuthInvalidPayload(acc)) clearCookie(ctx, 'netease')
    return { ...LOGGED_OUT, hasCookie: !!getCookie(ctx, 'netease') }
  } catch (e) {
    console.warn('[Login] account check failed:', (e as Error).message)
    return { ...LOGGED_OUT, hasCookie: !!cookie }
  }
}

export async function requireLogin(
  res: import('node:http').ServerResponse,
  ctx: ServerContext,
  sendJson: (res: import('node:http').ServerResponse, data: unknown, status?: number) => void
): Promise<LoginInfo | null> {
  const info = await getLoginInfo(ctx)
  if (!info.loggedIn || !info.userId) {
    sendJson(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401)
    return null
  }
  return info
}

// ---------- 业务: 搜索 ----------

export interface ArtistSearchResult {
  id: unknown
  name: string
  avatar: string
  musicSize: number
}

export async function handleArtistSearch(keywords: string, limit: number, cookie: string): Promise<ArtistSearchResult[]> {
  console.log('[ArtistSearch]', keywords, 'limit:', limit)
  const result = await call('cloudsearch', { keywords, limit, type: 100, cookie })
  const artists = asArr(asObj(asObj(result.body).result).artists)
  return artists
    .map((a) => {
      const obj = asObj(a)
      return {
        id: obj.id,
        name: asStr(obj.name),
        avatar: asStr(obj.picUrl || obj.img1v1Url),
        musicSize: asNum(obj.musicSize || obj.songSize || 0),
      }
    })
    .filter((a) => a.name)
    .slice(0, Math.max(1, Math.min(limit, 5)))
}

export async function handleSearch(keywords: string, limit: number, cookie: string): Promise<MappedSong[]> {
  console.log('[Search]', keywords, 'limit:', limit)
  const result = await call('cloudsearch', { keywords, limit, cookie })
  const songs = asArr(asObj(asObj(result.body).result).songs)
  let mapped = songs.map((s) => mapSongRecord(s))

  // 兜底: 补齐缺失的封面
  const missing = mapped.filter((s) => !s.cover).map((s) => s.id)
  if (missing.length) {
    try {
      console.log('[Search] backfilling covers for', missing.length, 'songs')
      const dd = await call('song_detail', { ids: missing.join(','), cookie })
      const songsArr = asArr(asObj(dd.body).songs)
      const idToPic: Record<string, string> = {}
      songsArr.forEach((raw) => {
        const s = asObj(raw)
        const pic = asStr(asObj(s.al).picUrl || asObj(s.album).picUrl)
        if (pic) idToPic[String(s.id)] = pic
      })
      mapped = mapped.map((s) => (s.cover ? s : { ...s, cover: idToPic[String(s.id)] || '' }))
    } catch (e) {
      console.warn('[Search] backfill failed:', (e as Error).message)
    }
  }
  return mapped
}

// ---------- 业务: 取歌曲 URL (探测试听) ----------
export interface SongUrlResult {
  url: string | null
  trial: boolean
  playable: boolean
  level?: string
  quality?: string
  br?: unknown
  requestedQuality: string
  trialInfo?: unknown
  restriction?: PlaybackRestriction
  reason?: string
  message?: string
  lastCode?: unknown
  fee?: unknown
  error?: string
}
export async function handleSongUrl(
  id: string,
  loginInfo: LoginInfo,
  qualityPreference: string,
  cookie: string
): Promise<SongUrlResult> {
  console.log('[SongUrl] id:', id, 'logged-in:', !!cookie)
  const requestedQuality = normalizeQualityPreference(qualityPreference)
  const svipReady = hasNeteaseSvip(loginInfo)
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES).filter(
    (q) => !q.svip || svipReady
  )

  let trialFallback: SongUrlResult | null = null
  let lastData: Record<string, unknown> | null = null
  let lastError: Error | null = null

  for (const q of qualities) {
    try {
      let result: NcmResponse
      try {
        result = await call('song_url_v1', { id, level: q.level, cookie })
      } catch {
        result = await call('song_url', { id, br: q.br, cookie })
      }
      const d = asObj(asArr(asObj(result.body).data)[0])
      if (Object.keys(d).length) lastData = d
      const url = d.url
      const freeTrial = d.freeTrialInfo
      console.log('[SongUrl]', q.level, '->', url ? 'OK' : 'no url', freeTrial ? '(TRIAL)' : '')
      if (url && !freeTrial) {
        return {
          url: asStr(url),
          trial: false,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
        }
      }
      if (url && freeTrial && !trialFallback) {
        trialFallback = {
          url: asStr(url),
          trial: true,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          trialInfo: freeTrial,
          restriction: classifyNeteasePlaybackRestriction(d, loginInfo),
        }
      }
    } catch (err) {
      lastError = err as Error
      console.log('[SongUrl]', q.level, 'failed:', (err as Error).message)
    }
  }
  if (trialFallback) return trialFallback
  const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo)
  return {
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: lastData && lastData.fee,
    error: lastError ? lastError.message : undefined,
    requestedQuality,
  }
}

export interface MappedArtistDetail {
  id: unknown
  name: string
  avatar: string
  musicSize: number
  songNum: number
  source: 'netease'
}

export function mapArtistDetail(raw: unknown): MappedArtistDetail {
  const a = asObj(raw)
  const basic = asObj(a.artist || a)
  return {
    id: basic.id ?? basic.artistId,
    name: asStr(basic.name),
    avatar: asStr(basic.picUrl || basic.img1v1Url || basic.avatar || ''),
    musicSize: asNum(basic.musicSize),
    songNum: asNum(basic.songNum || basic.musicSize),
    source: 'netease',
  }
}

export function mapAlbum(raw: unknown): MappedPlaylist {
  const a = asObj(raw)
  return {
    id: a.id,
    name: asStr(a.name),
    cover: asStr(a.picUrl || a.coverImgUrl || ''),
    trackCount: asNum(a.size || a.trackCount),
    playCount: 0,
    creator: '',
    tag: '专辑',
    description: asStr(a.description),
    source: 'netease',
    type: 'album',
    provider: 'netease',
  }
}

// ---------- 业务: 发现页 ----------
export async function handleDiscoverHome(ctx: ServerContext): Promise<Record<string, unknown>> {
  const cookie = getCookie(ctx, 'netease')
  const info = await getLoginInfo(ctx)
  const loggedIn = !!(info && info.loggedIn)
  if (!loggedIn) {
    return {
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      mode: 'starter',
      updatedAt: Date.now(),
    }
  }
  const tasks = [
    call('personalized', { limit: 8, cookie, timestamp: Date.now() }),
    call('dj_hot', { limit: 6, offset: 0, cookie, timestamp: Date.now() }),
    call('recommend_resource', { cookie, timestamp: Date.now() }),
    call('recommend_songs', { cookie, timestamp: Date.now() }),
  ]
  const result = await Promise.allSettled(tasks)

  const personalizedBody =
    result[0].status === 'fulfilled' ? asObj(result[0].value.body) : {}
  const publicPlaylists = asArr(personalizedBody.result || personalizedBody.data)
    .map((pl) => mapDiscoverPlaylist(pl, '推荐歌单'))
    .filter((pl) => pl.id && pl.name)
    .slice(0, 8)

  const podcastBody = result[1].status === 'fulfilled' ? asObj(result[1].value.body) : {}
  const podcastRaw =
    podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data
  const podcasts = asArr(podcastRaw)
    .map(mapPodcastRadio)
    .filter((p) => p.id && !isLowSignalPodcastItem(p))
    .slice(0, 6)

  let privatePlaylists: MappedPlaylist[] = []
  if (result[2].status === 'fulfilled') {
    const body = asObj(result[2].value.body)
    privatePlaylists = asArr(body.recommend || body.data)
      .map((pl) => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter((pl) => pl.id && pl.name)
      .slice(0, 6)
  }

  let dailySongs: MappedSong[] = []
  if (result[3].status === 'fulfilled') {
    const body = asObj(result[3].value.body)
    const data = asObj(body.data)
    const raw = data.dailySongs || data.recommend || body.recommend
    dailySongs = asArr(raw)
      .map(mapSongRecord)
      .filter((s) => s.id && s.name)
      .slice(0, 12)
  }

  return {
    loggedIn,
    user: loggedIn
      ? { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' }
      : null,
    dailySongs,
    playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
    podcasts,
    updatedAt: Date.now(),
  }
}

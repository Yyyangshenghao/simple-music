import { createHash, publicEncrypt, constants, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSafeUpstreamUrl } from './security'
import { kugouCover, normalizeKugouHash, normalizeKugouId, splitKugouFilename } from './kugou-client'

/**
 * 酷狗账号：酷狗 App 扫码登录得到 token/userid，之后走 gateway.kugou.com 的安卓签名接口
 * 取账号资料、我的歌单与会员播放地址。协议参考 MakcRe/KuGouMusicApi（MIT），参数以 2026-11 实测核对。
 * 登录态只落在 userData 的 kugou-account.json，不进渲染层。
 */

const ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp'
const WEB_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const URL_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d'
const APP_ID = 1005
const CLIENT_VER = 20489
const SRC_APP_ID = 2919
const USER_AGENT = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi'
const RSA_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----'
const ALLOWED_HOSTS = new Set(['gateway.kugou.com', 'login-user.kugou.com'])
const REQUEST_TIMEOUT_MS = 8000
const MAX_BYTES = 4 * 1024 * 1024

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {})
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '').trim()
const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const md5 = (text: string): string => createHash('md5').update(text).digest('hex')

export interface KugouSession {
  token: string
  userid: string
  /** 设备 MID：签名与播放地址 key 都依赖它，登录时的值必须一直沿用。 */
  mid: string
  dfid: string
  nickname?: string
  avatar?: string
}

export class KugouAuthError extends Error {
  constructor(message = 'AUTH_EXPIRED') {
    super(message)
    this.name = 'KugouAuthError'
  }
}

// ───────────────────────────── 会话存储 ─────────────────────────────

const sessionFile = (dir: string) => join(dir, 'kugou-account.json')

export function readKugouSession(dir: string): KugouSession | null {
  const file = sessionFile(dir)
  if (!existsSync(file)) return null
  try {
    const data = rec(JSON.parse(readFileSync(file, 'utf-8')))
    const session = { token: str(data.token), userid: normalizeKugouId(data.userid), mid: str(data.mid), dfid: str(data.dfid) || '-' }
    if (!session.token || !session.userid || !/^\d{10,48}$/.test(session.mid)) return null
    return { ...session, nickname: str(data.nickname), avatar: str(data.avatar) }
  } catch {
    return null
  }
}

export function writeKugouSession(dir: string, session: KugouSession): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(sessionFile(dir), JSON.stringify(session), { encoding: 'utf-8', mode: 0o600 })
}

export function clearKugouSession(dir: string): void {
  const file = sessionFile(dir)
  if (existsSync(file)) rmSync(file)
}

/** 新设备 MID：随机 GUID 的 md5 再按十六进制大整数转十进制（与客户端算法一致）。 */
export function createKugouMid(): string {
  return BigInt(`0x${md5(md5(randomUUID()))}`).toString()
}

// ───────────────────────────── 签名与请求 ─────────────────────────────

const pairs = (params: Rec) => Object.keys(params).map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)

export function signKugouAndroid(params: Rec, body = ''): string {
  return md5(`${ANDROID_SALT}${pairs(params).sort().join('')}${body}${ANDROID_SALT}`)
}

export function signKugouWeb(params: Rec): string {
  return md5(`${WEB_SALT}${pairs(params).sort().join('')}${WEB_SALT}`)
}

/** v5/url 的 key：hash + 盐 + appid + mid + userid。 */
export function kugouUrlKey(hash: string, mid: string, userid: string | number): string {
  return md5(`${hash}${URL_KEY_SALT}${APP_ID}${mid}${userid || 0}`)
}

/** 账号资料接口要求把 token 与时间戳做无填充 RSA（明文右侧补零到模长）。 */
export function kugouRsaRaw(data: Rec): string {
  const plain = Buffer.from(JSON.stringify(data), 'utf8')
  const padded = Buffer.alloc(128)
  plain.copy(padded)
  return publicEncrypt({ key: RSA_PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex')
}

export type KugouFetch = (url: string, init: RequestInit) => Promise<Response>

interface GatewayRequest {
  base?: string
  path: string
  method?: 'GET' | 'POST'
  params?: Rec
  body?: Rec
  router?: string
  web?: boolean
  session: Pick<KugouSession, 'mid' | 'dfid'> & Partial<Pick<KugouSession, 'token' | 'userid'>>
  /** 默认参数里不带 token/userid（例如扫码前） */
  anonymous?: boolean
}

export async function kugouGateway(request: GatewayRequest, fetchImpl: KugouFetch = fetch): Promise<Rec> {
  const { session } = request
  const clienttime = Math.floor(Date.now() / 1000)
  const params: Rec = {
    dfid: session.dfid || '-', mid: session.mid, uuid: '-', appid: APP_ID, clientver: CLIENT_VER, clienttime,
    ...(!request.anonymous && session.token ? { token: session.token } : {}),
    ...(!request.anonymous && session.userid ? { userid: session.userid } : {}),
    ...request.params,
  }
  const body = request.body ? JSON.stringify(request.body) : ''
  params.signature = request.web ? signKugouWeb(params) : signKugouAndroid(params, body)
  const target = `${request.base ?? 'https://gateway.kugou.com'}${request.path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`
  const host = new URL(target).hostname
  if (!ALLOWED_HOSTS.has(host) || !isSafeUpstreamUrl(target)) throw new Error('UNSAFE_UPSTREAM')
  const res = await fetchImpl(target, {
    method: request.method ?? 'GET',
    body: body || undefined,
    headers: {
      'User-Agent': USER_AGENT, dfid: String(params.dfid), mid: session.mid, clienttime: String(clienttime),
      'kg-rc': '1', 'kg-thash': '5d816a0', 'kg-rec': '1', 'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(request.router ? { 'x-router': request.router } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`UPSTREAM_${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error('TOO_LARGE')
  return rec(JSON.parse(text))
}

// 20018/20010/51002 等：token 失效或在别处登出。
const AUTH_ERROR_CODES = new Set([20010, 20017, 20018, 20028, 30768, 51002])

function assertOk(json: Rec): Rec {
  const code = num(json.error_code ?? json.errcode)
  if (AUTH_ERROR_CODES.has(code)) throw new KugouAuthError()
  if (num(json.status) !== 1 || code) throw new Error(`KUGOU_API_${code || json.status}`)
  return rec(json.data)
}

// ───────────────────────────── 扫码登录 ─────────────────────────────

export interface KugouQrCode { key: string; image: string; mid: string }

export async function createKugouQr(mid: string, fetchImpl?: KugouFetch): Promise<KugouQrCode> {
  const json = await kugouGateway({
    base: 'https://login-user.kugou.com', path: '/v2/qrcode', web: true, anonymous: true,
    session: { mid, dfid: '-' },
    params: { appid: 1001, type: 1, plat: 4, qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${APP_ID}&`, srcappid: SRC_APP_ID },
  }, fetchImpl)
  const data = assertOk(json)
  const key = str(data.qrcode)
  const image = str(data.qrcode_img)
  if (!/^[0-9a-z]{16,64}$/i.test(key) || !image.startsWith('data:image/')) throw new Error('KUGOU_QR_FAILED')
  return { key, image, mid }
}

export type KugouQrState =
  | { status: 'expired' | 'waiting' | 'scanned' }
  | { status: 'confirmed'; token: string; userid: string; nickname: string; avatar: string }

/** 0 过期、1 等待扫码、2 已扫待确认、4 已授权（附 token）。 */
export async function checkKugouQr(key: string, mid: string, fetchImpl?: KugouFetch): Promise<KugouQrState> {
  const json = await kugouGateway({
    base: 'https://login-user.kugou.com', path: '/v2/get_userinfo_qrcode', web: true, anonymous: true,
    session: { mid, dfid: '-' },
    params: { plat: 4, appid: APP_ID, srcappid: SRC_APP_ID, qrcode: key },
  }, fetchImpl)
  const data = assertOk(json)
  const status = num(data.status)
  if (status === 4) {
    const token = str(data.token)
    const userid = normalizeKugouId(data.userid)
    if (!token || !userid) throw new Error('KUGOU_QR_NO_TOKEN')
    return { status: 'confirmed', token, userid, nickname: str(data.nickname), avatar: kugouCover(data.pic) }
  }
  if (status === 2) return { status: 'scanned' }
  if (status === 1) return { status: 'waiting' }
  return { status: 'expired' }
}

// ───────────────────────────── 账号资料 ─────────────────────────────

export interface KugouProfile { nickname: string; avatar: string; vipType: number }

export async function fetchKugouProfile(session: KugouSession, fetchImpl?: KugouFetch): Promise<KugouProfile> {
  const clienttime = Math.floor(Date.now() / 1000)
  const json = await kugouGateway({
    path: '/v3/get_my_info', method: 'POST', router: 'usercenter.kugou.com', session,
    params: { plat: 1 },
    body: { visit_time: clienttime, usertype: 1, p: kugouRsaRaw({ token: session.token, clienttime }).toUpperCase(), userid: Number(session.userid) },
  }, fetchImpl)
  const data = assertOk(json)
  return {
    nickname: str(data.nickname) || session.nickname || '',
    avatar: kugouCover(data.pic) || session.avatar || '',
    vipType: num(data.vip_type),
  }
}

// ───────────────────────────── 我的歌单 ─────────────────────────────

/** 账号歌单 ID 用 global_collection_id（形如 collection_3_xxx_y_0），与公开歌单的数字 specialid 区分。 */
export const KUGOU_COLLECTION_PATTERN = /^collection_\d+_\d+_\d+_\d+$/

export function isKugouCollectionId(value: unknown): boolean {
  return typeof value === 'string' && KUGOU_COLLECTION_PATTERN.test(value)
}

export function mapKugouUserPlaylist(raw: Rec, userid: string): Rec | null {
  const id = str(raw.global_collection_id)
  const name = str(raw.name)
  if (!isKugouCollectionId(id) || !name) return null
  const creatorId = str(raw.list_create_userid)
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'playlist',
    id,
    name,
    cover: kugouCover(raw.pic),
    trackCount: num(raw.count),
    creator: str(raw.list_create_username) || undefined,
    // is_def=2 是「我喜欢」默认歌单。
    ...(num(raw.is_def) === 2 ? { specialType: 5 } : {}),
    subscribed: !!creatorId && creatorId !== userid,
  }
}

export async function fetchKugouUserPlaylists(session: KugouSession, fetchImpl?: KugouFetch): Promise<Rec[]> {
  const out: Rec[] = []
  for (let page = 1; page <= 10; page++) {
    const json = await kugouGateway({
      path: '/v7/get_all_list', method: 'POST', router: 'cloudlist.service.kugou.com', session,
      params: { plat: 1, userid: Number(session.userid), token: session.token },
      body: { userid: Number(session.userid), token: session.token, total_ver: 979, type: 2, page, pagesize: 100 },
    }, fetchImpl)
    const data = assertOk(json)
    const list = arr(data.info).map((item) => mapKugouUserPlaylist(rec(item), session.userid)).filter((item): item is Rec => !!item)
    out.push(...list)
    const total = num(data.list_count ?? data.total)
    if (list.length < 100 || (total && out.length >= total)) break
  }
  return out
}

export function mapKugouCollectionSong(raw: Rec): Rec | null {
  const audio = rec(raw.audio_info)
  const albumInfo = rec(raw.album_info)
  const hash = normalizeKugouHash(audio.hash_128 ?? audio.hash ?? raw.hash)
  if (!hash) return null
  const split = splitKugouFilename(str(raw.name))
  const singers = arr(raw.singerinfo).map(rec)
  const artists = singers.length
    ? singers.map((singer) => ({ id: normalizeKugouId(singer.id) || null, name: str(singer.name) })).filter((item) => item.name)
    : split.artist.split(/、|\s*&\s*/).filter(Boolean).map((name) => ({ id: null, name }))
  // relate_goods 按 level 列出各档文件：4 为 320k，5 及以上为无损。
  const goods = arr(raw.relate_goods).map(rec)
  const goodsHash = (match: (level: number) => boolean) => normalizeKugouHash(goods.find((item) => match(num(item.level)))?.hash)
  const h320 = normalizeKugouHash(audio.hash_320) || goodsHash((level) => level === 4)
  const sq = normalizeKugouHash(audio.hash_flac) || goodsHash((level) => level === 5)
  const albumInfoAlt = rec(raw.albuminfo)
  const albumId = normalizeKugouId(albumInfo.album_id ?? albumInfoAlt.id ?? raw.album_id)
  const albumAudioId = normalizeKugouId(raw.mixsongid ?? raw.add_mixsongid ?? raw.album_audio_id)
  const durationMs = num(audio.duration_128 ?? audio.duration ?? raw.timelen)
  const artistId = artists.find((artist) => artist.id)?.id
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'song',
    id: hash,
    name: split.name || str(raw.name),
    artist: artists.map((artist) => artist.name).join(' / ') || split.artist,
    artists,
    ...(artistId ? { artistId } : {}),
    album: str(albumInfo.album_name ?? albumInfoAlt.name),
    ...(albumId ? { albumId } : {}),
    cover: kugouCover(albumInfo.cover ?? raw.cover ?? rec(raw.trans_param).union_cover),
    // 列表接口给的是毫秒。
    duration: durationMs,
    fee: num(raw.privilege),
    ...(albumAudioId ? { albumAudioId } : {}),
    ...(h320 ? { hash320: h320 } : {}),
    ...(sq ? { hashSq: sq } : {}),
  }
}

export async function fetchKugouCollectionTracks(session: KugouSession, id: string, fetchImpl?: KugouFetch): Promise<Rec[]> {
  if (!isKugouCollectionId(id)) return []
  const out: Rec[] = []
  const seen = new Set<string>()
  const pagesize = 300
  for (let page = 0; page < 20; page++) {
    const json = await kugouGateway({
      path: '/pubsongs/v2/get_other_list_file_nofilt', session,
      params: { area_code: 1, begin_idx: page * pagesize, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization', pagesize, global_collection_id: id },
    }, fetchImpl)
    const data = assertOk(json)
    const songs = arr(data.songs)
    for (const raw of songs) {
      const track = mapKugouCollectionSong(rec(raw))
      if (!track || seen.has(track.id as string)) continue
      seen.add(track.id as string)
      out.push(track)
    }
    const total = num(data.count)
    if (songs.length < pagesize || (total && page * pagesize + songs.length >= total)) break
  }
  return out
}

// ───────────────────────────── 会员播放地址 ─────────────────────────────

const V5_QUALITY: Record<string, { quality: string; level: string; label: string }> = {
  lossless: { quality: 'flac', level: 'lossless', label: '无损' },
  exhigh: { quality: '320', level: 'exhigh', label: '极高' },
  standard: { quality: '128', level: 'standard', label: '标准' },
}

/** 从请求档位起向下回退的 v5 档位。 */
export function kugouAccountTiers(quality: string): Array<{ quality: string; level: string; label: string }> {
  const order = ['lossless', 'exhigh', 'standard']
  const start = quality === 'standard' || quality === 'higher' ? 2 : quality === 'exhigh' ? 1 : 0
  return order.slice(start).map((key) => V5_QUALITY[key])
}

interface AccountUrlInput { hash: string; albumId?: string; albumAudioId?: string }
type AccountUrl = { url: string; quality: string; level: string }

async function accountTierUrl(session: KugouSession, hash: string, input: Omit<AccountUrlInput, 'hash'>, tier: { quality: string; level: string; label: string }, fetchImpl?: KugouFetch): Promise<AccountUrl | null> {
  const json = await kugouGateway({
    path: '/v5/url', session, router: 'trackercdn.kugou.com',
    params: {
      album_id: Number(input.albumId || 0), area_code: 1, hash, ssa_flag: 'is_fromtrack', version: 11430, page_id: 151369488,
      quality: tier.quality, album_audio_id: Number(input.albumAudioId || 0), behavior: 'play', pid: 2, cmd: 26, pidversion: 3001,
      IsFreePart: 0, ppage_id: '463467626,350369493,788954147', cdnBackup: 1, module: '', key: kugouUrlKey(hash, session.mid, session.userid),
    },
  }, fetchImpl)
  const code = num(json.error_code ?? json.errcode)
  if (AUTH_ERROR_CODES.has(code)) throw new KugouAuthError()
  const url = [...arr(json.url), ...arr(json.backupUrl)].map(str).find((item) => item.startsWith('http') && isSafeUpstreamUrl(item))
  return num(json.status) === 1 && url ? { url, quality: tier.label, level: tier.level } : null
}

/**
 * 登录态取整曲：gateway v5/url 按账号权益返回直链，从请求档位起逐档向下。
 * 一档都拿不到（非会员的付费曲等）返回空数组，由调用方回落游客链路（试听片段）。
 * 最多返回两档：最高可得档播放，次档留给播放失败时回退。
 */
export async function fetchKugouAccountUrls(session: KugouSession, input: AccountUrlInput & { quality: string }, fetchImpl?: KugouFetch): Promise<AccountUrl[]> {
  const hash = normalizeKugouHash(input.hash)
  if (!hash) return []
  const out: AccountUrl[] = []
  for (const tier of kugouAccountTiers(input.quality)) {
    const result = await accountTierUrl(session, hash, input, tier, fetchImpl)
    if (result) out.push(result)
    if (out.length >= 2) break
  }
  return out
}

/** 登录账号能取到整曲的档位，供音质菜单列出。 */
export async function fetchKugouAccountQualities(session: KugouSession, hash: string, fetchImpl?: KugouFetch): Promise<string[]> {
  const id = normalizeKugouHash(hash)
  if (!id) return []
  const tiers = kugouAccountTiers('lossless')
  const results = await Promise.all(tiers.map((tier) => accountTierUrl(session, id, {}, tier, fetchImpl).catch((err) => {
    if (err instanceof KugouAuthError) throw err
    return null
  })))
  return results.filter((item): item is AccountUrl => !!item).map((item) => item.level)
}

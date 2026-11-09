import { createQishuiApi, type QishuiSession, type QishuiSessionStore } from 'qishui-music-api'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { deviceDigits } from './device-identity'
import { fetchQishuiStreams, isQishuiId, qishuiImageUrl } from './qishui-client'

/**
 * 汽水账号：抖音开放平台扫码授权，协议由 qishui-music-api（MIT）处理。
 * 这里只负责保存会话、固定设备标识，并把账号数据转成应用的 Playlist / Track。
 */
const PAGE_SIZE = 100
const RADIO_BATCH_TTL_MS = 5 * 60 * 1000
const MAX_PAGES = 50
const SESSION_FIELDS = ['userId', 'ticket', 'guardKey', 'guardCert', 'guardTsSign', 'accessCode'] as const

const sessionFile = (dir: string) => join(dir, 'qishui-account.json')

function readSession(dir: string): QishuiSession | null {
  try {
    const value = JSON.parse(readFileSync(sessionFile(dir), 'utf8'))
    return SESSION_FIELDS.every(field => typeof value?.[field] === 'string' && value[field]) && Number.isFinite(value.expiresAt) ? value : null
  } catch {
    return null
  }
}

function writeSession(dir: string, session: QishuiSession): void {
  mkdirSync(dir, { recursive: true })
  const file = sessionFile(dir)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(session), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function createSessionStore(dir: string): QishuiSessionStore {
  let current = readSession(dir)
  let revision = 0
  return {
    deviceId: deviceDigits('qishui:device', 19),
    get revision() { return revision },
    get: () => current,
    set(session) {
      current = session
      revision++
      writeSession(dir, session)
    },
    clear() {
      current = null
      revision++
      rmSync(sessionFile(dir), { force: true })
    },
  }
}

type RadioTracks = Record<string, unknown>[]
type RadioEntry = { batch?: { tracks: RadioTracks; at: number; revision: number }; pending?: Promise<void> }
type Account = { sessions: QishuiSessionStore; api: ReturnType<typeof createQishuiApi>; owners: Map<string, string>; radio: Map<string, RadioEntry> }
const accounts = new Map<string, Account>()

function accountFor(dir: string): Account {
  let account = accounts.get(dir)
  if (!account) {
    const sessions = createSessionStore(dir)
    account = {
      sessions,
      api: createQishuiApi({ deviceId: sessions.deviceId, sessions, fetch: (url, init) => fetch(url, init) }),
      owners: new Map(),
      radio: new Map(),
    }
    accounts.set(dir, account)
  }
  return account
}

function failure(error: { code?: string; upstreamCode?: unknown } | undefined): Error & { code?: string } {
  return Object.assign(new Error(`QISHUI_${error?.code ?? 'FAILED'}`), { code: error?.code })
}

export async function startQishuiLogin(dir: string) {
  const { api } = accountFor(dir)
  const created = await api.request('login_qr_key', {})
  if (!created.ok) throw failure(created.error)
  const { key } = created.data as { key: string }
  const qr = await api.request('login_qr_create', { key })
  if (!qr.ok) throw failure(qr.error)
  return { key, image: (qr.data as { imageUrl: string }).imageUrl }
}

export async function pollQishuiLogin(dir: string, key: string | null) {
  if (!key) return { status: 'expired' }
  const result = await accountFor(dir).api.request('login_qr_check', { key })
  if (!result.ok) {
    // 网络失败交给界面继续轮询；上游明确拒绝时结束本次扫码，并带上错误码便于排查。
    if (result.error?.code === 'network') throw failure(result.error)
    const code = result.error?.upstreamCode
    return { status: 'failed', message: `汽水音乐未能完成授权${code ? `（${code}）` : ''}，请刷新二维码重试` }
  }
  const { state } = result.data as { state: string }
  if (state === 'error') return { status: 'failed', message: '已在手机上拒绝授权，请刷新二维码重试' }
  return { status: state }
}

function profile(user: QishuiSession['user'] | null | undefined) {
  if (!user) return { loggedIn: false }
  // 头像可能是地址，也可能是带 uri/urls 的图片对象。
  const avatar = typeof user.avatar === 'string' ? user.avatar : qishuiImageUrl(user.avatar as Parameters<typeof qishuiImageUrl>[0])
  return { loggedIn: true, nickname: String(user.nickname ?? ''), avatar }
}

/** 扫码确认时依赖包已保存会话，这里把核实过的资料交给界面。 */
export function completeQishuiLogin(dir: string) {
  return profile(accountFor(dir).sessions.get()?.user)
}

export async function qishuiLoginStatus(dir: string) {
  const { api, sessions } = accountFor(dir)
  if (!sessions.get()) return { loggedIn: false }
  const result = await api.request('login_status', {})
  if (result.ok) return profile(result.data as QishuiSession['user'] | null)
  // 网络失败不退出账号；凭据被上游拒绝时依赖包已清除会话。
  return profile(sessions.get()?.user)
}

function mapAccountPlaylist(raw: any): Record<string, unknown> | null {
  const id = String(raw?.base_info?.id ?? '')
  const name = String(raw?.base_info?.title ?? raw?.base_info?.name ?? '')
  if (!isQishuiId(id) || !name) return null
  return {
    provider: 'qishui', source: 'qishui', type: 'playlist', id, name,
    cover: qishuiImageUrl(raw.display_info?.url_cover),
    trackCount: Number(raw.resource_cnt?.track_cnt) || 0,
    playCount: 0,
    creator: String(raw.relation_info?.owner?.nickname ?? ''),
    description: typeof raw.base_info.desc === 'string' ? raw.base_info.desc : undefined,
    subscribed: raw.isOwned === false,
  }
}

function mapAccountTrack(raw: any): Record<string, unknown> | null {
  const id = String(raw?.id ?? '')
  const name = String(raw?.base_info?.name ?? '').trim()
  if (!isQishuiId(id) || !name) return null
  const links = raw.related_info?.artist_links
  const artists = (Array.isArray(links) ? links : [])
    .map((item: any) => ({ id: String(item?.id ?? ''), name: String(item?.name ?? '').trim() }))
    .filter((item: { name: string }) => item.name)
  const album = raw.related_info?.album_link
  const duration = Number(raw.base_info.duration_ms)
  return {
    provider: 'qishui', source: 'qishui', type: 'qishui', id, name,
    artist: artists.map((item: { name: string }) => item.name).join(' / '),
    artists,
    artistId: artists[0]?.id,
    album: String(album?.name ?? ''),
    albumId: album?.id ? String(album.id) : undefined,
    cover: qishuiImageUrl(raw.display_info?.cover_url) || undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  }
}

interface Page { items?: unknown[]; hasMore?: boolean; nextOffset?: number; collection?: unknown }

/** 未登录或会话失效返回 null；读取期间账号已切换时丢弃结果。 */
export async function fetchQishuiUserPlaylists(dir: string) {
  const { api, sessions, owners } = accountFor(dir)
  if (!sessions.get()) return null
  const revision = sessions.revision
  const raw: any[] = []
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const result = await api.request('user_playlists', { limit: PAGE_SIZE, offset })
    if (!result.ok) {
      if (result.error?.code === 'auth-required') return null
      throw failure(result.error)
    }
    const data = result.data as Page
    raw.push(...data.items ?? [])
    if (!data.hasMore) break
    offset = data.nextOffset ?? offset + PAGE_SIZE
  }
  if (sessions.revision !== revision) return []
  for (const item of raw) {
    const owner = String(item?.base_info?.owner_id ?? item?.relation_info?.owner?.id ?? '')
    if (item?.base_info?.id && owner) owners.set(String(item.base_info.id), owner)
  }
  return raw.map(mapAccountPlaylist).filter(Boolean)
}

/** 公开接口读不到的私有歌单，用账号会话再读一次；未登录返回 null。 */
export async function fetchQishuiAccountPlaylist(dir: string, id: string) {
  const { api, sessions, owners } = accountFor(dir)
  if (!sessions.get()) return null
  const revision = sessions.revision
  const raw: unknown[] = []
  let collection: unknown
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const result = await api.request('playlist_tracks', { id, ownerId: owners.get(id) ?? '', limit: PAGE_SIZE, offset })
    if (!result.ok) throw failure(result.error)
    const data = result.data as Page
    collection ??= data.collection
    raw.push(...data.items ?? [])
    if (!data.hasMore) break
    offset = data.nextOffset ?? offset + PAGE_SIZE
  }
  if (sessions.revision !== revision) return null
  return {
    playlist: mapAccountPlaylist(collection) ?? { provider: 'qishui', source: 'qishui', type: 'playlist', id, name: '' },
    tracks: raw.map(mapAccountTrack).filter((track): track is Record<string, unknown> => !!track),
  }
}

async function loadRadioTracks({ api }: Account, mode: string, first: boolean): Promise<RadioTracks> {
  const target = /^\d+$/.test(mode) ? { scene: mode } : mode === 'default' ? {} : { preference: mode }
  const result = await api.request('feed', { ...target, first, queue: 'fm', limit: 20 })
  if (!result.ok) throw failure(result.error)
  return ((result.data as Page).items ?? []).map(mapAccountTrack).filter((track): track is Record<string, unknown> => !!track)
}

/** 提前备好一批歌和第一首的播放地址，用户点击模式时可以直接开始。 */
export function prepareQishuiRadio(dir: string, mode: string): Promise<void> {
  const account = accountFor(dir)
  const entry = account.radio.get(mode) ?? {}
  account.radio.set(mode, entry)
  const { batch } = entry
  if (entry.pending) return entry.pending
  if (batch && batch.revision === account.sessions.revision && Date.now() - batch.at < RADIO_BATCH_TTL_MS) return Promise.resolve()
  const revision = account.sessions.revision
  entry.pending = loadRadioTracks(account, mode, true).then(tracks => {
    if (revision !== account.sessions.revision || !tracks.length) return
    entry.batch = { tracks, at: Date.now(), revision }
    void fetchQishuiStreams(String(tracks[0].id)).catch(() => {})
  }).finally(() => { entry.pending = undefined })
  return entry.pending
}

/** 听歌模式的歌。游客和已登录都走这里，登录后由上游按账号推荐；first 表示用户刚点开这个模式。 */
export async function fetchQishuiRadioTracks(dir: string, mode: string, first: boolean): Promise<RadioTracks> {
  const account = accountFor(dir)
  if (!first) return loadRadioTracks(account, mode, false)
  const entry = account.radio.get(mode)
  await entry?.pending?.catch(() => {})
  const batch = entry?.batch
  if (entry) entry.batch = undefined
  const ready = batch && batch.revision === account.sessions.revision && Date.now() - batch.at < RADIO_BATCH_TTL_MS
  const tracks = ready ? batch.tracks : await loadRadioTracks(account, mode, true)
  void prepareQishuiRadio(dir, mode).catch(() => {})
  return tracks
}

export async function cancelQishuiLogin(dir: string, key: string | null) {
  if (key) await accountFor(dir).api.request('login_qr_cancel', { key })
  return { ok: true }
}

export async function logoutQishui(dir: string) {
  const result = await accountFor(dir).api.request('logout', {})
  if (!result.ok) throw failure(result.error)
  return { ok: true }
}

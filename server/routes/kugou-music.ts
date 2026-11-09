import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import {
  KUGOU_TOPLIST_PREFIX,
  kugouAlbumDetail,
  kugouAlbumSongs,
  kugouArtistAlbums,
  kugouArtistDetail,
  kugouArtistSongs,
  kugouPlaylistTracks,
  kugouRecommendPlaylists,
  kugouSearchAlbums,
  kugouSearchArtists,
  kugouSearchHotkeys,
  kugouSearchPlaylists,
  kugouSearchSongs,
  kugouSongDetails,
  kugouSongQualities,
  kugouSongUrl,
  kugouToplistPreview,
  kugouToplists,
  kugouToplistSongs,
  KUGOU_QUALITY_TIERS,
} from '../lib/kugou-client'
import {
  KugouAuthError,
  checkKugouQr,
  clearKugouSession,
  createKugouMid,
  createKugouQr,
  fetchKugouAccountQualities,
  fetchKugouAccountUrls,
  fetchKugouCollectionTracks,
  fetchKugouProfile,
  fetchKugouUserPlaylists,
  isKugouCollectionId,
  readKugouSession,
  writeKugouSession,
  type KugouSession,
} from '../lib/kugou-account'
import type { ServerContext } from '../types'

const MAX_KEYWORD_LENGTH = 100

function keywordOf(url: URL): string {
  return String(url.searchParams.get('keywords') ?? url.searchParams.get('keyword') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_KEYWORD_LENGTH)
}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const value = Number.parseInt(String(url.searchParams.get(name) ?? ''), 10)
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback
}

// 扫码中的二维码：key → 生成时的设备 MID（确认登录后沿用，签名才对得上）。
const QR_TTL_MS = 5 * 60 * 1000
const pendingQr = new Map<string, { mid: string; expiresAt: number }>()

function rememberQr(key: string, mid: string): void {
  const now = Date.now()
  for (const [k, v] of pendingQr) if (v.expiresAt <= now) pendingQr.delete(k)
  pendingQr.set(key, { mid, expiresAt: now + QR_TTL_MS })
  while (pendingQr.size > 4) pendingQr.delete(pendingQr.keys().next().value as string)
}

export function resetKugouLoginState(): void {
  pendingQr.clear()
}

const POST_PATHS = new Set(['/api/kugou/login/qr', '/api/kugou/logout'])

function profileOf(session: KugouSession | null) {
  return session ? { loggedIn: true, nickname: session.nickname || '', avatar: session.avatar || '' } : { loggedIn: false }
}

/** 登录状态：顺带刷新昵称头像；token 失效则清掉本地会话。 */
async function loginStatus(ctx: ServerContext): Promise<Record<string, unknown>> {
  const session = readKugouSession(ctx.userDataDir)
  if (!session) return { provider: 'kugou', loggedIn: false }
  try {
    const profile = await fetchKugouProfile(session)
    const next = { ...session, nickname: profile.nickname, avatar: profile.avatar }
    writeKugouSession(ctx.userDataDir, next)
    return { provider: 'kugou', ...profileOf(next), vipType: profile.vipType }
  } catch (err) {
    if (err instanceof KugouAuthError) {
      clearKugouSession(ctx.userDataDir)
      return { provider: 'kugou', loggedIn: false, error: 'AUTH_EXPIRED' }
    }
    // 网络波动不判定登出，沿用本地资料。
    return { provider: 'kugou', ...profileOf(session) }
  }
}

async function checkQr(ctx: ServerContext, key: string): Promise<Record<string, unknown>> {
  const pending = pendingQr.get(key)
  if (!pending || pending.expiresAt <= Date.now()) return { status: 'expired' }
  const state = await checkKugouQr(key, pending.mid)
  if (state.status !== 'confirmed') {
    if (state.status === 'expired') pendingQr.delete(key)
    return { status: state.status }
  }
  pendingQr.delete(key)
  let session: KugouSession = { token: state.token, userid: state.userid, mid: pending.mid, dfid: '-', nickname: state.nickname, avatar: state.avatar }
  try {
    const profile = await fetchKugouProfile(session)
    session = { ...session, nickname: profile.nickname || session.nickname, avatar: profile.avatar || session.avatar }
  } catch { /* 资料拉取失败不影响登录 */ }
  writeKugouSession(ctx.userDataDir, session)
  return { status: 'confirmed', ...profileOf(session) }
}

/** 已登录时先按账号权益取整曲，失败或无权益再走游客链路（试听片段）。 */
async function songUrl(ctx: ServerContext, hash: string, quality: string): Promise<Record<string, unknown>> {
  const session = readKugouSession(ctx.userDataDir)
  if (session) {
    try {
      const urls = await fetchKugouAccountUrls(session, { hash, quality })
      if (urls.length) {
        const [first] = urls
        return { provider: 'kugou', url: first.url, quality: first.quality, level: first.level, trial: false,
          candidates: urls.map((item) => ({ ...item, trial: false })) }
      }
    } catch (err) {
      console.warn('[Kugou] account url', err instanceof Error ? err.message : err)
    }
  }
  return kugouSongUrl(hash, quality)
}

async function songQualities(ctx: ServerContext, hash: string): Promise<Array<{ level: string; label: string; br: number }>> {
  const session = readKugouSession(ctx.userDataDir)
  if (session) {
    const levels = await fetchKugouAccountQualities(session, hash).catch(() => [] as string[])
    const tiers = KUGOU_QUALITY_TIERS.filter((tier) => levels.includes(tier.level))
    if (tiers.length) return tiers.map(({ level, label, br }) => ({ level, label, br }))
  }
  return kugouSongQualities(hash)
}

function requireSession(ctx: ServerContext): KugouSession {
  const session = readKugouSession(ctx.userDataDir)
  if (!session) throw new KugouAuthError('AUTH_REQUIRED')
  return session
}

/**
 * 酷狗音乐端点（/api/kugou/*，歌词另见 routes/kugou-lyrics.ts）。目录与搜索是游客接口；
 * 扫码登录后的会话只在 server 的 kugou-account.json，渲染层只拿昵称头像。
 * 账号接口鉴权失败回 401，其余上游失败统一 502。
 */
export const kugouRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/kugou/')) return false
  const method = req.method ?? 'GET'
  if (method !== (POST_PATHS.has(pn) ? 'POST' : 'GET')) {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  const q = url.searchParams
  try {
    switch (pn) {
      case '/api/kugou/login/qr': {
        const mid = createKugouMid()
        const qr = await createKugouQr(mid)
        rememberQr(qr.key, mid)
        sendJson(res, { key: qr.key, image: qr.image })
        return true
      }
      case '/api/kugou/login/qr/check':
        sendJson(res, await checkQr(ctx, String(q.get('key') ?? '')))
        return true
      case '/api/kugou/login/status':
        sendJson(res, await loginStatus(ctx))
        return true
      case '/api/kugou/logout':
        clearKugouSession(ctx.userDataDir)
        sendJson(res, { provider: 'kugou', ok: true, loggedIn: false })
        return true
      case '/api/kugou/user/playlists':
        sendJson(res, { playlists: await fetchKugouUserPlaylists(requireSession(ctx)) })
        return true
      case '/api/kugou/search':
        sendJson(res, { songs: await kugouSearchSongs(keywordOf(url), intParam(url, 'limit', 20, 30)) })
        return true
      case '/api/kugou/search/artists':
        sendJson(res, { artists: await kugouSearchArtists(keywordOf(url), intParam(url, 'limit', 5, 20)) })
        return true
      case '/api/kugou/search/albums':
        sendJson(res, { albums: await kugouSearchAlbums(keywordOf(url), intParam(url, 'limit', 20, 30)) })
        return true
      case '/api/kugou/search/playlists':
        sendJson(res, { playlists: await kugouSearchPlaylists(keywordOf(url), intParam(url, 'limit', 20, 30)) })
        return true
      case '/api/kugou/search/hotkeys':
        sendJson(res, { keywords: await kugouSearchHotkeys() })
        return true
      case '/api/kugou/song/detail':
        sendJson(res, { songs: await kugouSongDetails(String(q.get('ids') ?? '').split(',')) })
        return true
      case '/api/kugou/song/url':
        sendJson(res, await songUrl(ctx, String(q.get('hash') ?? q.get('id') ?? ''), String(q.get('quality') ?? 'max')))
        return true
      case '/api/kugou/song/qualities':
        sendJson(res, { qualities: await songQualities(ctx, String(q.get('hash') ?? q.get('id') ?? '')) })
        return true
      case '/api/kugou/album/detail':
        sendJson(res, { playlist: await kugouAlbumDetail(String(q.get('id') ?? '')) })
        return true
      case '/api/kugou/album/songs':
        sendJson(res, { songs: await kugouAlbumSongs(String(q.get('id') ?? '')) })
        return true
      case '/api/kugou/artist/detail': {
        const artist = await kugouArtistDetail(String(q.get('id') ?? ''))
        if (!artist) sendJson(res, { error: 'NOT_FOUND' }, 404)
        else sendJson(res, { artist })
        return true
      }
      case '/api/kugou/artist/songs':
        sendJson(res, await kugouArtistSongs(String(q.get('id') ?? ''), intParam(url, 'offset', 0, 10000), intParam(url, 'limit', 50, 100)))
        return true
      case '/api/kugou/artist/albums':
        sendJson(res, { albums: await kugouArtistAlbums(String(q.get('id') ?? '')) })
        return true
      case '/api/kugou/playlist/tracks': {
        const id = String(q.get('id') ?? '')
        if (isKugouCollectionId(id)) {
          const tracks = await fetchKugouCollectionTracks(requireSession(ctx), id)
          sendJson(res, { trackIds: tracks.map((t) => t.id), tracks, playlist: null })
          return true
        }
        if (id.startsWith(KUGOU_TOPLIST_PREFIX)) {
          const tracks = await kugouToplistSongs(id)
          sendJson(res, { trackIds: tracks.map((t) => t.id), tracks, playlist: null })
          return true
        }
        const { playlist, songs } = await kugouPlaylistTracks(id)
        sendJson(res, { trackIds: songs.map((t) => t.id), tracks: songs, playlist })
        return true
      }
      case '/api/kugou/recommend/playlists':
        sendJson(res, { playlists: await kugouRecommendPlaylists(intParam(url, 'page', 0, 19)) })
        return true
      case '/api/kugou/toplist':
        sendJson(res, { groups: await kugouToplists() })
        return true
      case '/api/kugou/toplist/preview':
        sendJson(res, { preview: await kugouToplistPreview(String(q.get('id') ?? '')) })
        return true
      default:
        return false
    }
  } catch (err) {
    if (err instanceof KugouAuthError) {
      sendJson(res, { provider: 'kugou', loggedIn: false, error: err.message }, 401)
      return true
    }
    console.warn('[Kugou]', pn, err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED' }, 502)
    return true
  }
}

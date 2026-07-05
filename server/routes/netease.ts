import type { IncomingMessage } from 'node:http'
import type { RouteHandler } from '../types'
import { readBody, sendJson } from '../lib/http'
import { getCookie, setCookie, clearCookie } from '../lib/cookie'
import {
  UA,
  call,
  has,
  asObj,
  asArr,
  asStr,
  asNum,
  normalizeCookieHeader,
  parseCookieString,
  readCookieFromResponse,
  normalizeApiCode,
  normalizeApiMessage,
  normalizeLoginInfo,
  getLoginInfo,
  requireLogin,
  handleSearch,
  handleArtistSearch,
  handleSongUrl,
  handleDiscoverHome,
  mapSongRecord,
  mapArtists,
  mapDiscoverPlaylist,
  mapArtistDetail,
  mapAlbum,
  audioProxyHeadersFor,
  audioContentTypeForUrl,
  type LoginInfo,
} from '../lib/netease-client'

/** 「私人雷达」官方共享歌单 id（社区通行做法：带登录 cookie 请求即返回个人化的每日 35 首）。 */
const RADAR_PLAYLIST_ID = '3136952023'

/** 兼容原 readRequestBody：优先 JSON，失败回退 urlencoded。 */
async function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    const params = new URLSearchParams(raw)
    const out: Record<string, unknown> = {}
    params.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
}

function saveNeteaseCookie(ctx: { userDataDir: string; port: number }, raw: unknown): void {
  const normalized = normalizeCookieHeader(raw)
  if (normalized) setCookie(ctx, 'netease', normalized)
  else clearCookie(ctx, 'netease')
}

export const neteaseRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname

  // ---------- 发现页 ----------
  if (pn === '/api/discover/home') {
    try {
      sendJson(res, await handleDiscoverHome(ctx))
    } catch (err) {
      console.error('[DiscoverHome]', err)
      sendJson(res, { error: (err as Error).message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500)
    }
    return true
  }

  // ---------- 搜索 ----------
  if (pn === '/api/search') {
    try {
      const kw = url.searchParams.get('keywords') || ''
      const limit = parseInt(url.searchParams.get('limit') || '20')
      const songs = await handleSearch(kw, limit, getCookie(ctx, 'netease'))
      sendJson(res, { songs })
    } catch (err) {
      console.error('[Search]', err)
      sendJson(res, { error: (err as Error).message, songs: [] }, 500)
    }
    return true
  }

  // ---------- Banner ----------
  if (pn === '/api/netease/banner') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const resp = await call('banner', { type: 0, cookie })
      const banners = asArr(asObj(resp.body).banners || []).slice(0, 5).map((b) => {
        const item = asObj(b)
        const song = asObj(item.song || {})
        return {
          id: item.bannerId || item.targetId,
          title: asStr(item.typeTitle || song.name || ''),
          subtitle: asStr(song.name ? mapArtists(asArr(song.ar || [])).map((a) => a.name).join('、') : ''),
          cover: asStr(item.pic || item.imageUrl || ''),
          track: song.id ? mapSongRecord(song) : undefined,
        }
      })
      sendJson(res, { banners })
    } catch (err) {
      console.error('[Banner]', err)
      sendJson(res, { banners: [] }, 500)
    }
    return true
  }

  // ---------- Recommend Playlists（Stack 池子：page 0 = personalized，page >= 1 = 歌单广场热门分页，可无限翻页） ----------
  if (pn === '/api/netease/recommend/playlists') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const page = Math.max(0, Math.trunc(asNum(url.searchParams.get('page'))))
      const resp = page === 0
        ? await call('personalized', { limit: 30, cookie, timestamp: Date.now() })
        : await call('top_playlist', { order: 'hot', limit: 30, offset: (page - 1) * 30, cookie, timestamp: Date.now() })
      const body = asObj(resp.body)
      const mapped = asArr(body.result || body.playlists || [])
        .map((pl) => mapDiscoverPlaylist(pl, page === 0 ? '推荐歌单' : '热门歌单'))
        .filter((pl) => pl.id && pl.name)
      const seen = new Set<unknown>()
      const playlists = mapped.filter((pl) => {
        if (seen.has(pl.id)) return false
        seen.add(pl.id)
        return true
      })
      sendJson(res, { playlists })
    } catch (err) {
      console.error('[RecommendPlaylists]', err)
      sendJson(res, { playlists: [] }, 500)
    }
    return true
  }

  // ---------- Recommend Songs ----------
  if (pn === '/api/netease/recommend/songs') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const resp = await call('recommend_songs', { cookie, timestamp: Date.now() })
      const body = asObj(resp.body)
      const data = asObj(body.data)
      const raw = data.dailySongs || data.recommend || body.recommend
      const songs = asArr(raw).map(mapSongRecord).filter((s) => s.id && s.name).slice(0, 20)
      sendJson(res, { songs })
    } catch (err) {
      console.error('[RecommendSongs]', err)
      sendJson(res, { songs: [] }, 500)
    }
    return true
  }

  // ---------- 私人雷达 ----------
  if (pn === '/api/netease/radar') {
    try {
      const cookie = getCookie(ctx, 'netease')
      if (!cookie) {
        sendJson(res, { playlist: null, tracks: [] })
        return true
      }
      const resp = await call('playlist_detail', { id: RADAR_PLAYLIST_ID, cookie, timestamp: Date.now() })
      const raw = asObj(asObj(resp.body).playlist)
      const tracks = asArr(raw.tracks).map(mapSongRecord).filter((s) => s.id && s.name)
      const playlist = mapDiscoverPlaylist(raw, '私人雷达')
      if (!playlist.id || tracks.length === 0) {
        sendJson(res, { playlist: null, tracks: [] })
        return true
      }
      sendJson(res, { playlist, tracks })
    } catch (err) {
      console.error('[Radar]', err)
      sendJson(res, { playlist: null, tracks: [] }, 500)
    }
    return true
  }

  // ---------- 最近播放歌单（账号级播放记录，需登录 cookie） ----------
  if (pn === '/api/netease/recent/playlists') {
    try {
      const cookie = getCookie(ctx, 'netease')
      if (!cookie) {
        sendJson(res, { playlists: [] })
        return true
      }
      const resp = await call('record_recent_playlist', { limit: 12, cookie, timestamp: Date.now() })
      const list = asArr(asObj(asObj(resp.body).data).list)
      const seen = new Set<unknown>()
      const playlists = list
        .map((item) => mapDiscoverPlaylist(asObj(item).data, '最近播放'))
        .filter((pl) => pl.id && pl.name)
        .filter((pl) => {
          if (seen.has(pl.id)) return false
          seen.add(pl.id)
          return true
        })
      sendJson(res, { playlists })
    } catch (err) {
      console.error('[RecentPlaylists]', err)
      sendJson(res, { playlists: [] }, 500)
    }
    return true
  }

  // ---------- Artist Detail ----------
  if (pn === '/api/netease/artist/detail') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const id = url.searchParams.get('id') || ''
      const resp = await call('artist_detail', { id, cookie })
      const body = asObj(resp.body)
      const raw = asObj(body.data || body).artist || asObj(body.data || body)
      sendJson(res, { artist: mapArtistDetail(raw) })
    } catch (err) {
      console.error('[ArtistDetail]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- Artist Songs ----------
  if (pn === '/api/netease/artist/songs') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const id = url.searchParams.get('id') || ''
      const limit = parseInt(url.searchParams.get('limit') || '50')
      const resp = await call('artist_songs', { id, limit, offset: 0, cookie })
      const body = asObj(resp.body)
      const songs = asArr(body.songs || body.data || []).map(mapSongRecord).filter((s) => s.id && s.name)
      sendJson(res, { songs })
    } catch (err) {
      console.error('[ArtistSongs]', err)
      sendJson(res, { songs: [] }, 500)
    }
    return true
  }

  // ---------- Artist Albums ----------
  if (pn === '/api/netease/artist/albums') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const id = url.searchParams.get('id') || ''
      const limit = parseInt(url.searchParams.get('limit') || '20')
      const resp = await call('artist_album', { id, limit, offset: 0, cookie })
      const body = asObj(resp.body)
      const albums = asArr(body.hotAlbums || body.albums || []).map(mapAlbum).filter((a) => a.id && a.name)
      sendJson(res, { albums })
    } catch (err) {
      console.error('[ArtistAlbums]', err)
      sendJson(res, { albums: [] }, 500)
    }
    return true
  }

  // ---------- 歌手搜索 ----------
  if (pn === '/api/search/artists') {
    try {
      const kw = url.searchParams.get('keywords') || ''
      const limit = Math.max(1, Math.min(5, parseInt(url.searchParams.get('limit') || '3', 10) || 3))
      const artists = await handleArtistSearch(kw, limit, getCookie(ctx, 'netease'))
      sendJson(res, { artists })
    } catch (err) {
      console.error('[ArtistSearch]', err)
      sendJson(res, { error: (err as Error).message, artists: [] }, 500)
    }
    return true
  }

  // ---------- 歌曲 URL ----------
  if (pn === '/api/song/url') {
    try {
      const sid = url.searchParams.get('id') || ''
      const quality = url.searchParams.get('quality') || ''
      const loginInfo = await getLoginInfo(ctx)
      const info = await handleSongUrl(sid, loginInfo, quality, getCookie(ctx, 'netease'))
      sendJson(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      })
    } catch (err) {
      console.error('[SongUrl]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 登录: cookie ----------
  if (pn === '/api/login/cookie') {
    try {
      const body = await readRequestBody(req)
      const raw = body.cookie || body.data || body.text || ''
      const normalized = normalizeCookieHeader(raw)
      const obj = parseCookieString(normalized)
      if (!obj.MUSIC_U) {
        sendJson(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400)
        return true
      }
      saveNeteaseCookie(ctx, normalized)
      const cookie = getCookie(ctx, 'netease')
      let info: LoginInfo = await getLoginInfo(ctx)
      if (!info.loggedIn && cookie) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: '网易云用户',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        }
      }
      sendJson(res, { ...info, saved: true, hasCookie: !!cookie })
    } catch (err) {
      console.error('[LoginCookie]', err)
      sendJson(res, { loggedIn: false, error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 登录: QR Key ----------
  if (pn === '/api/login/qr/key') {
    try {
      const r = await call('login_qr_key', { timestamp: Date.now() })
      const key = asObj(asObj(r.body).data).unikey
      sendJson(res, { key })
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 登录: QR 二维码图片 ----------
  if (pn === '/api/login/qr/create') {
    try {
      const key = url.searchParams.get('key')
      const r = await call('login_qr_create', { key, qrimg: true, timestamp: Date.now() })
      const d = asObj(asObj(r.body).data)
      sendJson(res, { img: d.qrimg, url: d.qrurl })
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 登录: 轮询扫码状态 ----------
  if (pn === '/api/login/qr/check') {
    try {
      const key = url.searchParams.get('key')
      let r = await call('login_qr_check', { key, noCookie: true, timestamp: Date.now() })
      let body = asObj(r.body)
      let code = Number(body.code || r.status)
      let msg = asStr(body.message) || ''
      let cookie = readCookieFromResponse(r)
      if (code === 803 && !cookie) {
        try {
          const retry = await call('login_qr_check', { key, timestamp: Date.now() })
          const retryCookie = readCookieFromResponse(retry)
          if (retryCookie) {
            r = retry
            body = asObj(retry.body)
            code = Number(body.code || retry.status || code)
            msg = asStr(body.message) || msg
            cookie = retryCookie
          }
        } catch (retryErr) {
          console.warn('[Login] qr cookie retry failed:', (retryErr as Error).message)
        }
      }
      // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
      if (code === 803) {
        if (cookie) setCookie(ctx, 'netease', normalizeCookieHeader(cookie))
        let info: LoginInfo = await getLoginInfo(ctx)
        if (!info.loggedIn) {
          const profile = body.profile || asObj(body.data).profile || {}
          info = normalizeLoginInfo(profile, body.account || asObj(body.data).account, body.data || body)
        }
        if (!info.loggedIn && cookie) {
          const profile = asObj(body.profile)
          info = {
            loggedIn: true,
            pendingProfile: true,
            nickname: asStr(body.nickname || profile.nickname) || '网易云用户',
            avatar: asStr(body.avatarUrl || profile.avatarUrl),
            vipType: 0,
            vipLevel: 'none',
            isVip: false,
            isSvip: false,
            vipLabel: '无VIP',
          }
        }
        sendJson(res, { code, message: msg, ...info, hasCookie: !!cookie })
        return true
      }
      sendJson(res, { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl })
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 登录态查询 ----------
  if (pn === '/api/login/status') {
    sendJson(res, await getLoginInfo(ctx))
    return true
  }

  // ---------- 登出 ----------
  if (pn === '/api/logout') {
    try {
      await call('logout', { cookie: getCookie(ctx, 'netease') })
    } catch {
      /* ignore */
    }
    clearCookie(ctx, 'netease')
    sendJson(res, { ok: true })
    return true
  }

  // ---------- 用户歌单 ----------
  if (pn === '/api/user/playlists') {
    try {
      const info = await getLoginInfo(ctx)
      if (!info.loggedIn || !info.userId) {
        sendJson(res, { loggedIn: false, playlists: [] })
        return true
      }
      const limit = Math.max(12, Math.min(100, parseInt(url.searchParams.get('limit') || '60', 10) || 60))
      const cookie = getCookie(ctx, 'netease')
      const r = await call('user_playlist', { uid: info.userId, limit, cookie, timestamp: Date.now() })
      const list = asArr(asObj(r.body).playlist).map((raw) => {
        const pl = asObj(raw)
        return {
          id: pl.id,
          name: pl.name,
          cover: asStr(pl.coverImgUrl),
          trackCount: asNum(pl.trackCount),
          playCount: asNum(pl.playCount),
          creator: asStr(asObj(pl.creator).nickname),
          subscribed: !!pl.subscribed,
          specialType: asNum(pl.specialType),
        }
      })
      sendJson(res, { loggedIn: true, userId: info.userId, playlists: list })
    } catch (err) {
      console.error('[UserPlaylists]', err)
      sendJson(res, { error: (err as Error).message, loggedIn: false, playlists: [] }, 500)
    }
    return true
  }

  // ---------- 红心状态 ----------
  if (pn === '/api/song/like/check') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!ids.length) {
        sendJson(res, { error: 'Missing song id', liked: {}, ids: [] }, 400)
        return true
      }
      let likedIds: string[] = []
      try {
        if (has('song_like_check')) {
          const checked = await call('song_like_check', {
            ids: JSON.stringify(ids.map(Number).filter(Boolean)),
            cookie,
            timestamp: Date.now(),
          })
          const cbody = asObj(checked.body)
          const data: unknown = cbody.data || cbody.ids || cbody
          if (Array.isArray(data)) likedIds = data.map(String)
          else if (data && typeof data === 'object') {
            const dobj = data as Record<string, unknown>
            ids.forEach((id) => {
              if (dobj[id] || dobj[String(id)] || dobj[Number(id)]) likedIds.push(String(id))
            })
          }
        }
      } catch (e) {
        console.warn('[LikeCheck] direct check failed:', (e as Error).message)
      }
      if (!likedIds.length) {
        const r = await call('likelist', { uid: info.userId, cookie, timestamp: Date.now() })
        likedIds = asArr(asObj(r.body).ids).map(String)
      }
      const set = new Set(likedIds)
      const liked: Record<string, boolean> = {}
      ids.forEach((id) => {
        liked[id] = set.has(String(id))
      })
      sendJson(res, { loggedIn: true, ids, liked })
    } catch (err) {
      console.error('[LikeCheck]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 红心/取消红心 ----------
  if (pn === '/api/song/like') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const body = req.method === 'POST' ? await readRequestBody(req) : {}
      const id = body.id || url.searchParams.get('id')
      const nextLike =
        String(body.like != null ? body.like : url.searchParams.get('like') || 'true') !== 'false'
      if (!id) {
        sendJson(res, { error: 'Missing song id' }, 400)
        return true
      }
      const r = await call('like', { id, like: String(nextLike), cookie, timestamp: Date.now() })
      const code = asObj(r.body).code || r.status || 200
      sendJson(res, { loggedIn: true, id, liked: nextLike, code, body: r.body || r })
    } catch (err) {
      console.error('[Like]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 创建歌单 ----------
  if (pn === '/api/playlist/create') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const body = req.method === 'POST' ? await readRequestBody(req) : {}
      const name = String(body.name || url.searchParams.get('name') || '').trim()
      const privacy = String(body.privacy || url.searchParams.get('privacy') || '0')
      if (!name) {
        sendJson(res, { error: 'Missing playlist name' }, 400)
        return true
      }
      const r = await call('playlist_create', { name, privacy, cookie, timestamp: Date.now() })
      const rbody = asObj(r.body)
      const created = rbody.playlist || rbody.data || {}
      sendJson(res, { loggedIn: true, playlist: created, body: r.body || r })
    } catch (err) {
      console.error('[PlaylistCreate]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 收藏歌曲到歌单 ----------
  if (pn === '/api/playlist/add-song') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const body = req.method === 'POST' ? await readRequestBody(req) : {}
      const pid = body.pid || url.searchParams.get('pid')
      const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids')
      if (!pid || !id) {
        sendJson(res, { error: 'Missing playlist id or song id' }, 400)
        return true
      }
      const attempts: Array<Record<string, unknown>> = []
      let finalBody: unknown = null
      let finalCode = 0
      let finalMessage = ''
      let success = false

      const primary = await call('playlist_tracks', { op: 'add', pid, tracks: String(id), cookie, timestamp: Date.now() })
      finalBody = primary.body || primary
      finalCode = normalizeApiCode(primary)
      finalMessage = normalizeApiMessage(primary)
      success = finalCode === 200 && !asObj(finalBody).error
      attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody })

      if (!success && has('playlist_track_add')) {
        try {
          const fallback = await call('playlist_track_add', { pid, ids: String(id), cookie, timestamp: Date.now() })
          finalBody = fallback.body || fallback
          finalCode = normalizeApiCode(fallback)
          finalMessage = normalizeApiMessage(fallback)
          success = finalCode === 200 && !asObj(finalBody).error
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody })
        } catch (fallbackErr) {
          const fe = asObj(fallbackErr)
          const errBody = fe.body || fe.response || {}
          finalBody = errBody
          finalCode = normalizeApiCode(errBody)
          finalMessage = normalizeApiMessage(errBody) || (fallbackErr as Error).message || ''
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody })
        }
      }

      if (!success) {
        sendJson(
          res,
          { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts },
          finalCode === 401 ? 401 : 409
        )
        return true
      }
      sendJson(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts })
    } catch (err) {
      console.error('[PlaylistAddSong]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 歌词 ----------
  if (pn === '/api/lyric') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        sendJson(res, { error: 'Missing song id', lyric: '' }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      let body: Record<string, unknown> = {}
      let source = 'lyric'
      try {
        if (has('lyric_new')) {
          const nr = await call('lyric_new', { id, cookie, timestamp: Date.now() })
          body = asObj(nr.body)
          source = 'lyric_new'
        }
      } catch (errNew) {
        console.warn('[LyricNew]', (errNew as Error).message)
      }
      if (!(asObj(body.lrc).lyric || asObj(body.yrc).lyric)) {
        const r = await call('lyric', { id, cookie, timestamp: Date.now() })
        body = asObj(r.body) || body
        source = 'lyric'
      }
      sendJson(res, {
        lyric: asStr(asObj(body.lrc).lyric),
        tlyric: asStr(asObj(body.tlyric).lyric),
        yrc: asStr(asObj(body.yrc).lyric),
        source,
      })
    } catch (err) {
      console.error('[Lyric]', err)
      sendJson(res, { error: (err as Error).message, lyric: '' }, 500)
    }
    return true
  }

  // ---------- 封面图片代理（解决跨域采样限制） ----------
  if (pn === '/proxy/cover') {
    try {
      const targetUrl = url.searchParams.get('url')
      if (!targetUrl) {
        res.writeHead(400)
        res.end('Missing url param')
        return true
      }
      const r = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mineradio)' }
      })
      if (!r.ok) {
        res.writeHead(r.status)
        res.end(`Upstream error: ${r.status}`)
        return true
      }
      const contentType = r.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await r.arrayBuffer())
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(buffer)
    } catch (err) {
      res.writeHead(500)
      res.end((err as Error).message)
    }
    return true
  }

  // ---------- 歌曲评论 ----------
  if (pn === '/api/song/comments') {
    try {
      const id = url.searchParams.get('id')
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
      if (!id) {
        sendJson(res, { error: 'Missing song id', comments: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      const r = await call('comment_music', { id, limit, offset, cookie, timestamp: Date.now() })
      const body = asObj(r.body)
      const raw = body.hotComments && offset === 0 ? body.hotComments : body.comments
      const comments = asArr(raw)
        .map((item) => {
          const c = asObj(item)
          const user = asObj(c.user)
          return {
            id: c.commentId,
            content: asStr(c.content),
            likedCount: asNum(c.likedCount),
            time: asNum(c.time),
            user: c.user ? { id: user.userId, nickname: asStr(user.nickname), avatar: asStr(user.avatarUrl) } : null,
          }
        })
        .filter((c) => c.content)
      sendJson(res, { id, total: asNum(body.total), comments, hot: !!(body.hotComments && offset === 0), body })
    } catch (err) {
      console.error('[SongComments]', err)
      sendJson(res, { error: (err as Error).message, comments: [] }, 500)
    }
    return true
  }

  // ---------- 歌手主页 / 热门歌曲 ----------
  if (pn === '/api/artist/detail') {
    try {
      const id = url.searchParams.get('id')
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30))
      if (!id) {
        sendJson(res, { error: 'Missing artist id', songs: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      let detailBody: Record<string, unknown> = {}
      try {
        const detail = await call('artist_detail', { id, cookie, timestamp: Date.now() })
        detailBody = asObj(detail.body)
      } catch (e) {
        console.warn('[ArtistDetail] detail failed:', (e as Error).message)
      }
      let rawSongs: unknown[] = []
      try {
        const list = await call('artist_songs', { id, order: 'hot', limit, offset: 0, cookie, timestamp: Date.now() })
        const b = asObj(list.body)
        rawSongs = Array.isArray(b.songs) ? b.songs : asArr(asObj(b.data).songs)
      } catch (e) {
        console.warn('[ArtistSongs] hot failed:', (e as Error).message)
      }
      if (!rawSongs.length) {
        const top = await call('artist_top_song', { id, cookie, timestamp: Date.now() })
        rawSongs = asArr(asObj(top.body).songs)
      }
      const data = asObj(detailBody.data)
      const artist = asObj(detailBody.artist || data.artist || data)
      const songs = rawSongs
        .map(mapSongRecord)
        .filter((s) => s.id)
        .slice(0, limit)
      sendJson(res, {
        id,
        artist: {
          id: artist.id || id,
          name: asStr(artist.name || artist.artistName),
          avatar: asStr(artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url),
          brief: asStr(artist.briefDesc || artist.description || artist.desc),
          musicSize: asNum(artist.musicSize || artist.songSize),
          albumSize: asNum(artist.albumSize),
        },
        songs,
        body: detailBody,
      })
    } catch (err) {
      console.error('[ArtistDetail]', err)
      sendJson(res, { error: (err as Error).message, songs: [] }, 500)
    }
    return true
  }

  // ---------- 按 id 批量补曲目详情(歌单懒加载窗口用) ----------
  if (pn === '/api/song/detail') {
    try {
      const ids = (url.searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200)
      if (!ids.length) {
        sendJson(res, { error: 'Missing ids', tracks: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      const detail = await call('song_detail', { ids: ids.join(','), cookie, timestamp: Date.now() })
      const songs = asArr(asObj(detail.body).songs).map(mapSongRecord).filter((t) => t.id)
      // song_detail 不保证返回顺序,按请求 ids 顺序重排
      const byId = new Map(songs.map((t) => [String(t.id), t]))
      const tracks = ids.map((id) => byId.get(id)).filter(Boolean)
      sendJson(res, { tracks })
    } catch (err) {
      console.error('[SongDetail]', err)
      sendJson(res, { error: (err as Error).message, tracks: [] }, 500)
    }
    return true
  }

  // ---------- 歌单曲目详情 ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        sendJson(res, { error: 'Missing playlist id', tracks: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      let playlistMeta: { id: unknown; name: string; cover: string; trackCount: number } = {
        id,
        name: '',
        cover: '',
        trackCount: 0,
      }
      let rawTracks: unknown[] = []

      if (has('playlist_track_all')) {
        try {
          const all = await call('playlist_track_all', { id, limit: 500, offset: 0, cookie, timestamp: Date.now() })
          const ab = asObj(all.body)
          rawTracks = Array.isArray(ab.songs) ? ab.songs : asArr(ab.tracks)
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', (err as Error).message)
        }
      }

      if (!rawTracks.length && has('playlist_detail')) {
        const detail = await call('playlist_detail', { id, s: 0, cookie, timestamp: Date.now() })
        const pl = asObj(asObj(detail.body).playlist)
        playlistMeta = {
          id: pl.id || id,
          name: asStr(pl.name),
          cover: asStr(pl.coverImgUrl),
          trackCount: asNum(pl.trackCount),
        }
        rawTracks = asArr(pl.tracks)
      }

      const tracks = rawTracks.map(mapSongRecord).filter((t) => t.id)
      if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length
      sendJson(res, { playlist: playlistMeta, tracks })
    } catch (err) {
      console.error('[PlaylistTracks]', err)
      sendJson(res, { error: (err as Error).message, tracks: [] }, 500)
    }
    return true
  }

  // ---------- 封面代理 (带 CORS 头, 给 canvas 提取像素用) ----------
  if (pn === '/api/cover') {
    try {
      const coverUrl = url.searchParams.get('url')
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' })
        res.end('Invalid cover url')
        return true
      }
      const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' } })
      const ct = resp.headers.get('content-type') || 'image/jpeg'
      const cl = resp.headers.get('content-length')
      const hdr: Record<string, string> = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      }
      if (cl) hdr['Content-Length'] = cl
      res.writeHead(resp.status, hdr)
      const reader = resp.body?.getReader()
      if (reader) {
        for (;;) {
          const c = await reader.read()
          if (c.done) break
          res.write(c.value)
        }
      }
      res.end()
    } catch (err) {
      console.error('[Cover]', err)
      res.writeHead(500)
      res.end()
    }
    return true
  }

  // ---------- 音频代理 (支持 Range) ----------
  if (pn === '/api/audio') {
    try {
      const audioUrl = url.searchParams.get('url')
      if (!audioUrl) {
        res.writeHead(400)
        res.end('Missing url')
        return true
      }
      const range = req.headers.range || ''
      const hdr = audioProxyHeadersFor(audioUrl, range)
      const up = await fetch(audioUrl, { headers: hdr })
      const out: Record<string, string> = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      }
      const cl = up.headers.get('content-length')
      if (cl) out['Content-Length'] = cl
      const cr = up.headers.get('content-range')
      if (cr) out['Content-Range'] = cr
      res.writeHead(up.status, out)
      const reader = up.body?.getReader()
      if (reader) {
        for (;;) {
          const c = await reader.read()
          if (c.done) break
          res.write(c.value)
        }
      }
      res.end()
    } catch (err) {
      console.error('[Audio]', err)
      res.writeHead(500)
      res.end()
    }
    return true
  }

  return false
}

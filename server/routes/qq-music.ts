import type { RouteHandler } from '../types'
import { readBody, sendJson } from '../lib/http'
import { getCookie, setCookie, clearCookie } from '../lib/cookie'
import {
  handleQQSearch,
  handleQQSongUrl,
  handleQQLyric,
  getQQLoginInfo,
  handleQQUserPlaylists,
  handleQQRadarSong,
  handleQQPlaylistTracks,
  handleQQArtistDetail,
  handleQQSongComments,
  normalizeQQCookieInput,
  parseCookieString,
  qqCookieUin,
  qqCookieMusicKey,
  computeSavedQQCookie,
} from '../lib/qq-client'

/**
 * 读取请求体并解析为对象。忠实移植原 server.js 的 readRequestBody：
 * 先按 JSON 解析，失败则回退为 application/x-www-form-urlencoded。
 */
async function readRequestObject(req: Parameters<RouteHandler>[0]): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    const params = new URLSearchParams(raw)
    const out: Record<string, unknown> = {}
    params.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
}

/**
 * QQ 音乐相关端点。返回 true 表示已处理，false 表示未命中。
 * 移植自参考项目 server.js 调度器（第 3426~3558 行）。
 */
export const qqRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname

  if (pn === '/api/qq/search') {
    try {
      const kw = url.searchParams.get('keywords') || ''
      const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8))
      const songs = await handleQQSearch(getCookie(ctx, 'qq'), kw, limit)
      sendJson(res, { provider: 'qq', songs })
    } catch (err) {
      console.error('[QQSearch]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, songs: [] }, 500)
    }
    return true
  }

  if (pn === '/api/qq/song/url') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('id') || ''
      const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || ''
      const quality = url.searchParams.get('quality') || ''
      const info = await handleQQSongUrl(getCookie(ctx, 'qq'), mid, mediaMid, quality)
      sendJson(res, info)
    } catch (err) {
      console.error('[QQSongUrl]', err)
      sendJson(res, { provider: 'qq', url: '', playable: false, error: (err as Error).message }, 500)
    }
    return true
  }

  if (pn === '/api/qq/lyric') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || ''
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || ''
      if (!mid && !id) {
        sendJson(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400)
        return true
      }
      const data = await handleQQLyric(getCookie(ctx, 'qq'), mid, id)
      sendJson(res, data)
    } catch (err) {
      console.error('[QQLyric]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, lyric: '' }, 500)
    }
    return true
  }

  if (pn === '/api/qq/login/status') {
    try {
      const info = await getQQLoginInfo(getCookie(ctx, 'qq'))
      sendJson(res, info)
    } catch (err) {
      console.error('[QQLoginStatus]', err)
      sendJson(res, { provider: 'qq', loggedIn: false, error: (err as Error).message }, 500)
    }
    return true
  }

  if (pn === '/api/qq/login/cookie') {
    try {
      const body = await readRequestObject(req)
      const raw = String(body.cookie || body.data || body.text || '')
      const normalized = normalizeQQCookieInput(raw)
      const obj = parseCookieString(normalized)
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        sendJson(
          res,
          {
            provider: 'qq',
            loggedIn: false,
            error: 'INVALID_QQ_COOKIE',
            message: 'QQ cookie 缺少 uin 或有效登录票据',
          },
          400
        )
        return true
      }
      // 移植自原 saveQQCookie(normalized)：规范化后写入，空值则清除。
      const saved = computeSavedQQCookie(normalized)
      if (saved) setCookie(ctx, 'qq', saved)
      else clearCookie(ctx, 'qq')
      const info = await getQQLoginInfo(getCookie(ctx, 'qq'))
      sendJson(res, { ...info, saved: true })
    } catch (err) {
      console.error('[QQLoginCookie]', err)
      sendJson(res, { provider: 'qq', loggedIn: false, error: (err as Error).message }, 500)
    }
    return true
  }

  if (pn === '/api/qq/logout') {
    // 移植自原 saveQQCookie('')：清除 cookie。
    clearCookie(ctx, 'qq')
    sendJson(res, { provider: 'qq', ok: true, loggedIn: false })
    return true
  }

  if (pn === '/api/qq/user/playlists') {
    try {
      const data = await handleQQUserPlaylists(getCookie(ctx, 'qq'))
      sendJson(res, data)
    } catch (err) {
      console.error('[QQUserPlaylists]', err)
      sendJson(res, { provider: 'qq', loggedIn: false, error: (err as Error).message, playlists: [] }, 500)
    }
    return true
  }

  if (pn === '/api/qq/radar') {
    try {
      const data = await handleQQRadarSong(getCookie(ctx, 'qq'))
      sendJson(res, data)
    } catch (err) {
      console.error('[QQRadar]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, playlist: null, tracks: [] }, 500)
    }
    return true
  }

  if (pn === '/api/qq/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('disstid') || ''
      const data = await handleQQPlaylistTracks(getCookie(ctx, 'qq'), id)
      sendJson(res, data)
    } catch (err) {
      console.error('[QQPlaylistTracks]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, tracks: [] }, 500)
    }
    return true
  }

  if (pn === '/api/qq/artist/detail') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || ''
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36))
      if (!mid) {
        sendJson(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400)
        return true
      }
      const data = await handleQQArtistDetail(getCookie(ctx, 'qq'), mid, limit)
      sendJson(res, data)
    } catch (err) {
      console.error('[QQArtistDetail]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, artist: null, songs: [] }, 500)
    }
    return true
  }

  if (pn === '/api/qq/song/comments') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || ''
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || ''
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
      const data = await handleQQSongComments(getCookie(ctx, 'qq'), id, mid, limit, offset)
      sendJson(res, data)
    } catch (err) {
      console.error('[QQSongComments]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, comments: [] }, 500)
    }
    return true
  }

  return false
}

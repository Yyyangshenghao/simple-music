import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import { cancelQishuiLogin, completeQishuiLogin, fetchQishuiAccountPlaylist, fetchQishuiUserPlaylists, logoutQishui, pollQishuiLogin, qishuiLoginStatus, startQishuiLogin } from '../lib/qishui-account'
import {
  fetchQishuiAlbum,
  fetchQishuiArtist,
  fetchQishuiArtistSongs,
  fetchQishuiListeningModes,
  fetchQishuiListeningTracks,
  fetchQishuiPlaylist,
  fetchQishuiStreams,
  fetchQishuiTrackDetail,
  isQishuiId,
  isQishuiListeningMode,
  pickQishuiStreams,
  searchQishuiAlbums,
  searchQishuiArtists,
  searchQishuiPlaylists,
  searchQishuiTracks,
} from '../lib/qishui-client'

const MAX_KEYWORD_LENGTH = 100

function keywordOf(params: URLSearchParams): string | null {
  const keyword = String(params.get('keywords') ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return keyword && keyword.length <= MAX_KEYWORD_LENGTH ? keyword : null
}

function limitOf(params: URLSearchParams, fallback: number): number {
  const limit = Number(params.get('limit'))
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : fallback
}

/**
 * 汽水音乐端点。账号：/login/*、/logout、GET /user/playlists（未登录或失效 401）。
 * 目录与播放走游客会话（只读）：
 * - GET /api/qishui/search[?keywords&limit]、/search/{artists,albums,playlists}
 * - GET /api/qishui/listening-modes、/listening-modes/tracks?mode
 * - GET /api/qishui/song/url?id&quality → { url, quality, level, trial, candidates }；会员曲只有试听，trial=true
 * - GET /api/qishui/song/qualities?id、/lyric?id（明文逐字 KRC 原文）
 * - GET /api/qishui/playlist/tracks?id、/album/{detail,songs}?id、/artist/{detail,songs,albums}?id
 */
export const qishuiRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/qishui/')) return false
  if (pn.startsWith('/api/qishui/login/') || pn === '/api/qishui/logout') {
    res.setHeader('Cache-Control', 'no-store')
    const dir = ctx.userDataDir
    const key = url.searchParams.get('key')
    try {
      switch (`${req.method} ${pn}`) {
        case 'POST /api/qishui/login/qr':
          sendJson(res, await startQishuiLogin(dir))
          break
        case 'GET /api/qishui/login/qr/check':
          sendJson(res, await pollQishuiLogin(dir, key))
          break
        case 'POST /api/qishui/login/qr/complete':
          sendJson(res, completeQishuiLogin(dir, key))
          break
        case 'POST /api/qishui/login/qr/cancel':
          sendJson(res, cancelQishuiLogin(dir, key))
          break
        case 'GET /api/qishui/login/status':
          sendJson(res, await qishuiLoginStatus(dir))
          break
        case 'POST /api/qishui/logout':
          sendJson(res, logoutQishui(dir))
          break
        default: sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
      }
    } catch {
      sendJson(res, { error: '汽水音乐账号请求失败' }, 502)
    }
    return true
  }
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  if (pn === '/api/qishui/user/playlists') {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const playlists = await fetchQishuiUserPlaylists(ctx.userDataDir)
      if (playlists) sendJson(res, { playlists })
      else sendJson(res, { error: 'AUTH_REQUIRED' }, 401)
    } catch {
      sendJson(res, { error: 'UPSTREAM_FAILED' }, 502)
    }
    return true
  }
  const params = url.searchParams
  const searchHandlers: Partial<Record<string, (keyword: string) => Promise<Record<string, unknown>>>> = {
    '/api/qishui/search': async keyword => ({ songs: await searchQishuiTracks(keyword, limitOf(params, 20)) }),
    '/api/qishui/search/artists': async keyword => ({ artists: await searchQishuiArtists(keyword, limitOf(params, 5)) }),
    '/api/qishui/search/albums': async keyword => ({ albums: await searchQishuiAlbums(keyword, limitOf(params, 20)) }),
    '/api/qishui/search/playlists': async keyword => ({ playlists: await searchQishuiPlaylists(keyword, limitOf(params, 20)) }),
  }
  const idHandlers: Partial<Record<string, (id: string) => Promise<Record<string, unknown>>>> = {
    '/api/qishui/song/url': async id => {
      const streams = pickQishuiStreams(await fetchQishuiStreams(id), String(params.get('quality') ?? ''))
      const [best] = streams
      if (!best) return { url: '', restriction: { message: '汽水音乐没有返回可播放地址' } }
      return {
        url: best.url, quality: best.label, level: best.level, trial: best.trial,
        candidates: streams.map(stream => ({ url: stream.url, quality: stream.label, level: stream.level, trial: stream.trial })),
      }
    },
    '/api/qishui/song/qualities': async id => ({
      qualities: (await fetchQishuiStreams(id)).map(stream => ({ level: stream.level, label: stream.label, br: stream.br })),
    }),
    '/api/qishui/song/detail': async id => ({ song: (await fetchQishuiTrackDetail(id)).track }),
    '/api/qishui/lyric': async id => ({ krc: (await fetchQishuiTrackDetail(id)).lyric }),
    '/api/qishui/playlist/tracks': async id => {
      res.setHeader('Cache-Control', 'no-store')
      const { playlist, tracks } = await fetchQishuiPlaylist(id).catch(async error => {
        const accountDetail = await fetchQishuiAccountPlaylist(ctx.userDataDir, id)
        if (!accountDetail) throw error
        return accountDetail
      })
      return { playlist, tracks, trackIds: tracks.map(track => track.id) }
    },
    '/api/qishui/album/detail': async id => ({ playlist: (await fetchQishuiAlbum(id)).album }),
    '/api/qishui/album/songs': async id => ({ songs: (await fetchQishuiAlbum(id)).tracks }),
    '/api/qishui/artist/detail': async id => ({ artist: (await fetchQishuiArtist(id)).artist }),
    '/api/qishui/artist/albums': async id => ({ albums: (await fetchQishuiArtist(id)).albums }),
    '/api/qishui/artist/songs': async id => ({ songs: await fetchQishuiArtistSongs(id) }),
  }
  const mode = params.get('mode') ?? ''
  const listeningHandlers: Partial<Record<string, () => Promise<Record<string, unknown>>>> = {
    '/api/qishui/listening-modes': async () => ({ modes: await fetchQishuiListeningModes() }),
    '/api/qishui/listening-modes/tracks': async () => ({ songs: await fetchQishuiListeningTracks(mode) }),
  }
  const listening = listeningHandlers[pn]
  const search = searchHandlers[pn]
  const byId = idHandlers[pn]
  if (!listening && !search && !byId) {
    sendJson(res, { error: 'NOT_FOUND' }, 404)
    return true
  }
  const input = search ? keywordOf(params) : String(params.get('id') ?? '')
  const modeTracks = pn === '/api/qishui/listening-modes/tracks'
  const read = listening
    ?? (input && search ? () => search(input) : undefined)
    ?? (input && byId && isQishuiId(input) ? () => byId(input) : undefined)
  if (!read || (modeTracks && !isQishuiListeningMode(mode))) {
    sendJson(res, { error: 'INVALID_PARAMS' }, 400)
    return true
  }
  try {
    if (modeTracks) res.setHeader('Cache-Control', 'no-store')
    sendJson(res, await read())
  } catch (err) {
    console.warn('[Qishui]', pn, err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED' }, 502)
  }
  return true
}

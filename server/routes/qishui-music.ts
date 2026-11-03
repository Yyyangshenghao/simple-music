import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import {
  fetchQishuiAlbum,
  fetchQishuiArtist,
  fetchQishuiArtistSongs,
  fetchQishuiPlaylist,
  fetchQishuiStreams,
  fetchQishuiTrackDetail,
  isQishuiId,
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
 * 汽水音乐游客端点（只读，无登录）：
 * - GET /api/qishui/search[?keywords&limit]、/search/{artists,albums,playlists}
 * - GET /api/qishui/song/url?id&quality → { url, quality, level, trial, candidates }；会员曲只有试听，trial=true
 * - GET /api/qishui/song/qualities?id、/lyric?id（明文逐字 KRC 原文）
 * - GET /api/qishui/playlist/tracks?id、/album/{detail,songs}?id、/artist/{detail,songs,albums}?id
 */
export const qishuiRoutes: RouteHandler = async (req, res, url) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/qishui/')) return false
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
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
      const { playlist, tracks } = await fetchQishuiPlaylist(id)
      return { playlist, tracks, trackIds: tracks.map(track => track.id) }
    },
    '/api/qishui/album/detail': async id => ({ playlist: (await fetchQishuiAlbum(id)).album }),
    '/api/qishui/album/songs': async id => ({ songs: (await fetchQishuiAlbum(id)).tracks }),
    '/api/qishui/artist/detail': async id => ({ artist: (await fetchQishuiArtist(id)).artist }),
    '/api/qishui/artist/albums': async id => ({ albums: (await fetchQishuiArtist(id)).albums }),
    '/api/qishui/artist/songs': async id => ({ songs: await fetchQishuiArtistSongs(id) }),
  }
  const search = searchHandlers[pn]
  const byId = idHandlers[pn]
  if (!search && !byId) {
    sendJson(res, { error: 'NOT_FOUND' }, 404)
    return true
  }
  const input = search ? keywordOf(params) : String(params.get('id') ?? '')
  if (!input || (byId && !isQishuiId(input))) {
    sendJson(res, { error: 'INVALID_PARAMS' }, 400)
    return true
  }
  try {
    sendJson(res, await (search ? search(input) : byId!(input)))
  } catch (err) {
    console.warn('[Qishui]', pn, err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED' }, 502)
  }
  return true
}

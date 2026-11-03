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
} from '../lib/kugou-client'

const MAX_KEYWORD_LENGTH = 100

function keywordOf(url: URL): string {
  return String(url.searchParams.get('keywords') ?? url.searchParams.get('keyword') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_KEYWORD_LENGTH)
}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const value = Number.parseInt(String(url.searchParams.get(name) ?? ''), 10)
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback
}

/**
 * 酷狗音乐游客端点（/api/kugou/*，歌词另见 routes/kugou-lyrics.ts）。不读写任何 Cookie。
 * 上游失败统一 502，返回空结构，渲染层按平台错误处理。
 */
export const kugouRoutes: RouteHandler = async (req, res, url) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/kugou/')) return false
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  const q = url.searchParams
  try {
    switch (pn) {
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
        sendJson(res, await kugouSongUrl(String(q.get('hash') ?? q.get('id') ?? ''), String(q.get('quality') ?? 'max')))
        return true
      case '/api/kugou/song/qualities':
        sendJson(res, { qualities: await kugouSongQualities(String(q.get('hash') ?? q.get('id') ?? '')) })
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
    console.warn('[Kugou]', pn, err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED' }, 502)
    return true
  }
}

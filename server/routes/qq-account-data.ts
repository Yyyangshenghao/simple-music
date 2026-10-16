import type { Track } from '../../src/types/domain'
import type { RouteHandler } from '../types'
import { getCookie } from '../lib/cookie'
import { sendJson } from '../lib/http'
import { handleQQPlaylistTracks, isQQNumericPlaylistId, mapQQTrack, parseCookieString, qqCookieMusicKey, qqCookieUin } from '../lib/qq-client'
import { qqPlaylistRequest, qqRecord } from '../lib/qq-playlist-write'

const RECENT = '/api/qq/history/recent-tracks'
const DAILY = '/api/qq/recommend/daily'
// 这是平台最近播放的返回窗口，不代表完整历史，也不代表周听歌排行。
const RECENT_LIMIT = 2500
const validMid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(value)
const shanghaiDay = (milliseconds: number) => new Date(milliseconds + 8 * 3600_000).toISOString().slice(0, 10)
const validSong = (value: unknown): value is Track => {
  const song = qqRecord(value)
  return song.provider === 'qq' && song.source === 'qq' && typeof song.type === 'string' && validMid(song.id)
    && typeof song.name === 'string' && !!song.name.trim() && typeof song.artist === 'string'
    && Array.isArray(song.artists) && song.artists.every(artist => typeof qqRecord(artist).name === 'string')
    && typeof song.duration === 'number' && Number.isFinite(song.duration) && song.duration >= 0
}

export const qqAccountDataRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== RECENT && url.pathname !== DAILY) return false
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  const cookie = getCookie(ctx, 'qq')
  const cookies = parseCookieString(cookie)
  if (!isQQNumericPlaylistId(qqCookieUin(cookies)) || !qqCookieMusicKey(cookies)) {
    sendJson(res, { error: 'AUTH_REQUIRED' }, 401)
    return true
  }
  const current = () => !res.destroyed && getCookie(ctx, 'qq') === cookie
  const checkCurrent = () => { if (!current()) throw new Error('QQ_ACCOUNT_CHANGED') }
  const request = async (module: string, method: string, param: Record<string, unknown>) => {
    checkCurrent()
    const data = await qqPlaylistRequest(cookie, module, method, param)
    checkCurrent()
    return data
  }
  try {
    let songs: Track[]
    if (url.pathname === RECENT) {
      const data = await request('music.musicasset.PlayRecentlyRead', 'GetPlayRecentlyInfo', {
        requestCnt: RECENT_LIMIT, type: 2, updateTime: 0, lastTime: 0,
      })
      const rows = qqRecord(data.data).songList
      if (data.code !== 0 || !Array.isArray(rows)) throw new Error('QQ_RECENT_DATA_INCOMPLETE')
      const seen = new Set<string>()
      songs = []
      for (const raw of rows.slice(0, RECENT_LIMIT)) {
        const row = qqRecord(raw)
        const track = qqRecord(row.track)
        const title = track.name || track.title
        if (!validMid(track.mid) || typeof track.id !== 'number' || !Number.isSafeInteger(track.id) || track.id <= 0
          || typeof title !== 'string' || !title.trim()
          || typeof track.interval !== 'number' || !Number.isFinite(track.interval) || track.interval < 0
          || !Array.isArray(track.singer) || track.singer.some(singer => {
            const name = qqRecord(singer).name || qqRecord(singer).title
            return typeof name !== 'string' || !name.trim()
          }) || typeof row.lastTime !== 'number' || !Number.isFinite(row.lastTime) || row.lastTime < 0) {
          throw new Error('QQ_RECENT_DATA_INCOMPLETE')
        }
        const song = mapQQTrack(track, {})
        if (!validSong(song)) throw new Error('QQ_RECENT_DATA_INCOMPLETE')
        if (!seen.has(track.mid)) { seen.add(track.mid); songs.push(song) }
      }
    } else {
      const day = shanghaiDay(Date.now())
      const data = await request('music.recommend.RecommendFeed', 'get_recommend_feed', {
        direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0,
      })
      if (data.retcode !== 0 || !Array.isArray(data.v_shelf)) throw new Error('QQ_DAILY_DATA_INCOMPLETE')
      const dailyCards: Record<string, unknown>[] = []
      for (const shelf of data.v_shelf) {
        const niches = qqRecord(shelf).v_niche
        if (!Array.isArray(niches)) throw new Error('QQ_DAILY_DATA_INCOMPLETE')
        for (const niche of niches) {
          const cards = qqRecord(niche).v_card
          if (!Array.isArray(cards)) throw new Error('QQ_DAILY_DATA_INCOMPLETE')
          dailyCards.push(...cards.map(qqRecord).filter(card => card.subtype === 510))
        }
      }
      const card = dailyCards[0]
      if (dailyCards.length !== 1 || !['string', 'number'].includes(typeof card.id)
        || !isQQNumericPlaylistId(String(card.id)) || String(Number(card.id)) !== String(card.id)) throw new Error('QQ_DAILY_DATA_INCOMPLETE')
      if (typeof card.time !== 'number' || !Number.isSafeInteger(card.time) || card.time < 1_000_000_000
        || card.time > 9_999_999_999 || shanghaiDay(card.time * 1000) !== day) throw new Error('QQ_DAILY_EXPIRED')
      checkCurrent()
      const playlist = await handleQQPlaylistTracks(cookie, String(card.id), current)
      checkCurrent()
      if (shanghaiDay(Date.now()) !== day) throw new Error('QQ_DAILY_EXPIRED')
      const detail = qqRecord(playlist.playlist)
      if (playlist.error || playlist.loggedIn === false || String(detail.id) !== String(card.id)
        || !Array.isArray(playlist.tracks) || !playlist.tracks.every(validSong) || !Array.isArray(playlist.trackIds)
        || typeof detail.trackCount !== 'number' || detail.trackCount !== playlist.tracks.length
        || playlist.trackIds.length !== playlist.tracks.length
        || new Set(playlist.trackIds.map(String)).size !== playlist.trackIds.length
        || playlist.trackIds.some((id, index) => String(id) !== String((playlist.tracks as Track[])[index].id))) {
        throw new Error('QQ_DAILY_DATA_INCOMPLETE')
      }
      songs = playlist.tracks
    }
    checkCurrent()
    sendJson(res, { songs })
  } catch (error) {
    if (res.destroyed) return true
    const message = error instanceof Error ? error.message : ''
    const changed = getCookie(ctx, 'qq') !== cookie
    const expired = message === 'QQ_DAILY_EXPIRED'
    const auth = /（(?:301|1000|2000)）/.test(message)
    sendJson(res, { error: changed ? 'QQ_ACCOUNT_CHANGED' : expired ? 'QQ_DAILY_EXPIRED' : auth ? 'AUTH_EXPIRED' : 'QQ_ACCOUNT_DATA_FAILED' },
      changed || expired ? 409 : auth ? 401 : 502)
  }
  return true
}

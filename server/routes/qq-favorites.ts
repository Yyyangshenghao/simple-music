import type { RouteHandler } from '../types'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { parseCookieString, qqCookieMusicKey, qqCookieUin } from '../lib/qq-client'
import { qqPlaylistRequest, qqRecord } from '../lib/qq-playlist-write'

const PATH = '/api/qq/song/like'
const active = new Set<string>()
const validMid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(value)
const validId = (value: unknown) => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value))

export const qqFavoriteRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== PATH && url.pathname !== `${PATH}/check`) return false
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  let key = ''
  let acquired = false
  let cookie = ''
  try {
    cookie = getCookie(ctx, 'qq')
    const cookies = parseCookieString(cookie)
    const accountId = qqCookieUin(cookies)
    if (!validId(accountId) || !qqCookieMusicKey(cookies)) {
      sendJson(res, { error: '请先登录 QQ 音乐' }, 401)
      return true
    }
    const current = () => !res.destroyed && getCookie(ctx, 'qq') === cookie
    const request = async (module: string, method: string, param: Record<string, unknown>, write = false) => {
      if (!current()) throw new Error('QQ 账号已变化或请求已取消，请重试')
      const data = await qqPlaylistRequest(cookie, module, method, param, write)
      if (!current()) throw new Error('QQ 账号已变化或请求已取消，请重试')
      return data
    }
    const statuses = async (ids: string[]) => {
      const data = await request('music.musicasset.SongFavRead', 'IsSongFanByMid', { v_songMid: ids })
      const fans = qqRecord(data.m_fan)
      if (ids.some(id => typeof fans[id] !== 'boolean')) throw new Error('QQ 音乐未返回完整收藏状态，请重试')
      return Object.fromEntries(ids.map(id => [id, fans[id] as boolean]))
    }
    const body = JSON.parse(await readBody(req) || '{}')
    if (url.pathname.endsWith('/check')) {
      if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 100 || !body.ids.every(validMid)) {
        sendJson(res, { error: '无效的 QQ 音乐歌曲 ID' }, 400)
        return true
      }
      sendJson(res, { success: true, liked: await statuses([...new Set<string>(body.ids)]) })
      return true
    }
    if (body?.accountId !== accountId || body.accountToken !== playbackAccountToken(cookie)) {
      sendJson(res, { error: 'QQ 账号已变化，请重试' }, 409)
      return true
    }
    const track = body.track
    if (!track || track.source !== 'qq' || !validMid(track.id) || typeof body.like !== 'boolean'
      || (track.qqId !== undefined && !validId(track.qqId))
      || (track.songType !== undefined && (!Number.isSafeInteger(track.songType) || track.songType < 0))) {
      sendJson(res, { error: 'QQ 音乐曲目信息不完整，请重新加入歌曲' }, 400)
      return true
    }
    key = JSON.stringify([ctx.userDataDir, accountId, track.id])
    if (active.has(key) || active.size >= 64) {
      sendJson(res, { error: '收藏操作正在进行，请稍后重试' }, 409)
      return true
    }
    active.add(key)
    acquired = true
    if ((await statuses([track.id]))[track.id] !== body.like) {
      // MID 与数字 ID/类型必须属于同一首歌；旧档缺少元数据时也先核实。
      const detail = qqRecord((await request('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: track.id })).track_info)
      if (detail.mid !== track.id || !validId(detail.id) || !Number.isSafeInteger(detail.type) || Number(detail.type) < 0
        || (track.qqId !== undefined && String(detail.id) !== String(track.qqId))
        || (track.songType !== undefined && detail.type !== track.songType)) throw new Error('QQ 音乐曲目身份无法确认，未修改收藏')
      await request('music.musicasset.PlaylistDetailWrite', body.like ? 'AddSonglist' : 'DelSonglist', {
        dirId: 201, v_songInfo: [{ songId: Number(detail.id), songType: detail.type }],
      }, true)
      if ((await statuses([track.id]))[track.id] !== body.like) throw new Error('QQ 音乐尚未确认收藏变更，请稍后重试')
    }
    sendJson(res, { success: true, liked: body.like })
  } catch (error) {
    if (!res.destroyed) {
      const message = error instanceof Error ? error.message : 'QQ 音乐收藏操作失败，请重试'
      const changed = getCookie(ctx, 'qq') !== cookie
      const auth = /（(?:301|1000|2000)）/.test(message)
      sendJson(res, { success: false, error: changed ? 'QQ 账号已变化，请重试' : auth ? 'AUTH_EXPIRED' : message }, changed ? 409 : auth ? 401 : 200)
    }
  } finally {
    if (acquired) active.delete(key)
  }
  return true
}

import type { RouteHandler } from '../types'
import type { PlaylistSyncInput, PlaylistSyncResult } from '../../src/types/playlist-sync'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { isQQNumericPlaylistId, parseCookieString, qqCookieMusicKey, qqCookieUin } from '../lib/qq-client'
import { qqPlaylistRequest, qqRecord } from '../lib/qq-playlist-write'

const PATH = '/api/qq/app-playlist-sync'
const BASE = 'music.musicasset.PlaylistBaseWrite'
const DETAIL = 'music.musicasset.PlaylistDetailWrite'
const active = new Set<string>()
const created = new Map<string, string>()
type Song = { id: number; type: number; mid: string }
const songKey = (song: Song) => `${song.id}:${song.type}`
const validId = (value: unknown): value is string => typeof value === 'string' && isQQNumericPlaylistId(value) && String(Number(value)) === value
const validType = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const qqAppPlaylistSyncRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== PATH && url.pathname !== `${PATH}/session`) return false
  const sessionRequest = url.pathname.endsWith('/session')
  if (req.method !== (sessionRequest ? 'GET' : 'POST')) {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  let key = ''
  let acquired = false
  let playlistId: string | undefined
  try {
    const cookie = getCookie(ctx, 'qq')
    const cookies = parseCookieString(cookie)
    const accountId = qqCookieUin(cookies)
    const accountToken = playbackAccountToken(cookie)
    if (!validId(accountId) || !qqCookieMusicKey(cookies) || !accountToken) {
      sendJson(res, { error: '请先登录 QQ 音乐' }, 401)
      return true
    }
    const current = () => !res.destroyed && getCookie(ctx, 'qq') === cookie
    if (sessionRequest) {
      res.setHeader('Cache-Control', 'no-store')
      sendJson(res, { accountId, accountToken })
      return true
    }
    const body: PlaylistSyncInput = JSON.parse(await readBody(req) || '{}')
    if (body.accountId !== accountId || body.accountToken !== accountToken || !current()) {
      sendJson(res, { error: '账号已变化，请重新同步' }, 409)
      return true
    }
    const tracks = body.tracks
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (typeof body.appPlaylistId !== 'string' || !/^[\w-]{1,128}$/.test(body.appPlaylistId)
      || !name || name.length > 20 || !Array.isArray(tracks) || (!tracks.length && !body.playlistId) || tracks.length > 10000
      || tracks.some(track => !track || track.source !== 'qq' || typeof track.id !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(track.id)
        || !validId(track.qqId) || (track.songType !== undefined && !validType(track.songType)))
      || (body.playlistId !== undefined && !validId(body.playlistId))) {
      sendJson(res, { error: '只能同步有效 QQ 音乐歌曲，歌单名称最多 20 个字符' }, 400)
      return true
    }
    if (new Set(tracks.map(track => `${Number(track.qqId)}:${track.songType ?? 'unknown'}`)).size !== tracks.length
      || new Set(tracks.map(track => track.id)).size !== tracks.length) {
      sendJson(res, { error: '歌单中存在重复歌曲' }, 400)
      return true
    }
    key = JSON.stringify([ctx.userDataDir, accountId, body.appPlaylistId])
    if (active.has(key) || active.size >= 32) {
      sendJson(res, { error: '歌单正在同步，请稍后重试' }, 409)
      return true
    }
    active.add(key)
    acquired = true
    const request = async (module: string, method: string, param: Record<string, unknown>, write = false, checkpoint?: (data: Record<string, unknown>) => void) => {
      if (!current()) throw new Error('账号已变化或请求已取消，请重新同步')
      const data = await qqPlaylistRequest(cookie, module, method, param, write)
      checkpoint?.(data)
      if (!current()) throw new Error('账号已变化或请求已取消，请重新同步')
      return data
    }
    const desired: Song[] = []
    // 旧应用存档没有保存 songType；写入前核实真实类型，不把未知当普通歌曲 0。
    for (let offset = 0; offset < tracks.length; offset += 3) {
      const resolved = await Promise.all(tracks.slice(offset, offset + 3).map(async track => {
        let type = track.songType
        if (type === undefined) {
          const data = await request('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: track.id })
          const info = qqRecord(data.track_info)
          if (info.mid !== track.id || String(info.id) !== track.qqId || !validType(info.type)) {
            throw new Error('部分旧歌曲的 QQ 音乐身份无法核实，暂未修改云端歌单，请重新加入歌曲')
          }
          type = info.type
        }
        return { id: Number(track.qqId), type, mid: track.id }
      }))
      desired.push(...resolved)
    }
    if (new Set(desired.map(songKey)).size !== desired.length) throw new Error('歌单中存在重复歌曲')
    const readTarget = async (id: string) => {
      const owned = await request('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: accountId, bWithoutStatus: false })
      if (!Array.isArray(owned.v_playlist)) throw new Error('当前 QQ 账号的歌单清单不完整，请稍后重试')
      const matches = owned.v_playlist.map(qqRecord).filter(item => String(item.tid) === id)
      const entry = matches[0]
      if (matches.length !== 1 || String(entry.uin) !== accountId || !validId(String(entry.dirId ?? ''))
        || (Number(entry.dirId) >= 201 && Number(entry.dirId) <= 206)) throw new Error('只能更新当前 QQ 账号创建的普通歌单')
      const songs: Song[] = []
      let info: Record<string, unknown> = {}
      let total: number | undefined
      for (let page = 0; page < 100; page++) {
        const data = await request('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
          disstid: Number(id), dirid: 0, tag: true, userinfo: true, orderlist: true,
          onlysonglist: false, song_begin: songs.length, song_num: 100,
        })
        const detail = qqRecord(data.dirinfo)
        const dirId = String(detail.dirid ?? '')
        // 私密歌单详情会把 creator.musicid/host_uin 隐为 0；清单归属与 owndir 仍必须同时成立。
        const creatorId = String(qqRecord(detail.creator).musicid ?? '0')
        if (String(detail.id) !== id || dirId !== String(entry.dirId) || (creatorId !== '0' && creatorId !== accountId)
          || Number(detail.owndir) !== 1 || !validId(dirId) || (Number(dirId) >= 201 && Number(dirId) <= 206)) {
          throw new Error('只能更新当前 QQ 账号创建的普通歌单')
        }
        const count = data.total_song_num
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 10000
          || (total !== undefined && total !== count) || !Array.isArray(data.songlist)
          || (page > 0 && String(info.dirid) !== dirId)) throw new Error('云端歌单歌曲列表不完整，请稍后重试')
        if (page === 0) { info = detail; total = count }
        for (const raw of data.songlist) {
          const song = qqRecord(raw)
          if (!validId(String(song.id ?? '')) || !validType(song.type) || typeof song.mid !== 'string' || !song.mid) {
            throw new Error('云端歌单曲目信息不完整，请稍后重试')
          }
          songs.push({ id: Number(song.id), type: song.type, mid: song.mid })
        }
        if (songs.length === total && !Number(data.hasmore)) {
          if (new Set(songs.map(songKey)).size !== songs.length) throw new Error('云端歌单存在重复歌曲，请先在 QQ 音乐中整理')
          return { info, songs, dirId: Number(dirId) }
        }
        if (!data.songlist.length || songs.length >= total! || !Number(data.hasmore)) break
      }
      throw new Error('云端歌单歌曲列表不完整，请稍后重试')
    }
    playlistId = body.playlistId ?? created.get(key)
    if (!playlistId) {
      await request(BASE, 'AddPlaylist', { dirName: name, dirDesc: '', dirPicUrl: '', taglist: '', dirShow: 2 }, true, data => {
        const id = String(qqRecord(data.result).tid ?? '')
        if (!validId(id)) throw new Error('QQ 音乐未返回有效歌单，请稍后重试')
        playlistId = id
        created.delete(key)
        created.set(key, id)
        while (created.size > 64) created.delete(created.keys().next().value!)
      })
    }
    const pid = playlistId!
    const target = await readTarget(pid)
    if (Number(target.info.dir_show) !== 2) throw new Error('QQ 音乐同步仅支持私密歌单，请先在 QQ 音乐中设为仅自己可见')
    const existingByKey = new Map(target.songs.map(song => [songKey(song), song.mid]))
    if (desired.some(song => existingByKey.has(songKey(song)) && existingByKey.get(songKey(song)) !== song.mid)) {
      throw new Error('部分歌曲的 QQ 音乐身份不一致，暂未修改云端歌单，请重新加入歌曲')
    }
    const wanted = new Set(desired.map(songKey))
    const existing = new Set(target.songs.map(songKey))
    const additions = desired.filter(song => !existing.has(songKey(song)))
    const removals = target.songs.filter(song => !wanted.has(songKey(song)))
    const hasDesired = (songs: Song[]) => {
      const actual = new Map(songs.map(song => [songKey(song), song.mid]))
      return desired.every(song => actual.get(songKey(song)) === song.mid)
    }
    // 先补齐并读回，再删除差集；从不为排序清空整张歌单。
    for (const [method, songs] of [['AddSonglist', additions], ['DelSonglist', removals]] as const) {
      if (method === 'DelSonglist' && songs.length && !hasDesired((await readTarget(pid)).songs)) {
        throw new Error('部分歌曲未能同步，已保留原有云端歌曲，请稍后重试')
      }
      for (let offset = 0; offset < songs.length; offset += 100) {
        await request(DETAIL, method, { dirId: target.dirId, tid: Number(pid), bFmtUtf8: true,
          v_songInfo: songs.slice(offset, offset + 100).map(song => ({ songId: song.id, songType: song.type })) }, true)
      }
    }
    let verified = await readTarget(pid)
    if (verified.songs.length !== desired.length || !hasDesired(verified.songs)) throw new Error('云端歌曲尚未与应用歌单一致，请稍后重试')
    if (verified.info.title !== name) {
      const info = verified.info
      if (typeof info.desc !== 'string' || typeof info.picurl !== 'string' || typeof info.picurl2 !== 'string'
        || !Array.isArray(info.vec_tagid) || info.vec_tagid.some(id => !validId(String(id)))
        || ![1, 2].includes(Number(info.dir_show))) throw new Error('云端歌单信息不完整，暂未更改名称，请稍后重试')
      // 官网 mask:95 会编辑整组元数据，除名称外逐项保留刚读回的值。
      await request(BASE, 'EditPlaylist', { dirId: verified.dirId, mask: 95, dirNewName: name, dirNewDesc: info.desc,
        dirNewPicUrl: info.picurl, dirNewPicUrl2: info.picurl2,
        dirNewtaglist: info.vec_tagid.join(','), dirShow: Number(info.dir_show) }, true)
      verified = await readTarget(pid)
    }
    if (verified.info.title !== name || verified.songs.length !== desired.length || !hasDesired(verified.songs)) {
      throw new Error('云端名称或歌曲尚未与应用歌单一致，请稍后重试')
    }
    created.delete(key)
    sendJson(res, { success: true, playlistId: pid } satisfies PlaylistSyncResult)
  } catch (error) {
    sendJson(res, { success: false, playlistId, error: error instanceof Error ? error.message : '同步失败，请稍后重试' } satisfies PlaylistSyncResult)
  } finally {
    if (acquired) active.delete(key)
  }
  return true
}

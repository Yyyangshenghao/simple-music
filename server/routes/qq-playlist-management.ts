import type { RouteHandler } from '../types'
import type { PlatformPlaylistMutation, PlatformPlaylistMutationResult, PlatformPlaylistRef, PlatformPlaylistTrack } from '../../src/types/platform-playlist'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { isQQNumericPlaylistId, parseCookieString, qqCookieMusicKey, qqCookieUin } from '../lib/qq-client'
import { qqPlaylistRequest, qqRecord } from '../lib/qq-playlist-write'

const PATH = '/api/qq/playlist-management'
const active = new Set<string>()
// 写入结果不明也保留检查点，避免同一请求盲目重复创建。
const created = new Map<string, { playlistId?: string; name: string }>()
const validId = (value: unknown): value is string => typeof value === 'string' && isQQNumericPlaylistId(value) && String(Number(value)) === value
const validMid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(value)
const validType = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const ordinary = (value: string) => validId(value) && !(Number(value) >= 201 && Number(value) <= 206)
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'QQ 音乐操作失败，请稍后重试'
type Song = { id: number; type: number; mid: string }
const songKey = (song: Song) => `${song.id}:${song.type}`
class ManagementStopped extends Error {
  constructor(message: string, readonly status = 409) { super(message) }
}

export const qqPlaylistManagementRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (![`${PATH}/session`, `${PATH}/inspect`, `${PATH}/manage`].includes(url.pathname)) return false
  res.setHeader('Cache-Control', 'no-store')
  const session = url.pathname.endsWith('/session')
  const inspect = url.pathname.endsWith('/inspect')
  if (req.method !== (session ? 'GET' : 'POST')) {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  const held: string[] = []
  let playlistId: string | undefined
  let requested = 1
  let writeAttempted = false
  try {
    const cookie = getCookie(ctx, 'qq')
    const cookies = parseCookieString(cookie)
    const accountId = qqCookieUin(cookies)
    const accountToken = playbackAccountToken(cookie)
    if (!validId(accountId) || !qqCookieMusicKey(cookies) || !accountToken) {
      sendJson(res, { error: '请先登录 QQ 音乐' }, 401)
      return true
    }
    const current = () => !req.aborted && !res.destroyed && getCookie(ctx, 'qq') === cookie
    if (session) {
      sendJson(res, { accountId, accountToken })
      return true
    }
    const body: PlatformPlaylistMutation & PlatformPlaylistRef = JSON.parse(await readBody(req) || '{}')
    if (!body || body.accountId !== accountId || body.accountToken !== accountToken || !current()) {
      throw new ManagementStopped('QQ 账号已变化，请重新操作')
    }
    const request = async (module: string, method: string, param: Record<string, unknown>, write = false, checkpoint?: (data: Record<string, unknown>) => void) => {
      if (!current()) throw new ManagementStopped('QQ 账号已变化或请求已取消，请重新操作')
      try {
        if (write) writeAttempted = true
        const data = await qqPlaylistRequest(cookie, module, method, param, write)
        checkpoint?.(data)
        if (!current()) throw new ManagementStopped('QQ 账号已变化或请求已取消，请重新操作')
        return data
      } catch (error) {
        if (!current()) throw new ManagementStopped('QQ 账号已变化或请求已取消，请重新操作')
        if (/（(?:301|1000)）/.test(messageOf(error)) || [401, 403].includes(Number((error as { statusCode?: number })?.statusCode))) {
          throw new ManagementStopped(messageOf(error), 401)
        }
        throw error
      }
    }
    const readTarget = async (id: string, readSongs = true) => {
      const owned = await request('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: accountId, bWithoutStatus: false })
      if (!Array.isArray(owned.v_playlist)) throw new Error('QQ 账号歌单清单不完整，请稍后重试')
      const matches = owned.v_playlist.map(qqRecord).filter(item => String(item.tid) === id)
      const entry = matches[0]
      if (matches.length !== 1 || String(entry.uin) !== accountId || !ordinary(String(entry.dirId ?? ''))) {
        throw new ManagementStopped('只能管理当前 QQ 账号创建的普通歌单')
      }
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
        // 私密详情可能隐藏 creator；清单 uin、dirId 与详情 owndir 必须同时确认。
        const creatorId = String(qqRecord(detail.creator).musicid ?? '0')
        if (String(detail.id) !== id || dirId !== String(entry.dirId) || !ordinary(dirId)
          || (creatorId !== '0' && creatorId !== accountId) || Number(detail.owndir) !== 1) {
          throw new ManagementStopped('只能管理当前 QQ 账号创建的普通歌单')
        }
        if (Number(detail.dir_show) !== 2) throw new ManagementStopped('仅支持管理 QQ 私密歌单，请先在 QQ 音乐设为仅自己可见')
        if (typeof detail.title !== 'string') throw new Error('QQ 歌单信息不完整，请稍后重试')
        if (!readSongs) return { info: detail, songs, dirId: Number(dirId) }
        const count = data.total_song_num
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 10000
          || (total !== undefined && total !== count) || !Array.isArray(data.songlist)
          || (page > 0 && String(info.dirid) !== dirId)) throw new Error('QQ 歌单歌曲列表不完整，请稍后重试')
        if (page === 0) { info = detail; total = count }
        for (const raw of data.songlist) {
          const song = qqRecord(raw)
          if (!validId(String(song.id ?? '')) || !validType(song.type) || !validMid(song.mid)) throw new Error('QQ 歌单曲目信息不完整，请稍后重试')
          songs.push({ id: Number(song.id), type: song.type, mid: song.mid })
        }
        if (songs.length === total && !Number(data.hasmore)) {
          if (new Set(songs.map(songKey)).size !== songs.length || new Set(songs.map(song => song.mid)).size !== songs.length) {
            throw new Error('QQ 歌单存在重复歌曲，请先在 QQ 音乐整理')
          }
          return { info, songs, dirId: Number(dirId) }
        }
        if (!data.songlist.length || songs.length >= total! || !Number(data.hasmore)) break
      }
      throw new Error('QQ 歌单歌曲列表不完整，请稍后重试')
    }
    if (inspect) {
      if (!validId(body.playlistId)) throw new ManagementStopped('无效的 QQ 歌单', 400)
      const target = await readTarget(body.playlistId, false)
      sendJson(res, { playlistId: body.playlistId, name: target.info.title, private: true })
      return true
    }
    if (body.action === 'privacy') throw new ManagementStopped('QQ 音乐暂不支持切换歌单可见性', 400)
    if (!['create', 'rename', 'add', 'remove'].includes(body.action)) throw new ManagementStopped('无效的歌单操作', 400)
    const name = 'name' in body && typeof body.name === 'string' ? body.name.trim() : ''
    if (body.action === 'create' || body.action === 'rename') {
      if (!name || name.length > 20) throw new ManagementStopped('QQ 歌单名称为 1 至 20 个字符', 400)
    }
    if (body.action === 'create') {
      if (typeof body.requestId !== 'string' || !/^[\w-]{1,128}$/.test(body.requestId)) throw new ManagementStopped('无效的创建请求标识', 400)
      // 公开歌单的归属核对未验证，QQ 只创建私密歌单。
      if (body.public === true) throw new ManagementStopped('QQ 音乐暂只支持创建私密歌单', 400)
    } else if (!validId(body.playlistId)) throw new ManagementStopped('无效的 QQ 歌单', 400)
    let tracks: PlatformPlaylistTrack[] = []
    if (body.action === 'add' || body.action === 'remove') {
      if (!Array.isArray(body.tracks) || !body.tracks.length || body.tracks.length > 10000
        || body.tracks.some(track => !track || track.source !== 'qq' || !validMid(track.id)
          || (track.qqId !== undefined && !validId(track.qqId)) || (track.songType !== undefined && !validType(track.songType)))
        || new Set(body.tracks.map(track => track.id)).size !== body.tracks.length) {
        throw new ManagementStopped('请选择有效且不重复的 QQ 音乐歌曲', 400)
      }
      tracks = body.tracks
      requested = tracks.length
    }
    const lock = (key: string) => {
      if (active.has(key) || active.size >= 32) throw new ManagementStopped('歌单操作正在进行，请稍后重试')
      active.add(key)
      held.push(key)
    }
    const createKey = body.action === 'create' ? JSON.stringify([ctx.userDataDir, accountId, 'create', body.requestId]) : ''
    if (createKey) lock(createKey)
    let checkpoint = createKey ? created.get(createKey) : undefined
    if (checkpoint && checkpoint.name !== name) throw new ManagementStopped('创建请求名称已变化，请重新发起创建', 400)
    playlistId = body.action === 'create' ? checkpoint?.playlistId : body.playlistId
    if (playlistId) lock(JSON.stringify([ctx.userDataDir, accountId, 'playlist', playlistId]))
    if (body.action === 'create' && checkpoint && !playlistId) {
      sendJson(res, { playlistId: '', requested, completed: null, status: 'unknown',
        error: '上次创建结果尚不明确，请先刷新平台歌单确认，避免重复创建' } satisfies PlatformPlaylistMutationResult)
      return true
    }
    if (body.action === 'create' && !playlistId) {
      checkpoint = { name }
      created.set(createKey, checkpoint)
      // 并发创建中的记录不能被后来的请求驱逐。
      for (const key of created.keys()) {
        if (created.size <= 64) break
        if (!active.has(key)) created.delete(key)
      }
      await request('music.musicasset.PlaylistBaseWrite', 'AddPlaylist', {
        dirName: name, dirDesc: '', dirPicUrl: '', taglist: '', dirShow: 2,
      }, true, data => {
        const id = String(qqRecord(data.result).tid ?? '')
        if (!validId(id)) throw new Error('QQ 音乐未返回有效歌单，请先检查平台歌单后再操作')
        playlistId = id
        checkpoint!.playlistId = id
        lock(JSON.stringify([ctx.userDataDir, accountId, 'playlist', id]))
      })
    }
    const id = playlistId!
    if (body.action === 'create') {
      try {
        const target = await readTarget(id, false)
        const complete = target.info.title === name
        sendJson(res, { playlistId: id, requested, completed: complete ? 1 : 0, status: complete ? 'complete' : 'partial' } satisfies PlatformPlaylistMutationResult)
      } catch (error) {
        if (!res.destroyed) sendJson(res, { playlistId: id, requested, completed: null, status: 'unknown', error: messageOf(error) } satisfies PlatformPlaylistMutationResult,
          error instanceof ManagementStopped ? error.status : 200)
      }
      return true
    }
    const desired: Song[] = []
    const issues: string[] = []
    if (body.action === 'add' || body.action === 'remove') {
      // 即使客户端给出了数字 ID 和类型，也逐首核实，避免 MID 指向另一首歌曲。
      for (let offset = 0; offset < tracks.length; offset += 3) {
        const batch = await Promise.all(tracks.slice(offset, offset + 3).map(async track => {
          const info = qqRecord((await request('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: track.id })).track_info)
          if (info.mid !== track.id || !validId(String(info.id ?? '')) || !validType(info.type)
            || (track.qqId !== undefined && String(info.id) !== track.qqId) || (track.songType !== undefined && info.type !== track.songType)) {
            throw new ManagementStopped('QQ 曲目身份无法确认，未修改歌单')
          }
          return { id: Number(info.id), type: info.type, mid: info.mid as string }
        }))
        desired.push(...batch)
      }
      if (new Set(desired.map(songKey)).size !== desired.length) throw new ManagementStopped('QQ 曲目身份重复，未修改歌单', 400)
    }
    // 曲目核实后重新读取归属和目标，写入只包含用户选定的增量。
    const initial = await readTarget(id, body.action !== 'rename')
    try {
      if (body.action === 'rename' && initial.info.title !== name) {
        const info = initial.info
        if (typeof info.desc !== 'string' || typeof info.picurl !== 'string' || typeof info.picurl2 !== 'string'
          || !Array.isArray(info.vec_tagid) || info.vec_tagid.some(tag => !validId(String(tag)))) {
          throw new Error('QQ 歌单完整信息缺失，暂未更改名称')
        }
        await request('music.musicasset.PlaylistBaseWrite', 'EditPlaylist', {
          dirId: initial.dirId, mask: 95, dirNewName: name, dirNewDesc: info.desc,
          dirNewPicUrl: info.picurl, dirNewPicUrl2: info.picurl2,
          dirNewtaglist: info.vec_tagid.join(','), dirShow: Number(info.dir_show),
        }, true)
      } else if (body.action === 'add' || body.action === 'remove') {
        const existing = new Map(initial.songs.map(song => [song.mid, song]))
        const byKey = new Map(initial.songs.map(song => [songKey(song), song.mid]))
        if (desired.some(song => (existing.has(song.mid) && songKey(existing.get(song.mid)!) !== songKey(song))
          || (byKey.has(songKey(song)) && byKey.get(songKey(song)) !== song.mid))) throw new ManagementStopped('QQ 曲目身份不一致，未修改歌单')
        const pending = desired.filter(song => body.action === 'add' ? !existing.has(song.mid) : existing.has(song.mid))
        for (let offset = 0; offset < pending.length; offset += 100) {
          try {
            await request('music.musicasset.PlaylistDetailWrite', body.action === 'add' ? 'AddSonglist' : 'DelSonglist', {
              dirId: initial.dirId, tid: Number(id), bFmtUtf8: true,
              v_songInfo: pending.slice(offset, offset + 100).map(song => ({ songId: song.id, songType: song.type })),
            }, true)
          } catch (error) {
            if (error instanceof ManagementStopped) throw error
            issues.push(messageOf(error))
          }
        }
      }
    } catch (error) {
      if (error instanceof ManagementStopped) throw error
      issues.push(messageOf(error))
    }
    try {
      const verified = await readTarget(id, body.action !== 'rename')
      const keys = new Set(verified.songs.map(songKey))
      const mids = new Map(verified.songs.map(song => [song.mid, songKey(song)]))
      const identities = new Map(verified.songs.map(song => [songKey(song), song.mid]))
      if (desired.some(song => (mids.has(song.mid) && mids.get(song.mid) !== songKey(song))
        || (identities.has(songKey(song)) && identities.get(songKey(song)) !== song.mid))) {
        throw new Error('QQ 歌单回读曲目身份不一致，请刷新后确认')
      }
      const completed = body.action === 'rename' ? Number(verified.info.title === name)
        : desired.filter(song => body.action === 'add' ? keys.has(songKey(song)) : !keys.has(songKey(song))).length
      sendJson(res, { playlistId: id, requested, completed, status: completed === requested ? 'complete' : 'partial',
        ...(issues.length ? { error: issues.join('；') } : {}) } satisfies PlatformPlaylistMutationResult)
    } catch (error) {
      if (!res.destroyed) sendJson(res, { playlistId: id, requested, completed: null, status: 'unknown', error: messageOf(error) } satisfies PlatformPlaylistMutationResult,
        error instanceof ManagementStopped ? error.status : 200)
    }
  } catch (error) {
    if (!res.destroyed) {
      const status = error instanceof ManagementStopped ? error.status : error instanceof SyntaxError ? 400 : 502
      const message = writeAttempted && !playlistId ? `${messageOf(error)}；请先刷新平台歌单确认创建结果，避免重复创建` : messageOf(error)
      sendJson(res, writeAttempted ? { playlistId: playlistId ?? '', requested, completed: null, status: 'unknown', error: message }
        : { error: messageOf(error) }, writeAttempted && status !== 401 && status !== 409 ? 200 : status)
    }
  } finally {
    for (const key of held) active.delete(key)
  }
  return true
}

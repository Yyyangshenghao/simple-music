import type { RouteHandler } from '../types'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { asObj, call, getLoginInfo, normalizeApiCode, normalizeApiMessage } from '../lib/netease-client'
import { isQQNumericPlaylistId, parseCookieString, qqCookieMusicKey, qqCookieUin } from '../lib/qq-client'
import { qqPlaylistRequest, qqRecord } from '../lib/qq-playlist-write'

/** 收藏/取消收藏他人歌单与专辑；写入后读回平台状态，以读回结果为准。 */
const PATHS = { '/api/netease/collection': 'netease', '/api/qq/collection': 'qq' } as const
const active = new Set<string>()
const numericId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
const qqMid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(value)
class CollectionError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function neteaseCollection(cookie: string, kind: 'playlist' | 'album', id: string, subscribe: boolean, current: () => void): Promise<boolean> {
  const request = async (name: string, params: Record<string, unknown>) => {
    current()
    let response: Awaited<ReturnType<typeof call>>
    try { response = await call(name, { ...params, cookie, timestamp: Date.now() }) }
    catch (error) { response = error as Awaited<ReturnType<typeof call>> }
    current()
    const code = normalizeApiCode(response)
    if (code === 301) throw new CollectionError('登录已失效，请重新登录网易云', 401)
    if (code !== 200) throw new CollectionError(normalizeApiMessage(response) || '网易云暂时无法完成收藏，请稍后重试', 502)
    return asObj(response.body)
  }
  const state = async () => kind === 'playlist'
    ? asObj((await request('playlist_detail', { id })).playlist).subscribed === true
    : (await request('album_detail_dynamic', { id })).isSub === true
  if (await state() === subscribe) return subscribe
  // eapi 的 playlist_subscribe 会被风控拦成「操作过于频繁」，歌单改走 weapi。
  if (kind === 'playlist') await request('api', { uri: `/api/playlist/${subscribe ? 'subscribe' : 'unsubscribe'}`, data: { id }, crypto: 'weapi' })
  else await request('album_sub', { id, t: subscribe ? 1 : 0 })
  return state()
}

async function qqCollection(cookie: string, kind: 'playlist' | 'album', id: string, subscribe: boolean, current: () => void): Promise<boolean> {
  const request = async (module: string, method: string, param: Record<string, unknown>) => {
    current()
    const data = await qqPlaylistRequest(cookie, module, method, param)
    current()
    return data
  }
  // 歌单读状态用 v_tid、写入用 v_playlistId；专辑统一用 albumMid（实测接口约定）。
  const state = async () => {
    const fans = kind === 'playlist'
      ? qqRecord((await request('music.musicasset.PlaylistFavRead', 'IsPlaylistFan', { v_tid: [Number(id)] })).m_fan)
      : qqRecord((await request('music.musicasset.AlbumFavRead', 'IsAlbumFan', { v_albumMid: [id] })).m_fan)
    if (typeof fans[id] !== 'boolean') throw new CollectionError('QQ 音乐未返回收藏状态，请稍后重试', 502)
    return fans[id] as boolean
  }
  if (await state() === subscribe) return subscribe
  if (kind === 'playlist') {
    await request('music.musicasset.PlaylistFavWrite', subscribe ? 'FavPlaylist' : 'CancelFavPlaylist', { v_playlistId: [Number(id)] })
  } else {
    await request('music.musicasset.AlbumFavWrite', subscribe ? 'FavAlbum' : 'CancelFavAlbum', { v_albumMid: [id] })
  }
  return state()
}

export const platformCollectionRoutes: RouteHandler = async (req, res, url, ctx) => {
  const source = PATHS[url.pathname as keyof typeof PATHS]
  if (!source) return false
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  let key = ''
  try {
    const cookie = getCookie(ctx, source)
    let accountId = ''
    if (source === 'netease') {
      const info = await getLoginInfo(ctx)
      accountId = info.loggedIn && info.userId ? String(info.userId) : ''
    } else {
      const cookies = parseCookieString(cookie)
      accountId = qqCookieMusicKey(cookies) ? qqCookieUin(cookies) : ''
    }
    const accountToken = playbackAccountToken(cookie)
    if (!accountId || !accountToken) throw new CollectionError(source === 'qq' ? '请先登录 QQ 音乐' : '请先登录网易云', 401)
    let body: Record<string, unknown>
    try { body = asObj(JSON.parse(await readBody(req) || '{}')) }
    catch { throw new CollectionError('无效的请求内容', 400) }
    const current = () => {
      if (req.aborted || res.destroyed || getCookie(ctx, source) !== cookie) throw new CollectionError('账号已变化或请求已取消，请重试', 409)
    }
    current()
    if (body.accountId !== accountId || body.accountToken !== accountToken) throw new CollectionError('账号已变化，请重试', 409)
    const kind = body.kind
    const id = typeof body.id === 'string' ? body.id : ''
    if ((kind !== 'playlist' && kind !== 'album') || typeof body.subscribe !== 'boolean') throw new CollectionError('不支持的收藏操作', 400)
    const valid = source === 'qq' && kind === 'album' ? qqMid(id)
      : source === 'qq' ? numericId(id) && isQQNumericPlaylistId(id) : numericId(id)
    if (!valid) throw new CollectionError(kind === 'album' ? '无效的专辑' : '无效的歌单', 400)
    const lock = JSON.stringify([ctx.userDataDir, source, accountId, kind, id])
    if (active.has(lock)) throw new CollectionError('收藏操作正在进行，请稍后', 409)
    active.add(lock)
    key = lock
    const subscribed = await (source === 'netease' ? neteaseCollection : qqCollection)(cookie, kind, id, body.subscribe, current)
    if (subscribed !== body.subscribe) throw new CollectionError('平台尚未确认收藏变更，请稍后刷新查看', 502)
    sendJson(res, { subscribed })
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, { error: error instanceof Error ? error.message : '收藏操作失败，请稍后重试' }, error instanceof CollectionError ? error.status : 502)
    }
  } finally {
    if (key) active.delete(key)
  }
  return true
}

import type { RouteHandler } from '../types'
import type { PlaylistSyncResult } from '../../src/types/playlist-sync'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { asArr, asObj, call, isUpstreamNotFoundError, normalizeApiCode, normalizeApiMessage, requireLogin } from '../lib/netease-client'

const PATH = '/api/netease/app-playlist-sync'
const active = new Set<string>()
// 保留创建检查点：客户端超时重试也先复用刚创建的歌单，缓存始终有上限。
const created = new Map<string, string>()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value)

export const appPlaylistSyncRoutes: RouteHandler = async (req, res, url, ctx) => {
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
    const cookie = getCookie(ctx, 'netease')
    const info = await requireLogin(res, ctx, sendJson)
    if (!info) return true
    const accountId = String(info.userId)
    const accountToken = playbackAccountToken(cookie)
    const current = () => !res.destroyed && getCookie(ctx, 'netease') === cookie
    if (!current() || !accountToken || !validId(accountId)) {
      sendJson(res, { error: '账号已变化，请重新同步' }, 409)
      return true
    }
    if (sessionRequest) {
      res.setHeader('Cache-Control', 'no-store')
      sendJson(res, { accountId, accountToken })
      return true
    }
    const body = JSON.parse(await readBody(req) || '{}')
    if (body.accountId !== accountId || body.accountToken !== accountToken) {
      sendJson(res, { error: '账号已变化，请重新同步' }, 409)
      return true
    }
    const tracks = body.tracks
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (typeof body.appPlaylistId !== 'string' || !/^[\w-]{1,128}$/.test(body.appPlaylistId)
      || !name || name.length > 80 || !Array.isArray(tracks) || (!tracks.length && !body.playlistId) || tracks.length > 10000
      || tracks.some(track => !track || track.source !== 'netease' || !validId(track.id))
      || (body.playlistId !== undefined && !validId(body.playlistId))) {
      sendJson(res, { error: '只能同步包含有效网易云歌曲的应用歌单' }, 400)
      return true
    }
    const ids: string[] = tracks.map(track => track.id)
    if (new Set(ids).size !== ids.length) {
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
    const request = async (method: string, params: Record<string, unknown>, checkpoint?: (body: Record<string, unknown>) => void) => {
      if (!current()) throw new Error('账号已变化或请求已取消，请重新同步')
      const response = await call(method, { ...params, cookie, timestamp: Date.now() })
      if (normalizeApiCode(response) === 200) checkpoint?.(asObj(response.body))
      if (!current()) throw new Error('账号已变化或请求已取消，请重新同步')
      if (normalizeApiCode(response) !== 200 || asObj(response.body).error) {
        throw Object.assign(new Error(normalizeApiMessage(response) || '网易云暂时无法完成同步，请稍后重试'), { body: response.body })
      }
      return asObj(response.body)
    }
    const detail = async (id: string) => {
      try {
        const response = await request('playlist_detail', { id, s: 0 })
        const target = asObj(response.playlist)
        if (!target.id) throw new Error('云端歌单信息不完整，请稍后重试')
        if (String(asObj(target.creator).userId) !== accountId || target.subscribed === true || Number(target.specialType ?? 0) !== 0) {
          throw new Error('只能更新当前账号创建的普通歌单')
        }
        return target
      } catch (error) {
        if (isUpstreamNotFoundError(error)) return null
        throw error
      }
    }
    playlistId = body.playlistId ?? created.get(key)
    let target = playlistId ? await detail(playlistId) : null
    if (!target) {
      if (!ids.length) throw new Error('云端歌单已删除，无需同步空歌单')
      await request('playlist_create', { name, privacy: '10' }, response => {
        const id = String(asObj(response.playlist ?? response.data).id ?? '')
        if (!validId(id)) throw new Error('网易云未返回有效歌单，请稍后重试')
        playlistId = id
        created.delete(key)
        created.set(key, id)
        while (created.size > 64) created.delete(created.keys().next().value!)
      })
      const id = playlistId!
      target = await detail(id)
      if (!target) throw new Error('新歌单尚未就绪，请稍后重试')
    }
    const pid = playlistId!
    const currentIds = asArr(target.trackIds).map(track => String(asObj(track).id))
    // 网易云摘要总数可能少于实际歌曲数；完整 ID 列表才是增删与排序依据。
    if (!Array.isArray(target.trackIds) || currentIds.some(id => !validId(id))
      || new Set(currentIds).size !== currentIds.length
      || (typeof target.trackCount === 'number' && target.trackCount > currentIds.length)) {
      throw new Error('云端歌单歌曲列表不完整，请稍后重试')
    }
    const desired = new Set(ids)
    const existing = new Set(currentIds)
    const additions = ids.filter(id => !existing.has(id))
    const removals = currentIds.filter(id => !desired.has(id))
    // 先补歌曲再移除差集；失败时保留尽可能多的云端内容，不整单清空重塞。
    for (const [op, batch] of [['add', additions], ['del', removals]] as const) {
      if (op === 'del' && additions.length) {
        const afterAdd = await detail(pid)
        const available = new Set(asArr(afterAdd?.trackIds).map(track => String(asObj(track).id)))
        if (ids.some(id => !available.has(id))) throw new Error('部分歌曲未能同步，请稍后重试')
      }
      for (let offset = 0; offset < batch.length; offset += 100) {
        await request('playlist_tracks', { op, pid, tracks: batch.slice(offset, offset + 100).join(',') })
      }
    }
    if (JSON.stringify(currentIds) !== JSON.stringify(ids)) {
      const beforeOrder = await detail(pid)
      const actual = asArr(beforeOrder?.trackIds).map(track => String(asObj(track).id))
      if (actual.length !== ids.length || actual.some(id => !desired.has(id))) throw new Error('部分歌曲未能同步，请稍后重试')
      if (ids.length > 1) await request('song_order_update', { pid, ids: JSON.stringify(ids) })
    }
    if (target.name !== name) await request('playlist_name_update', { id: pid, name })
    const verified = await detail(pid)
    if (!verified || verified.name !== name
      || JSON.stringify(asArr(verified.trackIds).map(track => String(asObj(track).id))) !== JSON.stringify(ids)) {
      throw new Error('云端内容尚未与应用歌单一致，请稍后重试')
    }
    sendJson(res, { success: true, playlistId: pid } satisfies PlaylistSyncResult)
  } catch (error) {
    // 写入可能部分成功；返回创建检查点，客户端重试时更新同一份歌单。
    sendJson(res, { success: false, playlistId, error: error instanceof Error ? error.message : '同步失败，请稍后重试' } satisfies PlaylistSyncResult)
  } finally {
    if (acquired) active.delete(key)
  }
  return true
}

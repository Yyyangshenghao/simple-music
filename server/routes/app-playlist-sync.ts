import type { RouteHandler } from '../types'
import type { PlaylistSyncReport, PlaylistSyncResult, PlaylistSyncSnapshot } from '../../src/types/playlist-sync'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { playlistSyncResult, playlistSyncSnapshot } from '../lib/playlist-sync-report'
import { asArr, asObj, call, isUpstreamNotFoundError, normalizeApiCode, normalizeApiMessage, requireLogin } from '../lib/netease-client'

const PATH = '/api/netease/app-playlist-sync'
const active = new Set<string>()
const activeTargets = new Set<string>()
// 保留创建检查点：客户端超时重试也先复用刚创建的歌单，缓存始终有上限。
const created = new Map<string, string>()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value)
const messageOf = (error: unknown) => error instanceof Error ? error.message : '同步失败，请稍后重试'
class SyncStoppedError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function snapshotOf(target: Record<string, unknown>): PlaylistSyncSnapshot {
  const ids = asArr(target.trackIds).map(track => String(asObj(track).id))
  // 网易云摘要总数可能少于实际歌曲数；完整 ID 列表才是增删与排序依据。
  if (typeof target.name !== 'string' || !Array.isArray(target.trackIds) || ids.some(id => !validId(id))
    || new Set(ids).size !== ids.length
    || (typeof target.trackCount === 'number' && target.trackCount > ids.length)) {
    throw new Error('云端歌单歌曲列表不完整，请稍后重试')
  }
  return playlistSyncSnapshot(target.name, ids.map(id => ({ source: 'netease', id })))
}

export const appPlaylistSyncRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== PATH && url.pathname !== `${PATH}/session` && url.pathname !== `${PATH}/snapshot`) return false
  const sessionRequest = url.pathname.endsWith('/session')
  const snapshotRequest = url.pathname.endsWith('/snapshot')
  if (req.method !== (sessionRequest ? 'GET' : 'POST')) {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  let key = ''
  let targetKey = ''
  let acquired = false
  let playlistId: string | undefined
  try {
    const cookie = getCookie(ctx, 'netease')
    const info = await requireLogin(res, ctx, sendJson)
    if (!info) return true
    const accountId = String(info.userId)
    const accountToken = playbackAccountToken(cookie)
    const current = () => !res.destroyed && !req.aborted && getCookie(ctx, 'netease') === cookie
    const ensureCurrent = () => {
      if (!current()) throw new SyncStoppedError('账号已变化或请求已取消，请重新同步', 409)
    }
    if (!current() || !accountToken || !validId(accountId)) {
      sendJson(res, { error: '账号已变化，请重新同步' }, 409)
      return true
    }
    if (sessionRequest) {
      res.setHeader('Cache-Control', 'no-store')
      sendJson(res, { accountId, accountToken })
      return true
    }
    const body = asObj(JSON.parse(await readBody(req) || '{}'))
    if (body.accountId !== accountId || body.accountToken !== accountToken || !current()) {
      sendJson(res, { error: '账号已变化，请重新同步' }, 409)
      return true
    }
    const ensureAuthorized = (response: unknown) => {
      if ([301, 401].includes(normalizeApiCode(response))) {
        throw new SyncStoppedError(normalizeApiMessage(response) || '登录已失效，请重新登录网易云', 401)
      }
    }
    const request = async (method: string, params: Record<string, unknown>, checkpoint?: (body: Record<string, unknown>) => void) => {
      ensureCurrent()
      let response: Awaited<ReturnType<typeof call>>
      try {
        response = await call(method, { ...params, cookie, timestamp: Date.now() })
      } catch (error) {
        ensureCurrent()
        ensureAuthorized(error)
        throw error
      }
      // 创建成功后先存下检查点，即便此时客户端取消或切换账号也能复用。
      if (normalizeApiCode(response) === 200) checkpoint?.(asObj(response.body))
      ensureCurrent()
      ensureAuthorized(response)
      if (normalizeApiCode(response) !== 200 || asObj(response.body).error) {
        throw Object.assign(new Error(normalizeApiMessage(response) || '网易云暂时无法完成同步，请稍后重试'), { body: response.body })
      }
      return asObj(response.body)
    }
    const detail = async (id: string) => {
      try {
        const response = await request('playlist_detail', { id, s: 0 })
        const target = asObj(response.playlist)
        if (String(target.id) !== id) throw new Error('云端歌单信息不完整，请稍后重试')
        if (String(asObj(target.creator).userId) !== accountId || target.subscribed === true || Number(target.specialType ?? 0) !== 0) {
          throw new SyncStoppedError('只能更新当前账号创建的普通歌单', 409)
        }
        return target
      } catch (error) {
        if (error instanceof SyncStoppedError) throw error
        if (isUpstreamNotFoundError(error)) return null
        throw error
      }
    }
    if (snapshotRequest) {
      res.setHeader('Cache-Control', 'no-store')
      if (!validId(body.playlistId)) {
        sendJson(res, { error: '无效的网易云歌单' }, 400)
        return true
      }
      const target = await detail(body.playlistId)
      if (!target) {
        sendJson(res, { error: '云端歌单已删除，请重新检查' }, 404)
        return true
      }
      sendJson(res, snapshotOf(target))
      return true
    }
    const tracks = body.tracks
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (typeof body.appPlaylistId !== 'string' || !/^[\w-]{1,128}$/.test(body.appPlaylistId)
      || !name || name.length > 80 || !Array.isArray(tracks) || (!tracks.length && !body.playlistId) || tracks.length > 10000
      || tracks.some(track => asObj(track).source !== 'netease' || !validId(asObj(track).id))
      || (body.playlistId !== undefined && (!validId(body.playlistId)
        || typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision)))) {
      sendJson(res, { error: '只能同步包含有效网易云歌曲的应用歌单，更新前请先检查云端版本' }, 400)
      return true
    }
    const ids = tracks.map(track => String(asObj(track).id))
    if (new Set(ids).size !== ids.length) {
      sendJson(res, { error: '歌单中存在重复歌曲' }, 400)
      return true
    }
    key = JSON.stringify([ctx.userDataDir, accountId, body.appPlaylistId])
    playlistId = validId(body.playlistId) ? body.playlistId : created.get(key)
    targetKey = playlistId ? JSON.stringify([ctx.userDataDir, accountId, playlistId]) : ''
    if (active.has(key) || active.size >= 32 || (targetKey && activeTargets.has(targetKey))) {
      sendJson(res, { error: '歌单正在同步，请稍后重试' }, 409)
      return true
    }
    active.add(key)
    if (targetKey) activeTargets.add(targetKey)
    acquired = true
    let target = playlistId ? await detail(playlistId) : null
    if (body.playlistId !== undefined && !target) {
      sendJson(res, { status: 'stale', success: false, playlistId, error: '云端歌单已删除，请重新检查' } satisfies PlaylistSyncResult)
      return true
    }
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
      if (targetKey) activeTargets.delete(targetKey)
      targetKey = JSON.stringify([ctx.userDataDir, accountId, id])
      activeTargets.add(targetKey)
      target = await detail(id)
      if (!target) throw new Error('新歌单尚未就绪，请稍后重试')
    }
    const pid = playlistId!
    const initial = snapshotOf(target)
    if (body.playlistId !== undefined && body.expectedRevision !== initial.revision) {
      sendJson(res, { status: 'stale', success: false, playlistId: pid, error: '云端歌单已变化，请重新检查后同步' } satisfies PlaylistSyncResult)
      return true
    }
    const desired = { name, tracks: ids.map(id => ({ source: 'netease' as const, id })) }
    const issues: PlaylistSyncReport['issues'] = []
    const attempt = async (step: PlaylistSyncReport['issues'][number]['step'], action: () => Promise<unknown>) => {
      try {
        await action()
      } catch (error) {
        ensureCurrent()
        if (error instanceof SyncStoppedError) throw error
        issues.push({ step, message: messageOf(error) })
      }
    }
    const readSnapshot = async () => {
      let snapshot: PlaylistSyncSnapshot | undefined
      await attempt('read', async () => {
        const currentTarget = await detail(pid)
        if (!currentTarget) throw new SyncStoppedError('云端歌单已删除，请重新检查', 404)
        snapshot = snapshotOf(currentTarget)
      })
      return snapshot
    }
    const wanted = new Set(ids)
    const existing = new Set(initial.tracks.map(track => track.id))
    const additions = ids.filter(id => !existing.has(id))
    const removals = initial.tracks.filter(track => !wanted.has(track.id)).map(track => track.id)
    // 每批只尝试一次；明确推送以应用为准，新增失败也不阻断独立的删除差集。
    for (const [op, batch] of [['add', additions], ['del', removals]] as const) {
      for (let offset = 0; offset < batch.length; offset += 100) {
        await attempt(op === 'add' ? 'add' : 'remove', () => request('playlist_tracks', { op, pid, tracks: batch.slice(offset, offset + 100).join(',') }))
      }
    }
    if (JSON.stringify(initial.tracks.map(track => track.id)) !== JSON.stringify(ids)) {
      const beforeOrder = await readSnapshot()
      if (beforeOrder) {
        const available = new Set(beforeOrder.tracks.map(track => track.id))
        const order = [...ids.filter(id => available.has(id)), ...beforeOrder.tracks.filter(track => !wanted.has(track.id)).map(track => track.id)]
        if (order.length > 1 && JSON.stringify(order) !== JSON.stringify(beforeOrder.tracks.map(track => track.id))) {
          await attempt('order', () => request('song_order_update', { pid, ids: JSON.stringify(order) }))
        }
      }
    }
    if (target.name !== name) await attempt('name', () => request('playlist_name_update', { id: pid, name }))
    const verified = await readSnapshot()
    const result = playlistSyncResult(pid, desired, initial, verified, issues, true)
    sendJson(res, result)
  } catch (error) {
    if (snapshotRequest) {
      sendJson(res, { error: messageOf(error) }, error instanceof SyncStoppedError ? error.status : 502)
    } else {
      // 写入可能部分成功；返回创建检查点，客户端重试时更新同一份歌单。
      sendJson(res, { status: 'failed', success: false, playlistId, error: messageOf(error) } satisfies PlaylistSyncResult, error instanceof SyncStoppedError && error.status === 401 ? 401 : 200)
    }
  } finally {
    if (acquired) {
      active.delete(key)
      if (targetKey) activeTargets.delete(targetKey)
    }
  }
  return true
}

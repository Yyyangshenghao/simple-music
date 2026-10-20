import type { RouteHandler } from '../types'
import type { PlatformPlaylistMutationResult } from '../../src/types/platform-playlist'
import { getCookie } from '../lib/cookie'
import { readBody, sendJson } from '../lib/http'
import { playbackAccountToken } from '../lib/playback-account'
import { asArr, asObj, call, normalizeApiCode, normalizeApiMessage, requireLogin } from '../lib/netease-client'

const PATH = '/api/netease/playlist-management'
const active = new Set<string>()
// 请求结果不明时也保留检查点，避免重试再次创建；只保存当前进程内有限记录。
const created = new Map<string, { name: string; playlistId?: string }>()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value)
const messageOf = (error: unknown) => error instanceof Error ? error.message : normalizeApiMessage(error) || '网易云暂时无法完成操作，请稍后重试'
class ManagementError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function trackIds(target: Record<string, unknown>): string[] {
  const ids = asArr(target.trackIds).map(track => String(asObj(track).id))
  if (!Array.isArray(target.trackIds) || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length
    || (typeof target.trackCount === 'number' && target.trackCount > ids.length)) {
    throw new Error('云端歌单歌曲列表不完整，请稍后重试')
  }
  return ids
}

export const neteasePlaylistManagementRoutes: RouteHandler = async (req, res, url, ctx) => {
  const sessionRequest = url.pathname === `${PATH}/session`
  const inspectRequest = url.pathname === `${PATH}/inspect`
  const manageRequest = url.pathname === `${PATH}/manage`
  if (!sessionRequest && !inspectRequest && !manageRequest) return false
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== (sessionRequest ? 'GET' : 'POST')) {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  let lockKey = ''
  let playlistId = ''
  let requested = 1
  let wrote = false
  try {
    const cookie = getCookie(ctx, 'netease')
    const info = await requireLogin(res, ctx, sendJson)
    if (!info) return true
    const accountId = String(info.userId)
    const accountToken = playbackAccountToken(cookie)
    const ensureCurrent = () => {
      if (res.destroyed || req.aborted || getCookie(ctx, 'netease') !== cookie) {
        throw new ManagementError('账号已变化或请求已取消，请重新检查歌单', 409)
      }
    }
    ensureCurrent()
    if (!accountToken || !validId(accountId)) throw new ManagementError('账号已变化，请重新登录', 409)
    if (sessionRequest) {
      sendJson(res, { accountId, accountToken })
      return true
    }
    let body: Record<string, unknown>
    try { body = asObj(JSON.parse(await readBody(req) || '{}')) }
    catch { throw new ManagementError('无效的请求内容', 400) }
    ensureCurrent()
    if (body.accountId !== accountId || body.accountToken !== accountToken) throw new ManagementError('账号已变化，请重新检查歌单', 409)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const action = body.action
    if (inspectRequest) {
      if (!validId(body.playlistId)) throw new ManagementError('无效的网易云歌单', 400)
    } else if (action === 'create') {
      if (!name || name.length > 80 || typeof body.requestId !== 'string' || !/^[\w-]{1,128}$/.test(body.requestId)
        || (body.public !== undefined && typeof body.public !== 'boolean')) {
        throw new ManagementError('请输入有效的歌单名称和请求标识', 400)
      }
    } else if (action === 'rename') {
      if (!validId(body.playlistId) || !name || name.length > 80) throw new ManagementError('请输入有效的歌单和名称', 400)
    } else if (action === 'privacy') {
      if (!validId(body.playlistId) || typeof body.public !== 'boolean') throw new ManagementError('请选择有效的歌单和可见性', 400)
    } else if (action === 'add' || action === 'remove') {
      if (!validId(body.playlistId) || !Array.isArray(body.tracks) || body.tracks.length === 0 || body.tracks.length > 10000
        || body.tracks.some(track => asObj(track).source !== 'netease' || !validId(asObj(track).id))
        || new Set(body.tracks.map(track => asObj(track).id)).size !== body.tracks.length) {
        throw new ManagementError('只能操作所选的有效网易云歌曲，且不能重复', 400)
      }
      requested = body.tracks.length
    } else throw new ManagementError('不支持的歌单操作', 400)

    const ensureAuthorized = (response: unknown) => {
      if ([301, 401].includes(normalizeApiCode(response))) throw new ManagementError(normalizeApiMessage(response) || '登录已失效，请重新登录网易云', 401)
    }
    const request = async (method: string, params: Record<string, unknown>, checkpoint?: (body: Record<string, unknown>) => void) => {
      ensureCurrent()
      let response: Awaited<ReturnType<typeof call>>
      try { response = await call(method, { ...params, cookie, timestamp: Date.now() }) }
      catch (error) {
        ensureCurrent()
        ensureAuthorized(error)
        throw error
      }
      // 创建先记录目标，再处理取消或换号，以免同一请求创建重复歌单。
      if (normalizeApiCode(response) === 200) checkpoint?.(asObj(response.body))
      ensureCurrent()
      ensureAuthorized(response)
      if (normalizeApiCode(response) !== 200 || asObj(response.body).error) throw new Error(normalizeApiMessage(response) || '网易云暂时无法完成操作，请稍后重试')
      return asObj(response.body)
    }
    const detail = async (id: string) => {
      const response = await request('playlist_detail', { id, s: 0 })
      const target = asObj(response.playlist)
      if (String(target.id) !== id || typeof target.name !== 'string') throw new Error('云端歌单信息不完整，请稍后重试')
      if (String(asObj(target.creator).userId) !== accountId || target.subscribed === true || Number(target.specialType ?? 0) !== 0) {
        throw new ManagementError('只能管理当前账号创建的普通歌单', 409)
      }
      return target
    }
    if (inspectRequest) {
      const target = await detail(String(body.playlistId))
      sendJson(res, { playlistId: String(body.playlistId), name: target.name, private: Number(target.privacy) === 10 })
      return true
    }
    const requestKey = JSON.stringify([ctx.userDataDir, accountId, body.requestId])
    const candidateLock = action === 'create' ? requestKey : JSON.stringify([ctx.userDataDir, accountId, body.playlistId])
    if (active.has(candidateLock) || active.size >= 32) throw new ManagementError('歌单正在处理，请稍后重试', 409)
    active.add(candidateLock)
    lockKey = candidateLock
    const result = (completed: number | null, error?: string) => {
      sendJson(res, { playlistId, status: completed === null ? 'unknown' : completed === requested ? 'complete' : 'partial', requested, completed, ...(error ? { error } : {}) } satisfies PlatformPlaylistMutationResult)
    }
    if (action === 'create') {
      let checkpoint = created.get(requestKey)
      if (checkpoint && checkpoint.name !== name) throw new ManagementError('请求标识已用于其他歌单，请重新创建', 409)
      if (checkpoint) {
        playlistId = checkpoint.playlistId ?? ''
        if (!playlistId) {
          result(null, '上次创建结果尚不明确，请先刷新平台歌单确认，避免重复创建')
          return true
        }
      } else {
        checkpoint = { name }
        created.set(requestKey, checkpoint)
        // 正在创建的记录不能被其他并发请求驱逐。
        for (const key of created.keys()) {
          if (created.size <= 64) break
          if (!active.has(key)) created.delete(key)
        }
        wrote = true
        await request('playlist_create', { name, privacy: body.public === true ? '0' : '10' }, response => {
          const id = String(asObj(response.playlist ?? response.data).id ?? '')
          if (!validId(id)) throw new Error('网易云未返回有效歌单，请先刷新列表确认创建结果')
          playlistId = id
          checkpoint!.playlistId = id
        })
      }
      wrote = true
      const target = await detail(playlistId)
      result(target.name === name ? 1 : 0)
      return true
    }
    playlistId = String(body.playlistId)
    const target = await detail(playlistId)
    const issues: string[] = []
    const attempt = async (method: string, params: Record<string, unknown>) => {
      wrote = true
      try { await request(method, params) }
      catch (error) {
        if (error instanceof ManagementError) throw error
        issues.push(messageOf(error))
      }
    }
    const wantPrivacy = body.public === true ? 0 : 10
    if (action === 'rename') {
      if (target.name !== name) await attempt('playlist_name_update', { id: playlistId, name })
    } else if (action === 'privacy') {
      // playlist_privacy 模块只会公开；改回隐私需直接带 privacy 10 调同一上游接口（已实测双向可用）。
      if (Number(target.privacy) !== wantPrivacy) await attempt('api', { uri: '/api/playlist/update/privacy', data: { id: playlistId, privacy: wantPrivacy } })
    } else {
      const selected = asArr(body.tracks).map(track => String(asObj(track).id))
      const existing = new Set(trackIds(target))
      const changes = selected.filter(id => action === 'add' ? !existing.has(id) : existing.has(id))
      for (let offset = 0; offset < changes.length; offset += 100) {
        await attempt('playlist_tracks', { op: action === 'add' ? 'add' : 'del', pid: playlistId, tracks: changes.slice(offset, offset + 100).join(',') })
      }
    }
    let verified: Record<string, unknown>
    try { verified = await detail(playlistId) }
    catch (error) {
      if (error instanceof ManagementError) throw error
      result(null, messageOf(error))
      return true
    }
    if (action === 'rename') result(verified.name === name ? 1 : 0, issues[0])
    else if (action === 'privacy') result(Number(verified.privacy) === wantPrivacy ? 1 : 0, issues[0])
    else {
      try {
        const ids = new Set(trackIds(verified))
        const completed = asArr(body.tracks).filter(track => action === 'add' ? ids.has(String(asObj(track).id)) : !ids.has(String(asObj(track).id))).length
        result(completed, issues[0])
      } catch (error) { result(null, messageOf(error)) }
    }
  } catch (error) {
    const status = error instanceof ManagementError ? error.status : 502
    if (wrote) {
      sendJson(res, { playlistId, status: 'unknown', requested, completed: null, error: messageOf(error) } satisfies PlatformPlaylistMutationResult, status === 401 || status === 409 ? status : 200)
    } else sendJson(res, { error: messageOf(error) }, status)
  } finally {
    if (lockKey) active.delete(lockKey)
  }
  return true
}

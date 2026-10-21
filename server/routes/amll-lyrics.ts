import type { RouteHandler, ServerContext } from '../types'
import { sendJson } from '../lib/http'
import { fetchAmllLyric, isAmllHostId, isAmllPlatform, isValidAmllId, probeAmllHosts } from '../lib/amll-lyrics'

/**
 * AMLL TTML DB 逐字歌词兜底：
 * - GET /api/amll/lyric?platform=ncm|qq&id=…[&host=…]：返回 { text }，库里没有时 text 为 null；
 *   host 为用户在设置里指定的优先线路（可选，未知值忽略）。
 * - GET /api/amll/probe：各线路测速，返回 { hosts: [{ id, ms }] }，不可用时 ms 为 null。
 */
export const amllLyricRoutes: RouteHandler = async (req, res, url, ctx: ServerContext) => {
  if (url.pathname !== '/api/amll/lyric' && url.pathname !== '/api/amll/probe') return false
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  if (url.pathname === '/api/amll/probe') {
    sendJson(res, { hosts: await probeAmllHosts() })
    return true
  }
  const platform = url.searchParams.get('platform')
  const id = url.searchParams.get('id') ?? ''
  if (!isAmllPlatform(platform) || !isValidAmllId(platform, id)) {
    sendJson(res, { error: 'INVALID_PARAMS', text: null }, 400)
    return true
  }
  const host = url.searchParams.get('host')
  try {
    sendJson(res, { text: await fetchAmllLyric(ctx.userDataDir, platform, id, fetch, Date.now, isAmllHostId(host) ? host : undefined) })
  } catch (err) {
    console.warn('[AmllLyric]', err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED', text: null }, 502)
  }
  return true
}

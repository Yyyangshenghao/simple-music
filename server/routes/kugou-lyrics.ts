import type { RouteHandler, ServerContext } from '../types'
import { sendJson } from '../lib/http'
import { fetchKugouLyric, parseKugouLyricQuery } from '../lib/kugou-lyrics'

/**
 * 酷狗逐字歌词兜底：
 * - GET /api/kugou/lyric?title=…&artist=…&duration=毫秒：返回 { candidates: [{ title, artist, duration, text }] }，
 *   没收录时为空数组；text 是解密后的 KRC 原文，是否同曲由调用方判定。
 */
export const kugouLyricRoutes: RouteHandler = async (req, res, url, ctx: ServerContext) => {
  if (url.pathname !== '/api/kugou/lyric') return false
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  const query = parseKugouLyricQuery(url.searchParams)
  if (!query) {
    sendJson(res, { error: 'INVALID_PARAMS', candidates: [] }, 400)
    return true
  }
  try {
    sendJson(res, { candidates: await fetchKugouLyric(ctx.userDataDir, query) })
  } catch (err) {
    console.warn('[KugouLyric]', err instanceof Error ? err.message : err)
    sendJson(res, { error: 'UPSTREAM_FAILED', candidates: [] }, 502)
  }
  return true
}

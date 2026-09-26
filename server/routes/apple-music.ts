import type { RouteHandler } from '../types'
import { revokeAppleMusicBridge } from '../lib/apple-music-bridge'
import { readJson, sendError, sendJson } from '../lib/http'
import { AppleMusicError, clearAppleMusicUserToken, fetchAppleMusic, getAppleMusicStatus, setAppleMusicConfig } from '../lib/apple-music'

export const appleMusicRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (!url.pathname.startsWith('/api/apple-music/')) return false
  const route = url.pathname.slice('/api/apple-music/'.length)
  if (!['status', 'config', 'catalog', 'logout'].includes(route)) return false
  res.setHeader('Cache-Control', 'no-store')
  const method = route === 'status' || route === 'catalog' ? 'GET' : 'POST'
  if (req.method !== method) {
    sendError(res, 405, '不支持的请求方法')
    return true
  }
  try {
    if (route === 'config') {
      const body = await readJson<unknown>(req)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppleMusicError(400, 'Apple Music 配置格式无效')
      setAppleMusicConfig(ctx, body)
      revokeAppleMusicBridge(ctx)
    }
    if (route === 'logout') {
      await ctx.appleMusicWeb?.logout()
      clearAppleMusicUserToken(ctx)
      revokeAppleMusicBridge(ctx)
    }
    sendJson(res, route === 'catalog' ? await fetchAppleMusic(ctx, url.searchParams.get('path') || '') : getAppleMusicStatus(ctx))
  } catch (error) {
    sendError(res, error instanceof AppleMusicError ? error.status : error instanceof SyntaxError ? 400 : 500,
      error instanceof AppleMusicError ? error.message : error instanceof SyntaxError ? '请求 JSON 格式无效' : 'Apple Music 配置操作失败')
  }
  return true
}

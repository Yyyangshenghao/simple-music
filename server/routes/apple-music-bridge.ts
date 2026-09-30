import type { RouteHandler } from '../types'
import { readJson, sendError, sendJson } from '../lib/http'
import { getValidatedAppleMusicConfig, setAppleMusicUserToken, clearAppleMusicUserToken } from '../lib/apple-music'
import { appleMusicPlayerPage } from '../lib/apple-music-page'
import { revokeAppleMusicBridge, openAppleMusicBridge, hasAppleMusicSession, appleMusicBridgeState, queueAppleMusicCommand, pollAppleMusicCommands, updateAppleMusicBridgeState, setAppleMusicBridgeLoggedIn, type AppleMusicCommand, type AppleMusicBridgeState } from '../lib/apple-music-bridge'

export const publicAppleMusicBridgeRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== '/apple-music-player' && !url.pathname.startsWith('/apple-music-bridge/')) return false
  res.removeHeader('Access-Control-Allow-Origin')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  const origin = `http://127.0.0.1:${ctx.port}`
  if (req.headers.host !== `127.0.0.1:${ctx.port}` || (req.headers.origin !== undefined && req.headers.origin !== origin)) {
    sendError(res, 403, 'Forbidden origin')
    return true
  }
  if (url.pathname === '/apple-music-player' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(appleMusicPlayerPage)
    return true
  }
  if (!hasAppleMusicSession(ctx, req.headers['x-apple-music-session'])) {
    sendError(res, 401, '播放会话已失效，请在应用中重新连接')
    return true
  }
  const readScoped = async <T>(): Promise<T> => {
    const body = await readJson<T>(req)
    if (!hasAppleMusicSession(ctx, req.headers['x-apple-music-session'])) throw new Error('播放会话已失效')
    return body
  }
  try {
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /apple-music-bridge/config':
        sendJson(res, getValidatedAppleMusicConfig(ctx))
        break
      case 'GET /apple-music-bridge/poll': {
        const ack = Number(url.searchParams.get('ack') ?? '0')
        if (!Number.isSafeInteger(ack) || ack < 0) throw new Error('无效确认序号')
        sendJson(res, { commands: pollAppleMusicCommands(ctx, ack) })
        break
      }
      case 'POST /apple-music-bridge/state':
        updateAppleMusicBridgeState(ctx, await readScoped<Partial<AppleMusicBridgeState>>())
        sendJson(res, { ok: true })
        break
      case 'POST /apple-music-bridge/auth': {
        const body = await readScoped<{ token: string; storefront?: string }>()
        getValidatedAppleMusicConfig(ctx)
        setAppleMusicUserToken(ctx, body.token, body.storefront)
        setAppleMusicBridgeLoggedIn(ctx, true)
        sendJson(res, { ok: true })
        break
      }
      case 'POST /apple-music-bridge/logout':
        clearAppleMusicUserToken(ctx)
        setAppleMusicBridgeLoggedIn(ctx, false)
        revokeAppleMusicBridge(ctx)
        sendJson(res, { ok: true })
        break
      default: sendError(res, 404, 'Not Found')
    }
  } catch (error) { sendError(res, 400, (error as Error).message) }
  return true
}

export const appleMusicBridgeRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (!url.pathname.startsWith('/api/apple-music/bridge/')) return false
  res.setHeader('Cache-Control', 'no-store')
  try {
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /api/apple-music/bridge/open': {
        const body = await readJson<{ mode?: string }>(req)
        if (!body || typeof body !== 'object' || (body.mode !== undefined && !['web', 'developer'].includes(body.mode))) throw new Error('无效登录方式')
        const mode = body.mode ?? (ctx.appleMusicWeb ? 'web' : 'developer')
        if (mode === 'web') {
          if (!ctx.appleMusicWeb) throw new Error('请在桌面应用中使用 Apple 官网登录')
          await ctx.appleMusicWeb.open()
          clearAppleMusicUserToken(ctx)
          revokeAppleMusicBridge(ctx)
          ctx.appleMusicLoginMode = 'web'
          sendJson(res, { opened: true })
          break
        }
        if (!getValidatedAppleMusicConfig(ctx).developerToken) throw new Error('请先配置 Apple Music 开发者令牌')
        await ctx.appleMusicWeb?.close()
        ctx.appleMusicLoginMode = 'developer'
        sendJson(res, { url: openAppleMusicBridge(ctx) })
        break
      }
      case 'GET /api/apple-music/bridge/state': sendJson(res, ctx.appleMusicWeb && ctx.appleMusicLoginMode !== 'developer' ? ctx.appleMusicWeb.state() : appleMusicBridgeState(ctx)); break
      case 'POST /api/apple-music/bridge/command': {
        const command = await readJson<AppleMusicCommand>(req)
        if (ctx.appleMusicWeb && ctx.appleMusicLoginMode !== 'developer') ctx.appleMusicWeb.command(command)
        else queueAppleMusicCommand(ctx, command)
        sendJson(res, { ok: true })
        break
      }
      case 'POST /api/apple-music/bridge/logout': {
        await ctx.appleMusicWeb?.logout()
        const state = appleMusicBridgeState(ctx)
        if (state.connected) queueAppleMusicCommand(ctx, { type: 'stop', playbackId: state.playbackId })
        clearAppleMusicUserToken(ctx)
        setAppleMusicBridgeLoggedIn(ctx, false)
        revokeAppleMusicBridge(ctx)
        sendJson(res, { ok: true })
        break
      }
      default: sendError(res, 404, 'Not Found')
    }
  } catch (error) { sendError(res, 400, (error as Error).message) }
  return true
}

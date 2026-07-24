import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerContext, RouteHandler } from './types'
import { neteaseRoutes } from './routes/netease'
import { podcastRoutes } from './routes/podcast'
import { beatmapRoutes } from './routes/beatmap'
import { qqRoutes } from './routes/qq-music'
import { localMusicRoutes } from './routes/local-music'
import { weatherRoutes } from './routes/weather'
import { updateRoutes } from './routes/update'
import { staticRoutes } from './routes/static'
import { sendError } from './lib/http'
import { isAllowedOrigin, isAllowedToken } from './lib/security'

// 静态路由放最后兜底（总是返回 true）；API 路由在前，未命中返回 false 继续匹配。
const chain: RouteHandler[] = [
  neteaseRoutes,
  podcastRoutes,
  beatmapRoutes,
  qqRoutes,
  localMusicRoutes,
  weatherRoutes,
  updateRoutes,
  staticRoutes
]

export function startServer(
  partial: Partial<ServerContext> = {}
): Promise<{ port: number; close(): void }> {
  const ctx: ServerContext = {
    userDataDir: partial.userDataDir ?? join(tmpdir(), 'simplemusic'),
    port: partial.port ?? 0,
    // 独立跑(npm run server:dev)与 electron dev 默认放行 localhost;打包应用由主进程传 false
    allowLocalhostOrigins: partial.allowLocalhostOrigins ?? true,
    token: partial.token
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // CORS：dev 下渲染层(localhost:5173)与 API server 不同源，需放行；
      // prod 下 file:// origin 为 null 同样需要 *。
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      // ACAO 为 * 意味着任何网页只要猜到端口就能读本地 API（扫盘、拿文件路径、
      // 借音频代理访问内网）。按 Origin 拒绝非渲染层来源，预检一并挡掉。
      if (!isAllowedOrigin(req.headers.origin, ctx.allowLocalhostOrigins)) {
        sendError(res, 403, 'Forbidden origin')
        return
      }
      // 写操作额外要求带 Origin:浏览器里的 fetch/XHR/表单一定带,`<img>`/`<audio>`
      // 这类不带 Origin 的跨源加载则再也触发不了扫盘、移除歌单等副作用。
      // 只在打包应用上收紧,免得挡掉开发时的 curl 调试。
      if (!ctx.allowLocalhostOrigins && req.method === 'POST' && !req.headers.origin) {
        sendError(res, 403, 'Forbidden origin')
        return
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      // 一次性 token 校验。<audio>/<img> 直连只能走 query,fetch/XHR 两者皆可 —— 两处都收。
      // ctx.token 缺省(独立 server / dev)时 isAllowedToken 放行。预检 OPTIONS 已在上方放行。
      const headerToken = req.headers['x-simplemusic-token']
      const provided =
        url.searchParams.get('token') ?? (Array.isArray(headerToken) ? headerToken[0] : headerToken)
      if (!isAllowedToken(ctx.token, provided)) {
        sendError(res, 401, 'Invalid token')
        return
      }
      try {
        for (const handler of chain) {
          if (await handler(req, res, url, ctx)) return
        }
        sendError(res, 404, 'Not Found')
      } catch (e) {
        if (!res.headersSent) sendError(res, 500, (e as Error).message)
        else res.end()
      }
    })
    server.listen(ctx.port, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : ctx.port
      ctx.port = port
      resolve({ port, close: () => server.close() })
    })
  })
}

// 直接运行：tsx server/index.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ port: Number(process.env.PORT) || 35530 }).then(({ port }) =>
    console.log(`[server] listening on http://127.0.0.1:${port}`)
  )
}

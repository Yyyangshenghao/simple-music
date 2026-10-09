import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerContext, RouteHandler } from './types'
import { catalogSearchRoutes } from './routes/catalog-search'
import { neteaseRoutes } from './routes/netease'
import { audioCacheRoutes } from './routes/audio-cache'
import { songDownloadRoutes } from './routes/song-downloads'
import { podcastRoutes } from './routes/podcast'
import { beatmapRoutes } from './routes/beatmap'
import { qqRoutes } from './routes/qq-music'
import { localMusicRoutes } from './routes/local-music'
import { weatherRoutes } from './routes/weather'
import { updateRoutes } from './routes/update'
import { staticRoutes } from './routes/static'
import { appleMusicRoutes } from './routes/apple-music'
import { appleMusicBridgeRoutes, publicAppleMusicBridgeRoutes } from './routes/apple-music-bridge'
import { sendError } from './lib/http'
import { isAllowedOrigin, isAllowedToken } from './lib/security'

// 静态路由放最后兜底（总是返回 true）；API 路由在前，未命中返回 false 继续匹配。
const chain: RouteHandler[] = [
  appleMusicBridgeRoutes,
  appleMusicRoutes,
  audioCacheRoutes,
  songDownloadRoutes,
  catalogSearchRoutes,
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
    defaultSongDownloadDir: partial.defaultSongDownloadDir,
    port: partial.port ?? 0,
    // 独立跑(npm run server:dev)与 electron dev 默认放行 localhost;打包应用由主进程传 false
    allowLocalhostOrigins: partial.allowLocalhostOrigins ?? true,
    appleMusicWeb: partial.appleMusicWeb,
    appleMusicLoginMode: partial.appleMusicLoginMode,
    token: partial.token
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let url: URL
      try {
        url = new URL(req.url ?? '/', 'http://127.0.0.1')
      } catch {
        sendError(res, 400, 'Invalid URL')
        return
      }
      // 浏览器播放页仅持有 Apple 专用会话凭据；不得取得桌面 API token。
      try {
        if (await publicAppleMusicBridgeRoutes(req, res, url, ctx)) return
      } catch {
        if (!res.headersSent) sendError(res, 500, 'Apple Music 播放连接失败')
        else res.end()
        return
      }
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

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
    port: partial.port ?? 0
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // CORS：dev 下渲染层(localhost:5173)与 API server 不同源，需放行；
      // prod 下 file:// origin 为 null 同样需要 *。
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
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

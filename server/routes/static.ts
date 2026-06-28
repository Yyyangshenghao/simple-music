import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import type { RouteHandler } from '../types'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
}

function serveFile(res: Parameters<RouteHandler>[1], filePath: string): void {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404)
    res.end('Not Found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

/**
 * 静态资源服务。public/ 目录 + 根路径回退到 index.html + favicon。
 * 防目录穿越：归一化后限定在 publicDir 内。
 */
export const staticRoutes: RouteHandler = async (req, res, url, ctx) => {
  const publicDir = join(ctx.userDataDir, 'public')
  const pn = url.pathname

  if (pn === '/favicon.ico') {
    serveFile(res, join(publicDir, 'favicon.ico'))
    return true
  }

  const rel = normalize(pn === '/' ? '/index.html' : pn).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(publicDir, rel)
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }
  serveFile(res, filePath)
  return true
}

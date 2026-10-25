import { promises as fsp } from 'node:fs'
import type { RouteHandler } from '../types'
import { readJson, sendJson } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import {
  WallpaperEngineError,
  getWallpaperEngineLibrary,
  getWallpaperEngineProject,
  resolveWallpaperPreviewFile,
  resolveWallpaperVideoFile,
  setWallpaperEngineRoot,
  wallpaperContentType
} from '../lib/wallpaper-engine'

/** 错误码保持稳定，由设置页翻成用户能看懂的原因。 */
function errorCode(error: unknown): string {
  return error instanceof WallpaperEngineError ? error.message : 'WALLPAPER_SCAN_FAILED'
}

/** Wallpaper Engine：列出 Steam 订阅的壁纸，并按 workshop id 提供预览图与视频入口。 */
export const wallpaperEngineRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname === '/api/wallpaper-engine/library') {
    if (req.method !== 'GET') return false
    try {
      const library = await getWallpaperEngineLibrary(ctx.userDataDir, { refresh: url.searchParams.get('refresh') === '1' })
      // 网页型壁纸的 iframe 专用 token，渲染层用它拼 /we-wallpaper/<token>/...
      sendJson(res, { ok: true, webToken: ctx.wallpaperWebToken ?? '', ...library })
    } catch (error) {
      sendJson(res, { ok: false, error: errorCode(error) }, 500)
    }
    return true
  }

  if (url.pathname === '/api/wallpaper-engine/config') {
    if (req.method !== 'POST') return false
    try {
      const body = await readJson<{ path?: unknown }>(req)
      if (body?.path !== null && typeof body?.path !== 'string') throw new WallpaperEngineError('WALLPAPER_DIR_INVALID')
      const library = await setWallpaperEngineRoot(ctx.userDataDir, body.path)
      sendJson(res, { ok: true, webToken: ctx.wallpaperWebToken ?? '', ...library })
    } catch (error) {
      sendJson(res, { ok: false, error: errorCode(error) }, 400)
    }
    return true
  }

  if (url.pathname === '/api/wallpaper-engine/preview' || url.pathname === '/api/wallpaper-engine/file') {
    if (req.method !== 'GET') return false
    const project = await getWallpaperEngineProject(ctx.userDataDir, url.searchParams.get('id') || '')
    const path = project
      ? url.pathname.endsWith('/preview') ? resolveWallpaperPreviewFile(project) : resolveWallpaperVideoFile(project)
      : null
    if (!path) {
      sendJson(res, { ok: false, error: 'WALLPAPER_MISSING' }, 404)
      return true
    }
    try {
      const stat = await fsp.stat(path)
      serveFileWithRange(res, path, stat.size, String(req.headers.range || ''), wallpaperContentType(path))
    } catch {
      sendJson(res, { ok: false, error: 'WALLPAPER_MISSING' }, 404)
    }
    return true
  }

  return false
}

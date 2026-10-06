import type { RouteHandler } from '../types'
import { readJson, sendJson } from '../lib/http'
import { exportDownloadedSong, getSongDownloadConfig, setSongDownloadDir } from '../lib/song-downloads'

export const songDownloadRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname === '/api/downloads/config') {
    try {
      if (req.method === 'GET') sendJson(res, await getSongDownloadConfig(ctx.userDataDir))
      else if (req.method === 'POST') {
        const body = await readJson<{ dir?: unknown }>(req)
        if (typeof body?.dir !== 'string') throw new Error('请选择下载文件夹')
        sendJson(res, await setSongDownloadDir(ctx.userDataDir, body.dir))
      } else return false
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : '目录不可写' }, 400)
    }
    return true
  }
  if (url.pathname !== '/api/downloads/export' || req.method !== 'POST') return false
  const controller = new AbortController()
  const cancel = () => controller.abort()
  res.once('close', cancel)
  try {
    const body = await readJson<{ entryId?: unknown; dir?: unknown; origin?: Record<string, unknown> }>(req)
    const origin = body?.origin
    if (typeof body?.entryId !== 'string' || typeof body.dir !== 'string'
      || !origin || (origin.source !== 'netease' && origin.source !== 'qq') || typeof origin.id !== 'string' || !origin.id) {
      throw new Error('无效的歌曲下载请求')
    }
    const result = await exportDownloadedSong(ctx.userDataDir, body.entryId, {
      source: origin.source, id: origin.id,
      name: typeof origin.name === 'string' ? origin.name : undefined,
      artist: typeof origin.artist === 'string' ? origin.artist : undefined,
    }, body.dir, controller.signal)
    if (!res.destroyed) sendJson(res, result)
  } catch (error) {
    if (!res.destroyed) sendJson(res, { error: error instanceof Error ? error.message : '歌曲文件保存失败' }, 400)
  } finally {
    res.off('close', cancel)
  }
  return true
}

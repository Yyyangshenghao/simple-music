import { promises as fsp } from 'node:fs'
import type { RouteHandler } from '../types'
import { sendError } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import { customBackgroundContentType, customBackgroundPath } from '../lib/custom-background'

/** 自定义背景：只按 id 读取主进程复制进 userData/backgrounds 的图片/视频，视频支持 Range。 */
export const customBackgroundRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname !== '/api/background/file') return false
  const id = url.searchParams.get('id') || ''
  const path = customBackgroundPath(ctx.userDataDir, id)
  if (!path) return sendError(res, 400, 'INVALID_ID'), true
  try {
    const st = await fsp.stat(path)
    serveFileWithRange(res, path, st.size, String(req.headers.range || ''), customBackgroundContentType(id))
  } catch {
    sendError(res, 404, 'FILE_MISSING')
  }
  return true
}

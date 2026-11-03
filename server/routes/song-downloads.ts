import type { RouteHandler } from '../types'
import { readJson, sendJson } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import { downloadContentType, downloadFromCache, findDownload, listDownloads, removeDownload } from '../lib/download-library'
import { getSongDownloadConfig, setSongDownloadDir } from '../lib/song-downloads'
import { promises as fs } from 'node:fs'

function refFrom(source: unknown, id: unknown): { source: 'netease' | 'qq'; id: string } | null {
  const text = String(id ?? '').trim()
  return (source === 'netease' || source === 'qq') && text ? { source, id: text } : null
}

export const songDownloadRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname === '/api/downloads/config') {
    try {
      if (req.method === 'GET') sendJson(res, await getSongDownloadConfig(ctx.userDataDir, ctx.defaultSongDownloadDir))
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

  if (url.pathname === '/api/downloads/library' && req.method === 'GET') {
    try {
      sendJson(res, { items: await listDownloads(ctx.userDataDir) })
    } catch {
      sendJson(res, { error: '下载记录读取失败' }, 500)
    }
    return true
  }

  if (url.pathname === '/api/downloads/file' && req.method === 'GET') {
    const ref = refFrom(url.searchParams.get('source'), url.searchParams.get('id'))
    // 只放行下载记录里登记过的文件，不接受任意路径。
    const record = ref ? await findDownload(ctx.userDataDir, ref) : null
    const stat = record ? await fs.stat(record.filePath).catch(() => null) : null
    if (!record || !stat?.isFile()) {
      sendJson(res, { error: 'DOWNLOAD_NOT_FOUND' }, 404)
      return true
    }
    serveFileWithRange(res, record.filePath, stat.size, String(req.headers.range || ''), downloadContentType(record.filePath))
    return true
  }

  if (url.pathname === '/api/downloads/delete' && req.method === 'POST') {
    const body = await readJson<{ origin?: Record<string, unknown>; savedAt?: unknown }>(req)
    const ref = refFrom(body?.origin?.source, body?.origin?.id)
    const savedAt = typeof body?.savedAt === 'number' && Number.isFinite(body.savedAt) ? body.savedAt : undefined
    if (!ref) {
      sendJson(res, { ok: false, error: 'INVALID_DOWNLOAD' }, 400)
      return true
    }
    if (!ctx.trashItem) {
      sendJson(res, { ok: false, error: 'TRASH_UNAVAILABLE' }, 501)
      return true
    }
    try {
      const removed = await removeDownload(ctx.userDataDir, ref, ctx.trashItem, savedAt)
      sendJson(res, removed ? { ok: true } : { ok: false, error: 'NOT_FOUND' }, removed ? 200 : 404)
    } catch {
      sendJson(res, { ok: false, error: 'TRASH_FAILED' }, 409)
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
    const text = (value: unknown) => typeof value === 'string' ? value : undefined
    const duration = Number(origin.duration)
    const result = await downloadFromCache(ctx.userDataDir, body.entryId, {
      source: origin.source, id: origin.id,
      name: text(origin.name), artist: text(origin.artist), album: text(origin.album), cover: text(origin.cover),
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    }, body.dir, controller.signal)
    if (!res.destroyed) sendJson(res, { filePath: result.filePath, size: result.size })
  } catch (error) {
    if (!res.destroyed) sendJson(res, { error: error instanceof Error ? error.message : '歌曲文件保存失败' }, 400)
  } finally {
    res.off('close', cancel)
  }
  return true
}

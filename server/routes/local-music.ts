import { promises as fsp } from 'node:fs'
import type { RouteHandler } from '../types'
import { readBody, sendJson, sendError } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import {
  addLocalFolder,
  removeLocalFolder,
  listLocalLibrary,
  findLocalTrack,
  localCoverPath,
  readLocalLyric,
  localAudioContentType,
} from '../lib/local-library'

/** 本地音乐:选文件夹扫描 + 索引持久化 + 音频/封面/歌词按 id 查路径服务。 */
export const localMusicRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname

  if (pn === '/api/local/tracks') {
    const { folders, tracks } = await listLocalLibrary(ctx.userDataDir)
    sendJson(res, { folders, tracks })
    return true
  }

  if (pn === '/api/local/scan') {
    try {
      const body = JSON.parse(await readBody(req) || '{}') as { path?: string }
      if (!body.path) return sendError(res, 400, 'Missing path'), true
      const tracks = await addLocalFolder(ctx.userDataDir, body.path)
      sendJson(res, { tracks })
    } catch (err) {
      console.error('[LocalScan]', err)
      sendError(res, 500, (err as Error).message || 'SCAN_FAILED')
    }
    return true
  }

  if (pn === '/api/local/remove-folder') {
    try {
      const body = JSON.parse(await readBody(req) || '{}') as { path?: string }
      if (!body.path) return sendError(res, 400, 'Missing path'), true
      await removeLocalFolder(ctx.userDataDir, body.path)
      sendJson(res, { ok: true })
    } catch (err) {
      console.error('[LocalRemoveFolder]', err)
      sendError(res, 500, (err as Error).message || 'REMOVE_FAILED')
    }
    return true
  }

  if (pn === '/api/local/audio') {
    const id = url.searchParams.get('id') || ''
    const record = id ? await findLocalTrack(ctx.userDataDir, id) : null
    if (!record) return sendError(res, 404, 'NOT_FOUND'), true
    try {
      const st = await fsp.stat(record.path)
      serveFileWithRange(res, record.path, st.size, String(req.headers.range || ''), localAudioContentType(record.path))
    } catch {
      sendError(res, 404, 'FILE_MISSING')
    }
    return true
  }

  if (pn === '/api/local/cover') {
    const id = url.searchParams.get('id') || ''
    const record = id ? await findLocalTrack(ctx.userDataDir, id) : null
    if (!record?.hasCover) return sendError(res, 404, 'NOT_FOUND'), true
    try {
      const path = localCoverPath(ctx.userDataDir, id)
      const data = await fsp.readFile(path)
      res.writeHead(200, {
        'Content-Type': record.coverFormat || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      })
      res.end(data)
    } catch {
      sendError(res, 404, 'FILE_MISSING')
    }
    return true
  }

  if (pn === '/api/local/lyric') {
    const id = url.searchParams.get('id') || ''
    const record = id ? await findLocalTrack(ctx.userDataDir, id) : null
    if (!record) return sendError(res, 404, 'NOT_FOUND'), true
    sendJson(res, { lyric: await readLocalLyric(record.path) })
    return true
  }

  return false
}

import { promises as fsp } from 'node:fs'
import type { RouteHandler } from '../types'
import { readBody, sendJson, sendError } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import { accompanimentFile, readKaraokeLibrary } from '../lib/karaoke-library'
import { serveStemMix } from '../lib/karaoke-stem-mix'
import {
  addLocalFolder,
  removeLocalFolder,
  listLocalLibrary,
  findLocalTrack,
  availableLocalTrackIds,
  localCoverPath,
  readLocalLyricSource,
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

  if (pn === '/api/local/availability') {
    if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED'), true
    try {
      const body = JSON.parse(await readBody(req) || '{}') as { ids?: unknown }
      if (!Array.isArray(body.ids) || body.ids.length > 100 || !body.ids.every(id => typeof id === 'string' && id.length > 0)) {
        return sendError(res, 400, 'INVALID_TRACK_IDS'), true
      }
      sendJson(res, { availableIds: await availableLocalTrackIds(ctx.userDataDir, body.ids) })
    } catch { sendError(res, 500, 'LOCAL_STATUS_FAILED') }
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
    if (id.startsWith('karaoke:')) {
      const file = await accompanimentFile(ctx.userDataDir, id.slice(8), ctx.defaultKaraokeDir, ctx.fallbackKaraokeDir)
      if (!file) return sendError(res, 404, 'FILE_MISSING'), true
      const range = String(req.headers.range || '')
      // stems=1 由播放器显式请求；其它读取方仍拿到普通立体声伴奏。
      if (file.vocalsPath && url.searchParams.get('stems') === '1' && await serveStemMix(res, file.path, file.vocalsPath, range)) return true
      serveFileWithRange(res, file.path, file.size, range, 'audio/wav')
      return true
    }
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
    if (id.startsWith('karaoke:')) {
      const item = (await readKaraokeLibrary(ctx.userDataDir, ctx.defaultKaraokeDir, ctx.fallbackKaraokeDir)).items.find(item => item.id === id.slice(8))
      if (!item) return sendError(res, 404, 'NOT_FOUND'), true
      const local = item.track.source === 'local' ? await findLocalTrack(ctx.userDataDir, String(item.track.id)) : null
      const lyric = local ? await readLocalLyricSource(local) : {}
      sendJson(res, { ...lyric, original: item.track })
      return true
    }
    const record = id ? await findLocalTrack(ctx.userDataDir, id) : null
    if (!record) return sendError(res, 404, 'NOT_FOUND'), true
    // 只回传歌词文本与标签元数据，不回传文件路径。
    sendJson(res, await readLocalLyricSource(record))
    return true
  }

  return false
}

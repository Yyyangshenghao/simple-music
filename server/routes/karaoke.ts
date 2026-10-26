import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import { serveFileWithRange } from '../lib/audio-cache'
import {
  ensureKaraokeModel,
  findKaraokeStem,
  karaokeModelFile,
  karaokeModelStatus,
  writeKaraokeStem,
} from '../lib/karaoke-store'

/** 伴奏 key 形如 `netease:123`、`local:abc`；只做长度与字符校验，落盘前取摘要。 */
function stemKey(url: URL): string | null {
  const key = url.searchParams.get('key') ?? ''
  return /^[a-z]+:[^\s]{1,200}$/.test(key) ? key : null
}

export const karaokeRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/karaoke/')) return false

  if (pn === '/api/karaoke/model' && req.method === 'GET') {
    sendJson(res, await karaokeModelStatus(ctx.userDataDir))
    return true
  }

  if (pn === '/api/karaoke/model' && req.method === 'POST') {
    sendJson(res, await ensureKaraokeModel(ctx.userDataDir))
    return true
  }

  if (pn === '/api/karaoke/model/file' && req.method === 'GET') {
    const file = await karaokeModelFile(ctx.userDataDir)
    if (!file) {
      sendJson(res, { error: 'MODEL_NOT_READY' }, 404)
      return true
    }
    serveFileWithRange(res, file.path, file.size, String(req.headers.range || ''), 'application/octet-stream')
    return true
  }

  if (pn === '/api/karaoke/stem' && (req.method === 'GET' || req.method === 'HEAD')) {
    const key = stemKey(url)
    const stem = key ? await findKaraokeStem(ctx.userDataDir, key) : null
    if (!stem) {
      sendJson(res, { error: 'STEM_NOT_FOUND' }, 404)
      return true
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(stem.size), 'Access-Control-Allow-Origin': '*' })
      res.end()
      return true
    }
    serveFileWithRange(res, stem.path, stem.size, String(req.headers.range || ''), 'audio/wav')
    return true
  }

  if (pn === '/api/karaoke/stem' && req.method === 'POST') {
    const key = stemKey(url)
    if (!key) {
      sendJson(res, { error: 'INVALID_KEY' }, 400)
      return true
    }
    try {
      sendJson(res, { ok: true, bytes: await writeKaraokeStem(ctx.userDataDir, key, req) })
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : '伴奏保存失败' }, 400)
    }
    return true
  }

  return false
}

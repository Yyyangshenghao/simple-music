import type { RouteHandler } from '../types'
import { readJson, sendJson } from '../lib/http'
import { readKaraokeLibrary, setKaraokeDirectory, saveAccompaniment, deleteAccompaniment } from '../lib/karaoke-library'
import { karaokeResources } from '../lib/karaoke-resources'
import { serveFileWithRange } from '../lib/audio-cache'
import {
  KARAOKE_STEM_LIMIT_BYTES,
  clearKaraokeStems,
  ensureKaraokeModel,
  findKaraokeStem,
  karaokeModelFile,
  karaokeModelInfo,
  karaokeModelStatus,
  karaokeModelViews,
  uninstallKaraokeModel,
  writeKaraokeStem,
  type KaraokeModelInfo,
} from '../lib/karaoke-store'

/** 伴奏 key 形如 `netease:123`、`local:abc`；只做长度与字符校验，落盘前取摘要。 */
function stemKey(url: URL): string | null {
  const key = url.searchParams.get('key') ?? ''
  return /^[a-z]+:[^\s]{1,200}$/.test(key) ? key : null
}

function modelOf(url: URL): KaraokeModelInfo | undefined {
  return karaokeModelInfo(url.searchParams.get('model') ?? '')
}

export const karaokeRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/karaoke/')) return false

  if (pn.startsWith('/api/karaoke/library')) {
    try {
      if (pn === '/api/karaoke/library' && req.method === 'GET') {
        sendJson(res, await readKaraokeLibrary(ctx.userDataDir, ctx.defaultKaraokeDir, ctx.fallbackKaraokeDir))
      } else if (pn === '/api/karaoke/library/directory' && req.method === 'POST') {
        const body = await readJson<{ directory: string }>(req)
        if (typeof body.directory !== 'string') throw new Error('请选择伴奏保存文件夹')
        await setKaraokeDirectory(ctx.userDataDir, body.directory, ctx.defaultKaraokeDir, ctx.fallbackKaraokeDir)
        sendJson(res, { ok: true })
      } else if (pn === '/api/karaoke/library/save' && req.method === 'POST') {
        sendJson(res, await saveAccompaniment(ctx.userDataDir, await readJson(req), { defaultDir: ctx.defaultKaraokeDir, fallbackDir: ctx.fallbackKaraokeDir }))
      } else if (pn === '/api/karaoke/library/delete' && req.method === 'POST') {
        const body = await readJson<{ id: string; generatedAt: number }>(req)
        await deleteAccompaniment(ctx.userDataDir, body.id, body.generatedAt, ctx.defaultKaraokeDir, ctx.fallbackKaraokeDir)
        sendJson(res, { ok: true })
      } else return false
    } catch (error) { sendJson(res, { error: error instanceof Error ? error.message : '伴奏操作失败' }, 400) }
    return true
  }

  if (pn === '/api/karaoke/resources' && req.method === 'GET') {
    const model = modelOf(url)
    const duration = Number(url.searchParams.get('duration') ?? 0)
    if (!model || !Number.isFinite(duration) || duration < 0) sendJson(res, { error: 'INVALID_RESOURCE_QUERY' }, 400)
    else sendJson(res, karaokeResources(model.id, duration, ctx.karaokeMemory?.()))
    return true
  }

  if (pn === '/api/karaoke/models' && req.method === 'GET') {
    sendJson(res, { models: await karaokeModelViews(ctx.userDataDir), stemLimitBytes: KARAOKE_STEM_LIMIT_BYTES })
    return true
  }

  if (pn === '/api/karaoke/stems/clear' && req.method === 'POST') {
    const id = url.searchParams.get('model')
    const model = id ? karaokeModelInfo(id) : undefined
    if (id && !model) {
      sendJson(res, { error: 'UNKNOWN_MODEL' }, 400)
      return true
    }
    await clearKaraokeStems(ctx.userDataDir, model?.id)
    sendJson(res, { ok: true })
    return true
  }

  const model = modelOf(url)
  if (!model) {
    sendJson(res, { error: 'UNKNOWN_MODEL' }, 400)
    return true
  }

  // 状态带上前后处理参数与精度，分离页据此配置 Worker
  const meta = { params: model.params, precision: model.precision }
  if (pn === '/api/karaoke/model' && req.method === 'GET') {
    sendJson(res, { ...await karaokeModelStatus(ctx.userDataDir, model), ...meta })
    return true
  }

  if (pn === '/api/karaoke/model' && req.method === 'POST') {
    sendJson(res, { ...await ensureKaraokeModel(ctx.userDataDir, model), ...meta })
    return true
  }

  if (pn === '/api/karaoke/model/uninstall' && req.method === 'POST') {
    await uninstallKaraokeModel(ctx.userDataDir, model)
    sendJson(res, { ok: true })
    return true
  }

  if (pn === '/api/karaoke/model/file' && req.method === 'GET') {
    const file = await karaokeModelFile(ctx.userDataDir, model)
    if (!file) {
      sendJson(res, { error: 'MODEL_NOT_READY' }, 404)
      return true
    }
    serveFileWithRange(res, file.path, file.size, String(req.headers.range || ''), 'application/octet-stream')
    return true
  }

  if (pn === '/api/karaoke/stem' && (req.method === 'GET' || req.method === 'HEAD')) {
    const key = stemKey(url)
    const stem = key ? await findKaraokeStem(ctx.userDataDir, model.id, key) : null
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
    const part = url.searchParams.get('part')
    if (part !== null && part !== 'vocals') {
      sendJson(res, { error: 'INVALID_PART' }, 400)
      return true
    }
    try {
      sendJson(res, { ok: true, bytes: await writeKaraokeStem(ctx.userDataDir, model.id, key, req, undefined, part ?? undefined) })
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : '伴奏保存失败' }, 400)
    }
    return true
  }

  return false
}

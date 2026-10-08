import type { IncomingMessage } from 'node:http'
import type { RouteHandler } from '../types'
import { readJson, sendJson } from '../lib/http'
import { isSafeUpstreamUrl } from '../lib/security'
import { fetchSafeUpstream } from '../lib/upstream-fetch'
import {
  audioCacheDir,
  audioCacheStats,
  clearAudioCacheScope,
  deleteAudioCacheEntry,
  getAudioCacheConfig,
  getAudioCacheStatuses,
  listSavedAudioCache,
  openAudioCacheEntry,
  openAudioCacheWriter,
  pinAudioCacheEntry,
  serveFileWithRange,
  updateAudioCacheConfig,
  type AudioCacheContext,
  type AudioCacheOriginInput,
} from '../lib/audio-cache'
import { audioContentTypeForUrl, audioProxyHeadersFor } from '../lib/netease-client'

type OnlineSource = 'netease' | 'qq'

const saveProgress = new Map<string, { receivedBytes: number; totalBytes: number }>()

function isOnlineSource(value: unknown): value is OnlineSource {
  return value === 'netease' || value === 'qq'
}

function originFrom(value: unknown): AudioCacheOriginInput | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = String(raw.id ?? '').trim()
  if (!isOnlineSource(raw.source) || !id) return null
  const duration = Number(raw.duration)
  return {
    source: raw.source,
    id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    artist: typeof raw.artist === 'string' ? raw.artist : undefined,
    album: typeof raw.album === 'string' ? raw.album : undefined,
    cover: typeof raw.cover === 'string' ? raw.cover : undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  }
}

export function expectedAudioLength(status: number, contentLength: string | null, contentRange: string | null): number | null {
  const length = Number(contentLength)
  if (!Number.isSafeInteger(length) || length <= 0) return null
  if (status === 200) return length
  if (status !== 206 || !contentRange) return null
  const match = /^bytes 0-(\d+)\/(\d+)$/.exec(contentRange.trim())
  if (!match) return null
  const end = Number(match[1])
  const total = Number(match[2])
  return Number.isSafeInteger(total) && total > 0 && end + 1 === total && length === total ? total : null
}

export function isSupportedAudioPayload(contentType: string | null, firstChunk: Uint8Array): boolean {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
  if (mime.startsWith('audio/') || mime === 'application/ogg') return true
  const text = String.fromCharCode(...firstChunk.slice(0, 12))
  if (text.startsWith('ID3') || text.startsWith('fLaC') || text.startsWith('OggS') || text.startsWith('RIFF')) return true
  if (text.slice(4, 8) === 'ftyp') return true
  return firstChunk.length >= 2 && firstChunk[0] === 0xff && (firstChunk[1] & 0xe0) === 0xe0
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const value = await readJson<unknown>(req)
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function mutationStatus(error: string): number {
  if (error === 'NOT_FOUND') return 404
  if (error === 'CACHE_SHARED' || error === 'CACHE_BUSY' || error === 'PINNED_CONTENT') return 409
  return 400
}

export const audioCacheRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname

  if (pn === '/api/audio-cache/progress' && req.method === 'GET') {
    const id = url.searchParams.get('id') || ''
    sendJson(res, saveProgress.get(`${ctx.userDataDir}:${id}`) ?? {})
    return true
  }

  if (pn === '/api/audio-cache/library' && req.method === 'GET') {
    sendJson(res, { items: await listSavedAudioCache(ctx.userDataDir) })
    return true
  }

  if (pn === '/api/audio-cache/status' && req.method === 'POST') {
    const body = await bodyOf(req)
    const raw = Array.isArray(body.tracks) ? body.tracks.slice(0, 100) : []
    const tracks = raw.flatMap((item) => {
      const origin = originFrom(item)
      return origin ? [{ source: origin.source, id: origin.id }] : []
    })
    sendJson(res, { statuses: await getAudioCacheStatuses(ctx.userDataDir, tracks) })
    return true
  }

  if (pn === '/api/audio-cache/file' && req.method === 'GET') {
    const entryId = url.searchParams.get('entryId') || ''
    const source = url.searchParams.get('source')
    const id = url.searchParams.get('id') || ''
    if (!entryId || !isOnlineSource(source) || !id) {
      sendJson(res, { error: 'INVALID_CACHE_ENTRY' }, 400)
      return true
    }
    const hit = await openAudioCacheEntry(ctx.userDataDir, entryId, { source, id })
    if (!hit) {
      sendJson(res, { error: 'CACHE_NOT_FOUND' }, 404)
      return true
    }
    serveFileWithRange(res, hit.path, hit.size, String(req.headers.range || ''), hit.contentType, hit.release)
    return true
  }

  if (pn === '/api/audio-cache/save' && req.method === 'POST') {
    const body = await bodyOf(req)
    const audioUrl = typeof body.url === 'string' ? body.url : ''
    const cacheKey = typeof body.cacheKey === 'string' ? body.cacheKey.trim() : ''
    const origin = originFrom(body.origin)
    const resolved = originFrom(body.resolved)
    const quality = typeof body.quality === 'string' ? body.quality.trim() : ''
    if (!audioUrl || !isSafeUpstreamUrl(audioUrl) || !cacheKey || !origin || !resolved || !quality || body.trial === true) {
      sendJson(res, { ok: false, error: 'INVALID_SAVE_REQUEST' }, 400)
      return true
    }
    if (cacheKey !== `${resolved.source}:${resolved.id}:${quality}`) {
      sendJson(res, { ok: false, error: 'CACHE_KEY_MISMATCH' }, 400)
      return true
    }

    const aborter = new AbortController()
    const progressId = typeof body.progressId === 'string' && /^[a-z0-9-]{1,64}$/i.test(body.progressId) ? body.progressId : ''
    const progressKey = progressId ? `${ctx.userDataDir}:${progressId}` : ''
    const reportProgress = (receivedBytes: number, totalBytes: number) => {
      if (!progressKey) return
      if (!saveProgress.has(progressKey) && saveProgress.size >= 256) return
      saveProgress.set(progressKey, { receivedBytes, totalBytes })
    }
    const onClose = () => aborter.abort()
    res.once('close', onClose)
    let writer: Awaited<ReturnType<typeof openAudioCacheWriter>> = null
    try {
      const upstream = await fetchSafeUpstream(audioUrl, {
        headers: audioProxyHeadersFor(audioUrl, ''),
        signal: aborter.signal,
      })
      const expectedBytes = expectedAudioLength(
        upstream.status,
        upstream.headers.get('content-length'),
        upstream.headers.get('content-range')
      )
      const reader = upstream.body?.getReader()
      if (!upstream.ok || !expectedBytes || !reader) throw new Error('INCOMPLETE_UPSTREAM_AUDIO')
      const first = await reader.read()
      if (first.done || !isSupportedAudioPayload(upstream.headers.get('content-type'), first.value)) {
        await reader.cancel().catch(() => {})
        throw new Error('UNSUPPORTED_AUDIO_PAYLOAD')
      }
      const context: AudioCacheContext = {
        origin,
        resolved,
        quality,
        contentType: audioContentTypeForUrl(audioUrl, upstream.headers.get('content-type')),
        expectedBytes,
        pinned: true,
      }
      writer = await openAudioCacheWriter(ctx.userDataDir, cacheKey, context)
      if (!writer) throw new Error('CACHE_BUSY')
      await writer.write(first.value)
      let receivedBytes = first.value.byteLength
      reportProgress(receivedBytes, expectedBytes)
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        await writer.write(chunk.value)
        receivedBytes += chunk.value.byteLength
        reportProgress(receivedBytes, expectedBytes)
      }
      const committed = await writer.commit()
      writer = null
      if (!committed) throw new Error('CACHE_SAVE_INCOMPLETE')
      const [status] = await getAudioCacheStatuses(ctx.userDataDir, [{ source: origin.source, id: origin.id }])
      sendJson(res, { ok: true, status })
    } catch (error) {
      writer?.abort()
      if (!res.destroyed && !res.headersSent) {
        const message = error instanceof Error ? error.message : 'CACHE_SAVE_FAILED'
        sendJson(res, { ok: false, error: message }, message === 'CACHE_BUSY' ? 409 : 502)
      }
    } finally {
      if (progressKey) saveProgress.delete(progressKey)
      res.off('close', onClose)
    }
    return true
  }

  if (pn === '/api/audio-cache/pin' && req.method === 'POST') {
    const body = await bodyOf(req)
    const origin = originFrom(body.origin)
    const entryId = typeof body.entryId === 'string' ? body.entryId : ''
    if (!origin || !entryId) {
      sendJson(res, { ok: false, error: 'INVALID_CACHE_ENTRY' }, 400)
      return true
    }
    const result = await pinAudioCacheEntry(ctx.userDataDir, entryId, origin, body.pinned !== false)
    sendJson(res, result, result.ok ? 200 : mutationStatus(result.error))
    return true
  }

  if (pn === '/api/audio-cache/delete' && req.method === 'POST') {
    const body = await bodyOf(req)
    const origin = originFrom(body.origin)
    const entryId = typeof body.entryId === 'string' ? body.entryId : ''
    if (!origin || !entryId || (body.savedAt !== undefined && (typeof body.savedAt !== 'number' || !Number.isFinite(body.savedAt) || body.savedAt < 0))) {
      sendJson(res, { ok: false, error: 'INVALID_CACHE_ENTRY' }, 400)
      return true
    }
    const result = await deleteAudioCacheEntry(ctx.userDataDir, entryId, origin, body.confirmShared === true, body.savedAt as number | undefined)
    sendJson(res, result, result.ok ? 200 : mutationStatus(result.error))
    return true
  }

  if (pn === '/api/audio-cache/clear' && req.method === 'POST') {
    const body = await bodyOf(req)
    const scope = body.scope === 'pinned' || body.scope === 'unmanaged' || body.scope === 'all' ? body.scope : 'temporary'
    const result = await clearAudioCacheScope(ctx.userDataDir, scope)
    sendJson(res, result, result.ok ? 200 : mutationStatus(result.error))
    return true
  }

  if (pn === '/api/audio-cache/stats' && req.method === 'GET') {
    sendJson(res, await audioCacheStats(ctx.userDataDir))
    return true
  }

  if (pn === '/api/audio-cache/config') {
    if (req.method === 'POST') {
      const body = await bodyOf(req)
      const result = await updateAudioCacheConfig(ctx.userDataDir, {
        dir: typeof body.dir === 'string' ? body.dir : undefined,
        limitBytes: body.limitBytes == null ? undefined : Number(body.limitBytes),
        confirmPinned: body.confirmPinned === true,
      })
      if (!result.ok) {
        sendJson(res, result, mutationStatus(result.error))
        return true
      }
      sendJson(res, { ok: true, ...result.config, defaultDir: audioCacheDir(ctx.userDataDir) })
      return true
    }
    const config = await getAudioCacheConfig(ctx.userDataDir)
    sendJson(res, { ...config, defaultDir: audioCacheDir(ctx.userDataDir) })
    return true
  }

  return false
}

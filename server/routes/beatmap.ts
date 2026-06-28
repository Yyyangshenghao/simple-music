import type { RouteHandler, ServerContext } from '../types'
import { readBody, sendJson } from '../lib/http'
import {
  beatCacheRootInfo,
  readBeatMapCache,
  writeBeatMapCache,
  BeatCacheError,
} from '../lib/beatmap'

function errInfo(err: unknown, ctx: ServerContext) {
  return err instanceof BeatCacheError ? err.info : beatCacheRootInfo(ctx)
}
function errReason(err: unknown, fallback: string): string {
  if (err instanceof BeatCacheError) return err.code
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export const beatmapRoutes: RouteHandler = async (req, res, url, ctx: ServerContext) => {
  const pn = url.pathname

  // ---------- 缓存状态 ----------
  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo(ctx)
    sendJson(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : !info.available ? 'TARGET_DRIVE_UNAVAILABLE' : '',
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    })
    return true
  }

  // ---------- 缓存读写 ----------
  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || ''
      try {
        const entry = readBeatMapCache(ctx, key)
        sendJson(
          res,
          entry
            ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
            : { ok: true, hit: false, key }
        )
      } catch (err) {
        const info = errInfo(err, ctx)
        sendJson(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: errReason(err, 'BEAT_CACHE_READ_FAILED'),
          dir: info.dir,
        })
      }
      return true
    }

    if (req.method === 'POST') {
      try {
        const raw = await readBody(req)
        let body: unknown = {}
        if (raw) {
          try {
            body = JSON.parse(raw)
          } catch {
            body = {}
          }
        }
        sendJson(res, writeBeatMapCache(ctx, body))
      } catch (err) {
        const info = errInfo(err, ctx)
        sendJson(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: errReason(err, 'BEAT_CACHE_WRITE_FAILED'),
          dir: info.dir,
        })
      }
      return true
    }

    sendJson(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }

  return false
}

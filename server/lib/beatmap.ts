import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname, resolve, parse as parsePath } from 'node:path'
import type { ServerContext } from '../types'
import { getBeatmapCacheDir } from './cookie'

export interface BeatCacheRootInfo {
  dir: string
  root: string
  drive: string
  allowed: boolean
  available: boolean
}

export interface BeatMapCacheEntry {
  v: number
  key: string
  savedAt: number
  meta: {
    provider: string
    title: string
    artist: string
    mode: string
  }
  map: Record<string, unknown>
}

/**
 * 缓存目录信息。替代原项目硬编码的 `D:\\MineradioCache\\beatmaps`：
 * 现在统一走 `getBeatmapCacheDir(ctx)`（默认 userData 下的 beatmaps 目录）。
 * 仍保留原有「C 盘禁用 / 目标盘不可用」的判定逻辑，以兼容用户通过
 * MINERADIO_BEAT_CACHE_DIR 指向 Windows 盘符的场景。
 */
export function beatCacheRootInfo(ctx: ServerContext): BeatCacheRootInfo {
  const dir = resolve(getBeatmapCacheDir(ctx))
  const root = parsePath(dir).root
  const drive = root ? root.replace(/[\\/]+$/, '').toUpperCase() : ''
  const allowed = !!root && !/^C:$/i.test(drive)
  const available = allowed && existsSync(root)
  return { dir, root, drive, allowed, available }
}

export class BeatCacheError extends Error {
  code: string
  info: BeatCacheRootInfo
  constructor(code: string, info: BeatCacheRootInfo) {
    super(code)
    this.name = 'BeatCacheError'
    this.code = code
    this.info = info
  }
}

function ensureBeatMapCacheDir(ctx: ServerContext): string {
  const info = beatCacheRootInfo(ctx)
  if (!info.allowed) throw new BeatCacheError('BEAT_CACHE_ON_C_DRIVE_DISABLED', info)
  if (!info.available) throw new BeatCacheError('BEAT_CACHE_DRIVE_UNAVAILABLE', info)
  mkdirSync(info.dir, { recursive: true })
  return info.dir
}

function safeBeatMapCacheFile(ctx: ServerContext, key: string): string | null {
  const raw = String(key || '').trim()
  if (!raw || raw.length > 240) return null
  const hash = createHash('sha1').update(raw).digest('hex')
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap'
  return join(ensureBeatMapCacheDir(ctx), `${label}-${hash}.json`)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function compactBeatMapCachePayload(body: unknown): BeatMapCacheEntry | null {
  const b = isObject(body) ? body : {}
  const key = String(b.key || '').trim()
  const map = b.map
  if (!key || !isObject(map)) return null
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(b.provider || '').slice(0, 32),
      title: String(b.title || '').slice(0, 160),
      artist: String(b.artist || '').slice(0, 160),
      mode: String(b.mode || 'mr').slice(0, 32),
    },
    map,
  }
}

export function readBeatMapCache(ctx: ServerContext, key: string): BeatMapCacheEntry | null {
  const file = safeBeatMapCacheFile(ctx, key)
  if (!file || !existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null
  return raw && isObject(raw.map) ? (raw as unknown as BeatMapCacheEntry) : null
}

export interface BeatMapWriteResult {
  ok: boolean
  key?: string
  savedAt?: number
  dir?: string
  error?: string
}

export function writeBeatMapCache(ctx: ServerContext, body: unknown): BeatMapWriteResult {
  const payload = compactBeatMapCachePayload(body)
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' }
  const file = safeBeatMapCacheFile(ctx, payload.key)
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' }
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(payload))
  renameSync(tmp, file)
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: dirname(file) }
}

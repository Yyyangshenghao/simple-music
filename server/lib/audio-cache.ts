import { createHash } from 'node:crypto'
import { createWriteStream, createReadStream, type WriteStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import type { ServerResponse } from 'node:http'

/**
 * 音频磁盘缓存:/api/audio 代理整流下载时落盘,重复播放直接本地文件服务。
 * - key 由渲染层传入(source:id:quality),上游 URL 带过期签名不能当 key。
 * - 只缓存"从 0 字节起且上游覆盖完整文件"的整流;拖进度条的中段 Range 只透传不落盘。
 * - 写入先落 .part 临时文件,完整后 rename,不会出现半截缓存被命中。
 * - LRU 以文件 mtime 近似:命中续期,超限从最旧开始淘汰。
 * - 目录与上限可配,持久化在 userDataDir/audio-cache-config.json(设置页经 /api/audio-cache/config 读写)。
 */

export const AUDIO_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024 // 默认 2GB
export const AUDIO_CACHE_MIN_LIMIT = 256 * 1024 * 1024 // 256MB
export const AUDIO_CACHE_MAX_LIMIT = 100 * 1024 * 1024 * 1024 // 100GB

const CONFIG_FILE = 'audio-cache-config.json'

export interface AudioCacheConfig {
  dir: string
  limitBytes: number
}

/** 默认缓存目录(未配置时使用;也是设置页"恢复默认"的目标)。 */
export function audioCacheDir(userDataDir: string): string {
  return join(userDataDir, 'audio-cache')
}

function clampLimit(n: number): number {
  return Math.min(AUDIO_CACHE_MAX_LIMIT, Math.max(AUDIO_CACHE_MIN_LIMIT, Math.floor(n)))
}

let configMemo: { key: string; config: AudioCacheConfig } | null = null

export async function getAudioCacheConfig(userDataDir: string): Promise<AudioCacheConfig> {
  if (configMemo?.key === userDataDir) return configMemo.config
  const config: AudioCacheConfig = { dir: audioCacheDir(userDataDir), limitBytes: AUDIO_CACHE_LIMIT_BYTES }
  try {
    const raw = JSON.parse(await fsp.readFile(join(userDataDir, CONFIG_FILE), 'utf8')) as Partial<AudioCacheConfig>
    if (typeof raw.dir === 'string' && isAbsolute(raw.dir)) config.dir = raw.dir
    if (typeof raw.limitBytes === 'number' && Number.isFinite(raw.limitBytes)) config.limitBytes = clampLimit(raw.limitBytes)
  } catch {
    /* 无配置文件或损坏:用默认 */
  }
  configMemo = { key: userDataDir, config }
  return config
}

/** 探测目录可写:建目录 + 写删探针文件。 */
async function probeWritable(dir: string): Promise<boolean> {
  try {
    await fsp.mkdir(dir, { recursive: true })
    const probe = join(dir, '.sm-write-probe')
    await fsp.writeFile(probe, '')
    await fsp.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 更新缓存配置。dir 传空字符串 = 恢复默认目录;目录变更时清空旧目录里的缓存文件(缓存可再生,避免残留占盘)。
 * limitBytes 会被钳到 [256MB, 100GB];缩小上限立即触发一次淘汰。
 */
export async function updateAudioCacheConfig(
  userDataDir: string,
  patch: { dir?: string; limitBytes?: number }
): Promise<{ ok: true; config: AudioCacheConfig } | { ok: false; error: string }> {
  const current = await getAudioCacheConfig(userDataDir)
  const next: AudioCacheConfig = { ...current }

  if (patch.limitBytes != null) {
    if (typeof patch.limitBytes !== 'number' || !Number.isFinite(patch.limitBytes)) {
      return { ok: false, error: 'INVALID_LIMIT' }
    }
    next.limitBytes = clampLimit(patch.limitBytes)
  }

  if (patch.dir != null) {
    const dir = String(patch.dir).trim() || audioCacheDir(userDataDir)
    if (!isAbsolute(dir)) return { ok: false, error: 'DIR_NOT_ABSOLUTE' }
    if (!(await probeWritable(dir))) return { ok: false, error: 'DIR_NOT_WRITABLE' }
    next.dir = dir
  }

  try {
    await fsp.mkdir(userDataDir, { recursive: true })
    await fsp.writeFile(join(userDataDir, CONFIG_FILE), JSON.stringify(next, null, 2))
  } catch {
    return { ok: false, error: 'CONFIG_SAVE_FAILED' }
  }

  const oldDir = current.dir
  configMemo = { key: userDataDir, config: next }
  if (next.dir !== oldDir) {
    await clearCacheFilesIn(oldDir)
  }
  if (next.limitBytes < current.limitBytes) {
    await enforceCacheLimit(next.dir, next.limitBytes).catch(() => {})
  }
  return { ok: true, config: next }
}

function fileNameFor(key: string): string {
  return createHash('sha1').update(key).digest('hex') + '.bin'
}

/** 请求是否从 0 字节起、可整体缓存(无 Range 或 bytes=0-;播放器起播即这两种形态)。 */
export function isFullStreamRequest(range: string): boolean {
  const r = range.trim()
  return r === '' || /^bytes=0-$/i.test(r)
}

/** 上游响应是否覆盖完整文件:200,或 206 且 Content-Range 为 bytes 0-(N-1)/N。 */
export function coversWholeFile(status: number, contentRange: string | null): boolean {
  if (status === 200) return true
  if (status !== 206 || !contentRange) return false
  const m = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(contentRange.trim())
  if (!m) return false
  return Number(m[1]) + 1 === Number(m[2])
}

/** 解析播放器 Range 头(bytes=start- / bytes=start-end);无效或越界返回 null(应回 416)。 */
export function parseByteRange(range: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d+)-(\d*)$/i.exec(range.trim())
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) return null
  return { start, end }
}

/** 查缓存命中;命中时续期 mtime(LRU)。 */
export async function findCachedAudio(
  userDataDir: string,
  key: string
): Promise<{ path: string; size: number } | null> {
  const p = join((await getAudioCacheConfig(userDataDir)).dir, fileNameFor(key))
  try {
    const st = await fsp.stat(p)
    const now = new Date()
    await fsp.utimes(p, now, now).catch(() => {})
    return { path: p, size: st.size }
  } catch {
    return null
  }
}

export interface AudioCacheWriter {
  write(chunk: Uint8Array): void
  /** 整流转发完成后调用:关流、rename 为正式缓存、执行 LRU 淘汰。 */
  commit(): Promise<void>
  /** 中途断开(切歌)时调用:丢弃临时文件。 */
  abort(): void
}

export async function openAudioCacheWriter(userDataDir: string, key: string): Promise<AudioCacheWriter | null> {
  const { dir, limitBytes } = await getAudioCacheConfig(userDataDir)
  const final = join(dir, fileNameFor(key))
  const temp = final + '.part'
  let stream: WriteStream
  try {
    await fsp.mkdir(dir, { recursive: true })
    stream = createWriteStream(temp)
  } catch {
    return null
  }
  let failed = false
  stream.on('error', () => {
    failed = true
  })
  return {
    write(chunk) {
      if (!failed) stream.write(chunk)
    },
    async commit() {
      await new Promise<void>((resolve) => stream.end(resolve))
      if (failed) {
        await fsp.rm(temp, { force: true }).catch(() => {})
        return
      }
      try {
        await fsp.rename(temp, final)
        await enforceCacheLimit(dir, limitBytes)
      } catch {
        await fsp.rm(temp, { force: true }).catch(() => {})
      }
    },
    abort() {
      failed = true
      stream.destroy()
      void fsp.rm(temp, { force: true }).catch(() => {})
    },
  }
}

async function listCacheFiles(dir: string): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const out: { path: string; size: number; mtimeMs: number }[] = []
  for (const name of names) {
    if (!name.endsWith('.bin')) continue
    const p = join(dir, name)
    try {
      const st = await fsp.stat(p)
      out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* 并发删除等,跳过 */
    }
  }
  return out
}

/** 超限时按 mtime 从最旧开始淘汰,直到总量回到限额内。 */
export async function enforceCacheLimit(dir: string, limit = AUDIO_CACHE_LIMIT_BYTES): Promise<void> {
  const files = await listCacheFiles(dir)
  let total = files.reduce((s, f) => s + f.size, 0)
  if (total <= limit) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const f of files) {
    if (total <= limit) break
    await fsp.rm(f.path, { force: true }).catch(() => {})
    total -= f.size
  }
}

export async function audioCacheStats(
  userDataDir: string
): Promise<{ bytes: number; files: number; limit: number; dir: string }> {
  const { dir, limitBytes } = await getAudioCacheConfig(userDataDir)
  const files = await listCacheFiles(dir)
  return { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length, limit: limitBytes, dir }
}

/** 清空指定目录下我们产出的缓存文件(.bin/.part),不动目录里的其他内容。 */
async function clearCacheFilesIn(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    names
      .filter((n) => n.endsWith('.bin') || n.endsWith('.part'))
      .map((n) => fsp.rm(join(dir, n), { force: true }).catch(() => {}))
  )
}

export async function clearAudioCache(userDataDir: string): Promise<void> {
  await clearCacheFilesIn((await getAudioCacheConfig(userDataDir)).dir)
}

/** 按 Range 服务本地文件(支持 bytes=start-(-end),无效 Range 回 416)。缓存命中/本地音乐播放共用。 */
export function serveFileWithRange(
  res: ServerResponse,
  filePath: string,
  size: number,
  range: string,
  contentType: string
): void {
  const base: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    // 音频已有本地文件/audio-cache,禁止 Chromium 磁盘缓存再存一份
    'Cache-Control': 'no-store',
  }
  const parsed = range ? parseByteRange(range, size) : null
  if (range && !parsed) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  let stream: ReturnType<typeof createReadStream>
  if (parsed) {
    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
      'Content-Length': String(parsed.end - parsed.start + 1),
    })
    stream = createReadStream(filePath, { start: parsed.start, end: parsed.end })
  } else {
    res.writeHead(200, { ...base, 'Content-Length': String(size) })
    stream = createReadStream(filePath)
  }
  stream.on('error', () => res.end())
  stream.pipe(res)
}

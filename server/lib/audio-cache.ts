import { createHash } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

/**
 * 音频磁盘缓存:/api/audio 代理整流下载时落盘,重复播放直接本地文件服务。
 * - key 由渲染层传入(source:id:quality),上游 URL 带过期签名不能当 key。
 * - 只缓存"从 0 字节起且上游覆盖完整文件"的整流;拖进度条的中段 Range 只透传不落盘。
 * - 写入先落 .part 临时文件,完整后 rename,不会出现半截缓存被命中。
 * - LRU 以文件 mtime 近似:命中续期,超限从最旧开始淘汰。
 */

export const AUDIO_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024 // 2GB

export function audioCacheDir(userDataDir: string): string {
  return join(userDataDir, 'audio-cache')
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
  const p = join(audioCacheDir(userDataDir), fileNameFor(key))
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
  const dir = audioCacheDir(userDataDir)
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
        await enforceCacheLimit(dir)
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

export async function audioCacheStats(userDataDir: string): Promise<{ bytes: number; files: number; limit: number }> {
  const files = await listCacheFiles(audioCacheDir(userDataDir))
  return { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length, limit: AUDIO_CACHE_LIMIT_BYTES }
}

export async function clearAudioCache(userDataDir: string): Promise<void> {
  const dir = audioCacheDir(userDataDir)
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

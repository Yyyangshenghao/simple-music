import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
  getAudioCacheStatuses,
  listSavedAudioCache,
  pinAudioCacheEntry,
  type AudioCacheOriginInput,
  type AudioCacheResolvedInput,
} from './audio-cache'
import { downloadFileBaseName, exportDownloadedSong, getSongDownloadConfig } from './song-downloads'

/**
 * 「已下载」= 下载目录里的歌曲文件 + 这里的记录；与播放器的自动缓存互不依赖。
 * 旧版本把下载与「离线音乐」都存成缓存目录里固定保留（pinned）的条目，启动时由 reconcile 迁移成下载记录；
 * 新流程里固定只出现在保存与导出之间，导出后解除，取消或失败时由渲染层解除。
 */

const INDEX_FILE = 'song-downloads-index.json'
const INDEX_SCHEMA = 1

type OnlineSource = 'netease' | 'qq'

export interface DownloadRecord {
  origin: AudioCacheOriginInput
  filePath: string
  size: number
  quality: string
  resolved?: AudioCacheResolvedInput
  savedAt: number
}

interface DownloadIndex {
  schema: 1
  items: Record<string, DownloadRecord>
}

const tails = new Map<string, Promise<void>>()
const reconciling = new Map<string, Promise<void>>()

function keyOf(origin: Pick<AudioCacheOriginInput, 'source' | 'id'>): string {
  return `${origin.source}:${String(origin.id)}`
}

async function withIndex<T>(userDataDir: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(userDataDir) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  tails.set(userDataDir, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (tails.get(userDataDir) === tail) tails.delete(userDataDir)
  }
}

function isRecord(value: unknown): value is DownloadRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DownloadRecord>
  return !!record.origin && (record.origin.source === 'netease' || record.origin.source === 'qq')
    && typeof record.origin.id === 'string' && !!record.origin.id
    && typeof record.filePath === 'string' && isAbsolute(record.filePath)
    && Number.isSafeInteger(record.size) && record.size! >= 0
    && typeof record.quality === 'string'
    && Number.isFinite(record.savedAt)
}

async function readIndex(userDataDir: string): Promise<DownloadIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(userDataDir, INDEX_FILE), 'utf8')) as Partial<DownloadIndex>
    const items: Record<string, DownloadRecord> = {}
    if (parsed?.items && typeof parsed.items === 'object') {
      for (const record of Object.values(parsed.items)) if (isRecord(record)) items[keyOf(record.origin)] = record
    }
    return { schema: INDEX_SCHEMA, items }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: INDEX_SCHEMA, items: {} }
    // 记录损坏时不覆盖，避免把用户的下载列表写空。
    throw error
  }
}

async function writeIndex(userDataDir: string, index: DownloadIndex): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true })
  const path = join(userDataDir, INDEX_FILE)
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(temp, JSON.stringify(index))
  await fs.rename(temp, path)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

/** 文件被用户在系统里删除或挪走的记录不再算已下载。 */
async function liveRecords(index: DownloadIndex): Promise<{ live: DownloadRecord[]; changed: boolean }> {
  const live: DownloadRecord[] = []
  let changed = false
  for (const [key, record] of Object.entries(index.items)) {
    if (await fileExists(record.filePath)) live.push(record)
    else {
      delete index.items[key]
      changed = true
    }
  }
  return { live, changed }
}

export async function listDownloads(userDataDir: string): Promise<DownloadRecord[]> {
  await reconciling.get(userDataDir)
  return withIndex(userDataDir, async () => {
    const index = await readIndex(userDataDir)
    const { live, changed } = await liveRecords(index)
    if (changed) await writeIndex(userDataDir, index)
    return live.sort((a, b) => b.savedAt - a.savedAt || keyOf(a.origin).localeCompare(keyOf(b.origin)))
  })
}

export async function findDownloads(
  userDataDir: string, refs: Array<{ source: OnlineSource; id: string }>
): Promise<Map<string, DownloadRecord>> {
  const found = new Map<string, DownloadRecord>()
  if (!refs.length) return found
  const index = await withIndex(userDataDir, () => readIndex(userDataDir)).catch(() => null)
  if (!index) return found
  for (const ref of refs) {
    const record = index.items[keyOf(ref)]
    if (record && await fileExists(record.filePath)) found.set(keyOf(ref), record)
  }
  return found
}

export async function findDownload(userDataDir: string, ref: { source: OnlineSource; id: string }): Promise<DownloadRecord | null> {
  return (await findDownloads(userDataDir, [ref])).get(keyOf(ref)) ?? null
}

async function registerDownload(userDataDir: string, record: DownloadRecord): Promise<void> {
  await withIndex(userDataDir, async () => {
    const index = await readIndex(userDataDir)
    index.items[keyOf(record.origin)] = record
    await writeIndex(userDataDir, index)
  })
}

/** 移除记录并把文件交给宿主处理（移到废纸篓）；文件已不在时只清记录。 */
export async function removeDownload(
  userDataDir: string,
  ref: { source: OnlineSource; id: string },
  trash: (path: string) => Promise<void>,
  expectedSavedAt?: number
): Promise<boolean> {
  return withIndex(userDataDir, async () => {
    const index = await readIndex(userDataDir)
    const record = index.items[keyOf(ref)]
    if (!record || (expectedSavedAt != null && record.savedAt !== expectedSavedAt)) return false
    // 同一文件可能被多首歌（换源别名）共用，只在最后一条记录移除时处理文件。
    const shared = Object.entries(index.items).some(([key, item]) => key !== keyOf(ref) && item.filePath === record.filePath)
    if (!shared && await fileExists(record.filePath)) await trash(record.filePath)
    delete index.items[keyOf(ref)]
    await writeIndex(userDataDir, index)
    return true
  })
}

/** 从播放器音频导出到下载目录并登记；同一首已下载且文件仍在时直接复用，不再生成「(1)」副本。 */
export async function downloadFromCache(
  userDataDir: string, entryId: string, origin: AudioCacheOriginInput, dir: string, signal?: AbortSignal
): Promise<DownloadRecord> {
  // 迁移进行中时同一首可能正被转存，等它结束再判断，避免生成「(1)」副本。
  await waitForDownloadReconcile(userDataDir)
  const existing = await findDownload(userDataDir, origin)
  if (existing) {
    await pinAudioCacheEntry(userDataDir, entryId, origin, false).catch(() => {})
    return existing
  }
  const [status] = await getAudioCacheStatuses(userDataDir, [{ source: origin.source, id: origin.id }])
  const result = await exportDownloadedSong(userDataDir, entryId, origin, dir, signal)
  const record: DownloadRecord = {
    origin, filePath: result.filePath, size: result.size,
    quality: status?.entryId === entryId ? status.quality ?? '' : '',
    resolved: status?.entryId === entryId ? status.resolved : undefined,
    savedAt: Date.now(),
  }
  await registerDownload(userDataDir, record)
  // 下载完成后播放器里那份回归普通缓存，按缓存上限自然清理，不再重复占用空间。
  await pinAudioCacheEntry(userDataDir, entryId, origin, false).catch(() => {})
  return record
}

/** 旧版导出过的同名文件（含「(n)」序号）且大小一致时直接认领，不重复复制。 */
async function findExportedFile(dir: string, origin: AudioCacheOriginInput, size: number): Promise<string | null> {
  const base = downloadFileBaseName(origin)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  for (const name of names) {
    const stem = basename(name, extname(name))
    if (stem !== base && !(stem.startsWith(`${base} (`) && /^ \(\d+\)$/.test(stem.slice(base.length)))) continue
    const path = join(dir, name)
    try {
      const stat = await fs.stat(path)
      if (stat.isFile() && stat.size === size) return path
    } catch { /* 并发删除，忽略 */ }
  }
  return null
}

async function reconcileOnce(userDataDir: string, defaultDir?: string): Promise<void> {
  // 下载记录损坏时直接放弃本次核对，不在坏记录上叠加写入。
  await withIndex(userDataDir, () => readIndex(userDataDir))
  const saved = await listSavedAudioCache(userDataDir)
  if (!saved.length) return
  const { dir } = await getSongDownloadConfig(userDataDir, defaultDir)
  for (const item of saved) {
    try {
      // 没有下载记录的固定条目一律当作要保留的歌转存：旧版离线音乐、降级后新存的离线音乐、中断的下载都不丢。
      if (!await findDownload(userDataDir, item.origin)) {
        const [status] = await getAudioCacheStatuses(userDataDir, [{ source: item.origin.source, id: item.origin.id }])
        const resolved = status?.entryId === item.entryId ? status.resolved : undefined
        const adopted = await findExportedFile(dir, item.origin, item.size)
        if (adopted) {
          await registerDownload(userDataDir, {
            origin: item.origin, filePath: adopted, size: item.size, quality: item.quality, resolved, savedAt: item.savedAt,
          })
        } else {
          const result = await exportDownloadedSong(userDataDir, item.entryId, item.origin, dir)
          await registerDownload(userDataDir, {
            origin: item.origin, filePath: result.filePath, size: result.size, quality: item.quality, resolved, savedAt: item.savedAt,
          })
        }
      }
      await pinAudioCacheEntry(userDataDir, item.entryId, item.origin, false)
    } catch {
      // 单首失败保持固定保留（仍可作为缓存播放），下次启动再试。
    }
  }
}

/** 启动时核对一次：旧「离线音乐」等固定条目转为下载。下载列表、导出、解除固定与改缓存目录都会等它完成。 */
export function reconcileDownloads(userDataDir: string, defaultDir?: string): Promise<void> {
  const running = reconciling.get(userDataDir)
  if (running) return running
  const task = reconcileOnce(userDataDir, defaultDir).catch(() => {}).finally(() => {
    if (reconciling.get(userDataDir) === task) reconciling.delete(userDataDir)
  })
  reconciling.set(userDataDir, task)
  return task
}

export function waitForDownloadReconcile(userDataDir: string): Promise<void> {
  return reconciling.get(userDataDir) ?? Promise.resolve()
}

export function downloadContentType(filePath: string): string {
  const types: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  }
  return types[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

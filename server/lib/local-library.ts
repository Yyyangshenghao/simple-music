import { createHash, randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { join, extname, isAbsolute, basename, sep } from 'node:path'
import { parseFile, type ILyricsTag } from 'music-metadata'

/**
 * 本地音乐库:扫描用户选择的文件夹,解析内嵌标签,索引持久化在 userDataDir/local-library.json。
 * 音频/封面/歌词均按索引里的 id 查路径再读盘服务,不接受调用方直传任意路径(防越权读文件)。
 */

const INDEX_FILE = 'local-library.json'
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.wma'])

export interface LocalTrackRecord {
  id: string
  path: string
  name: string
  artist: string
  album?: string
  duration?: number // 毫秒,对齐全项目约定
  hasCover: boolean
  coverFormat?: string // 如 image/jpeg,serveLocalCover 用于 Content-Type
  mtimeMs: number
}

interface LocalLibraryIndex {
  folders: string[]
  tracks: LocalTrackRecord[]
}

interface LibrarySnapshot {
  index: LocalLibraryIndex
  byId: Map<string, LocalTrackRecord>
  fingerprint: string
}

const MAX_CACHED_LIBRARIES = 4
const indexCache = new Map<string, LibrarySnapshot>()
const pendingReads = new Map<string, Promise<LibrarySnapshot>>()
const mutationTails = new Map<string, Promise<void>>()

function snapshot(index: LocalLibraryIndex, fingerprint = ''): LibrarySnapshot {
  return { index, fingerprint, byId: new Map(index.tracks.map((track) => [track.id, track])) }
}

function cacheSnapshot(userDataDir: string, value: LibrarySnapshot): void {
  indexCache.delete(userDataDir)
  indexCache.set(userDataDir, value)
  if (indexCache.size > MAX_CACHED_LIBRARIES) indexCache.delete(indexCache.keys().next().value!)
}

function idFor(path: string): string {
  return createHash('sha1').update(path).digest('hex')
}

function coverPathFor(userDataDir: string, id: string): string {
  return join(userDataDir, 'local-covers', `${id}.img`)
}

async function readSnapshot(userDataDir: string): Promise<LibrarySnapshot> {
  const pending = pendingReads.get(userDataDir)
  if (pending) return pending
  const loading: Promise<LibrarySnapshot> = Promise.resolve().then(async () => {
    try {
      const file = join(userDataDir, INDEX_FILE)
      const stat = await fsp.stat(file)
      const fingerprint = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
      const cached = indexCache.get(userDataDir)
      if (cached?.fingerprint === fingerprint) {
        cacheSnapshot(userDataDir, cached)
        return cached
      }
      const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<LocalLibraryIndex>
      const value = snapshot({ folders: raw.folders ?? [], tracks: raw.tracks ?? [] }, fingerprint)
      // 写入会使在途读取失效，避免旧读取在提交后重新填入缓存。
      if (pendingReads.get(userDataDir) === loading) cacheSnapshot(userDataDir, value)
      return value
    } catch {
      if (pendingReads.get(userDataDir) === loading) indexCache.delete(userDataDir)
      return snapshot({ folders: [], tracks: [] })
    }
  })
  pendingReads.set(userDataDir, loading)
  try {
    return await loading
  } finally {
    if (pendingReads.get(userDataDir) === loading) pendingReads.delete(userDataDir)
  }
}

async function readIndex(userDataDir: string): Promise<LocalLibraryIndex> {
  return (await readSnapshot(userDataDir)).index
}

async function writeIndex(userDataDir: string, index: LocalLibraryIndex): Promise<void> {
  await fsp.mkdir(userDataDir, { recursive: true })
  const file = join(userDataDir, INDEX_FILE)
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fsp.writeFile(temporary, JSON.stringify(index, null, 2))
    await fsp.rename(temporary, file)
    pendingReads.delete(userDataDir)
    indexCache.delete(userDataDir)
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {})
  }
}

async function withMutation<T>(userDataDir: string, task: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(userDataDir) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  mutationTails.set(userDataDir, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (mutationTails.get(userDataDir) === tail) mutationTails.delete(userDataDir)
  }
}

/** 递归列出文件夹下的音频文件绝对路径(跳过隐藏目录)。 */
async function walkAudioFiles(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkAudioFiles(full)))
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

async function parseTrack(userDataDir: string, path: string, mtimeMs: number): Promise<LocalTrackRecord> {
  const id = idFor(path)
  const fallbackName = basename(path, extname(path))
  try {
    const meta = await parseFile(path)
    const picture = meta.common.picture?.[0]
    if (picture) {
      await fsp.mkdir(join(userDataDir, 'local-covers'), { recursive: true })
      await fsp.writeFile(coverPathFor(userDataDir, id), picture.data)
    }
    return {
      id,
      path,
      name: meta.common.title || fallbackName,
      artist: meta.common.artists?.join('/') || meta.common.artist || '未知艺人',
      album: meta.common.album,
      duration: meta.format.duration ? Math.round(meta.format.duration * 1000) : undefined,
      hasCover: !!picture,
      coverFormat: picture?.format,
      mtimeMs,
    }
  } catch {
    // 标签解析失败(损坏文件等):退化为文件名,仍可播放
    return { id, path, name: fallbackName, artist: '未知艺人', hasCover: false, mtimeMs }
  }
}

/** 扫描指定文件夹并合并进索引;已存在且 mtime 未变的文件跳过重新解析。返回扫描后该文件夹下的曲目。 */
export async function addLocalFolder(userDataDir: string, folder: string): Promise<LocalTrackRecord[]> {
  if (!isAbsolute(folder)) throw new Error('INVALID_FOLDER')
  return withMutation(userDataDir, () => scanLocalFolder(userDataDir, folder))
}

async function scanLocalFolder(userDataDir: string, folder: string): Promise<LocalTrackRecord[]> {
  const index = await readIndex(userDataDir)
  const byPath = new Map(index.tracks.map((t) => [t.path, t]))
  const files = await walkAudioFiles(folder)
  const folderTracks: LocalTrackRecord[] = []
  const folderPrefix = folder.endsWith(sep) ? folder : folder + sep
  const scannedPaths = new Set(files)
  const removedIds: string[] = []
  for (const [path, record] of byPath) {
    if (!path.startsWith(folderPrefix) || scannedPaths.has(path)) continue
    try {
      await fsp.stat(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') continue
      byPath.delete(path)
      removedIds.push(record.id)
    }
  }

  for (const file of files) {
    const st = await fsp.stat(file).catch(() => null)
    if (!st) continue
    const existing = byPath.get(file)
    if (existing && existing.mtimeMs === st.mtimeMs) {
      folderTracks.push(existing)
      continue
    }
    const record = await parseTrack(userDataDir, file, st.mtimeMs)
    byPath.set(file, record)
    folderTracks.push(record)
  }

  const folders = index.folders.includes(folder) ? index.folders : [...index.folders, folder]
  await writeIndex(userDataDir, { folders, tracks: [...byPath.values()] })
  await Promise.all(removedIds.map((id) => fsp.rm(coverPathFor(userDataDir, id), { force: true }).catch(() => {})))
  return folderTracks
}

export async function removeLocalFolder(userDataDir: string, folder: string): Promise<void> {
  await withMutation(userDataDir, async () => {
    const index = await readIndex(userDataDir)
    const folderPrefix = folder.endsWith(sep) ? folder : folder + sep
    const folders = index.folders.filter((f) => f !== folder)
    const remainingPrefixes = folders.map((f) => f.endsWith(sep) ? f : f + sep)
    const removedIds = new Set(index.tracks
      .filter((t) => (t.path === folder || t.path.startsWith(folderPrefix))
        && !remainingPrefixes.some((prefix) => t.path.startsWith(prefix)))
      .map((t) => t.id))
    const kept = index.tracks.filter((t) => !removedIds.has(t.id))
    await writeIndex(userDataDir, { folders, tracks: kept })
    await Promise.all(
      [...removedIds].map((id) => fsp.rm(coverPathFor(userDataDir, id), { force: true }).catch(() => {}))
    )
  })
}

export async function listLocalLibrary(userDataDir: string): Promise<LocalLibraryIndex> {
  const index = await readIndex(userDataDir)
  return { folders: [...index.folders], tracks: index.tracks.map((track) => ({ ...track })) }
}

export async function findLocalTrack(userDataDir: string, id: string): Promise<LocalTrackRecord | null> {
  const record = (await readSnapshot(userDataDir)).byId.get(id)
  return record ? { ...record } : null
}

/** 只接受索引 ID，检查文件仍存在；不修改索引或应用收藏。调用端每批最多 100 个。 */
export async function availableLocalTrackIds(userDataDir: string, ids: string[]): Promise<string[]> {
  const records = (await readSnapshot(userDataDir)).byId
  const available = await Promise.all([...new Set(ids)].map(async id => {
    const record = records.get(id)
    if (!record) return null
    try { return (await fsp.stat(record.path)).isFile() ? id : null }
    catch { return null }
  }))
  return available.filter((id): id is string => id !== null)
}

export function localCoverPath(userDataDir: string, id: string): string {
  return coverPathFor(userDataDir, id)
}

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
}

export function localAudioContentType(path: string): string {
  return AUDIO_CONTENT_TYPES[extname(path).toLowerCase()] || 'audio/mpeg'
}

/** 读取曲目同目录同名 .lrc 文件的原始文本;不存在返回空串。 */
export async function readLocalLyric(path: string): Promise<string> {
  const lrcPath = path.slice(0, path.length - extname(path).length) + '.lrc'
  try {
    return await fsp.readFile(lrcPath, 'utf8')
  } catch {
    return ''
  }
}

/** 在线歌词匹配可用的曲目标签；只含曲目元数据，不含路径或文件内容。 */
export interface LocalLyricMetadata {
  name: string
  artist: string
  artists: string[]
  album?: string
  duration: number
  isrc?: string
}

export interface LocalLyricSource {
  lyric: string
  /** 歌词来自同名 .lrc 还是音频内嵌的同步歌词 */
  lyricOrigin: 'file' | 'embedded' | null
  /** 标签齐全（标题、艺人、时长都来自文件标签）才返回，否则为 null，不按文件名在线套词 */
  metadata: LocalLyricMetadata | null
}

const MAX_PARSED_TAGS = 64
const parsedTags = new Map<string, Awaited<ReturnType<typeof parseFile>> | null>()

const pad = (value: number, size = 2) => String(Math.floor(value)).padStart(size, '0')
/** ID3 SYLT 时间戳格式：2 表示毫秒（1 为 MPEG 帧号，无法换算成时间）。 */
const SYLT_MILLISECONDS = 2

/** 内嵌同步歌词（ID3 SYLT 等，毫秒时间戳）转成 LRC；未同步的纯文本只在本身带 LRC 时间标记时采用。 */
function embeddedLrc(lyrics: readonly ILyricsTag[] | undefined): string {
  for (const tag of lyrics ?? []) {
    const synced = (tag.syncText ?? []).filter(line => Number.isFinite(line.timestamp) && line.text?.trim())
    if (synced.length && tag.timeStampFormat === SYLT_MILLISECONDS) {
      return synced.map(line => {
        const ms = Math.max(0, line.timestamp!)
        return `[${pad(ms / 60000)}:${pad((ms / 1000) % 60)}.${pad((ms % 1000) / 10)}]${line.text.trim()}`
      }).join('\n')
    }
    if (typeof tag.text === 'string' && /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(tag.text)) return tag.text
  }
  return ''
}

/**
 * 本地曲目的歌词与匹配标签：优先同名 .lrc，其次内嵌同步歌词；同时按需重读一次标签，
 * 给出可靠元数据（标题不是文件名回退、艺人与时长齐全）供在线匹配。
 */
export async function readLocalLyricSource(record: LocalTrackRecord): Promise<LocalLyricSource> {
  const file = await readLocalLyric(record.path)
  // 同一文件（路径与修改时间不变）的标签只解析一次；同名 .lrc 每次重读，外部改动立即生效。
  const cacheKey = `${record.path}\u0000${record.mtimeMs}`
  let meta = parsedTags.get(cacheKey)
  if (meta === undefined) {
    try {
      meta = await parseFile(record.path, { skipCovers: true, duration: false })
    } catch { meta = null /* 标签解析失败：只能使用同名 .lrc，不做在线匹配。 */ }
    parsedTags.set(cacheKey, meta)
    if (parsedTags.size > MAX_PARSED_TAGS) parsedTags.delete(parsedTags.keys().next().value!)
  }
  const embedded = file.trim() ? '' : embeddedLrc(meta?.common.lyrics)
  const title = meta?.common.title?.trim()
  const artists = (meta?.common.artists?.length ? meta.common.artists : meta?.common.artist ? [meta.common.artist] : [])
    .map(name => name.trim()).filter(Boolean)
  const duration = meta?.format.duration ? Math.round(meta.format.duration * 1000) : record.duration
  const isrc = meta?.common.isrc?.find(value => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value.trim()))?.trim().toUpperCase()
  return {
    lyric: file.trim() ? file : embedded,
    lyricOrigin: file.trim() ? 'file' : embedded ? 'embedded' : null,
    metadata: title && artists.length && duration && duration > 0
      ? { name: title, artist: artists.join('/'), artists, album: meta?.common.album?.trim() || undefined, duration, ...(isrc ? { isrc } : {}) }
      : null,
  }
}

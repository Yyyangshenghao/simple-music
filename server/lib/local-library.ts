import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { join, extname, isAbsolute, basename } from 'node:path'
import { parseFile } from 'music-metadata'

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

function idFor(path: string): string {
  return createHash('sha1').update(path).digest('hex')
}

function coverPathFor(userDataDir: string, id: string): string {
  return join(userDataDir, 'local-covers', `${id}.img`)
}

async function readIndex(userDataDir: string): Promise<LocalLibraryIndex> {
  try {
    const raw = JSON.parse(await fsp.readFile(join(userDataDir, INDEX_FILE), 'utf8')) as Partial<LocalLibraryIndex>
    return { folders: raw.folders ?? [], tracks: raw.tracks ?? [] }
  } catch {
    return { folders: [], tracks: [] }
  }
}

async function writeIndex(userDataDir: string, index: LocalLibraryIndex): Promise<void> {
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.writeFile(join(userDataDir, INDEX_FILE), JSON.stringify(index, null, 2))
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
  const index = await readIndex(userDataDir)
  const byPath = new Map(index.tracks.map((t) => [t.path, t]))
  const files = await walkAudioFiles(folder)
  const folderTracks: LocalTrackRecord[] = []

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
  return folderTracks
}

export async function removeLocalFolder(userDataDir: string, folder: string): Promise<void> {
  const index = await readIndex(userDataDir)
  const removed = index.tracks.filter((t) => t.path === folder || t.path.startsWith(folder + '/'))
  const kept = index.tracks.filter((t) => !removed.includes(t))
  await writeIndex(userDataDir, { folders: index.folders.filter((f) => f !== folder), tracks: kept })
  await Promise.all(
    removed.map((t) => fsp.rm(coverPathFor(userDataDir, t.id), { force: true }).catch(() => {}))
  )
}

export async function listLocalLibrary(userDataDir: string): Promise<LocalLibraryIndex> {
  return readIndex(userDataDir)
}

export async function findLocalTrack(userDataDir: string, id: string): Promise<LocalTrackRecord | null> {
  const index = await readIndex(userDataDir)
  return index.tracks.find((t) => t.id === id) ?? null
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

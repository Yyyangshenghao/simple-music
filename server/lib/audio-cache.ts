import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { ServerResponse } from 'node:http'

/** 音频磁盘缓存与离线索引；音频文件名保持 sha1(cacheKey).bin 以兼容旧版本。 */

export const AUDIO_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
export const AUDIO_CACHE_MIN_LIMIT = 256 * 1024 * 1024
export const AUDIO_CACHE_MAX_LIMIT = 100 * 1024 * 1024 * 1024

const CONFIG_FILE = 'audio-cache-config.json'
const INDEX_FILE = '.audio-cache-index-v1.json'
const INDEX_BACKUP_FILE = '.audio-cache-index-v1.bak.json'
const INDEX_MARKER_FILE = 'audio-cache-index-v1.marker'
const INDEX_SCHEMA = 1
const MAX_TEMP_ORIGINS = 8

type OnlineSource = 'netease' | 'qq'

export interface AudioCacheConfig {
  dir: string
  limitBytes: number
}

export interface AudioCacheOriginInput {
  source: OnlineSource
  id: string
  name?: string
  artist?: string
  album?: string
  cover?: string
  duration?: number
}

export interface AudioCacheResolvedInput extends AudioCacheOriginInput {}

export interface AudioCacheContext {
  origin: AudioCacheOriginInput
  resolved: AudioCacheResolvedInput
  quality: string
  contentType?: string
  /** 主动保存成功时写入别名级离线承诺。 */
  pinned?: boolean
  /** 主动保存用于核对实际写入长度。 */
  expectedBytes?: number
}

interface CacheFileEntry {
  entryId: string
  fileName: string
  size: number
  createdAt: number
  updatedAt: number
}

interface CacheOrigin extends AudioCacheOriginInput {
  lastUsedAt: number
  savedAt?: number
}

export interface ManagedAudioCacheEntry extends CacheFileEntry {
  legacy?: false
  cacheKey: string
  contentType: string
  origins: CacheOrigin[]
  resolved: AudioCacheResolvedInput
  quality: string
}

interface LegacyAudioCacheEntry extends CacheFileEntry {
  legacy: true
}

type AudioCacheEntry = ManagedAudioCacheEntry | LegacyAudioCacheEntry

interface AudioCacheIndexV1 {
  schema: 1
  entries: Record<string, AudioCacheEntry>
}

export interface OfflineCacheStatus {
  source: OnlineSource
  id: string
  state: 'missing' | 'cached' | 'pinned'
  entryId?: string
  resolved?: AudioCacheResolvedInput
  quality?: string
  size?: number
  savedAliasCount?: number
}

export interface AudioCacheStats {
  bytes: number
  files: number
  temporaryBytes: number
  temporaryFiles: number
  pinnedBytes: number
  pinnedFiles: number
  unmanagedBytes: number
  unmanagedFiles: number
  limit: number
  dir: string
}

export type CacheMutationResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'CACHE_BUSY' | 'CACHE_SHARED'; savedAliasCount?: number }

const configMemo = new Map<string, AudioCacheConfig>()
const mutationTails = new Map<string, Promise<void>>()
const entryLockTails = new Map<string, Promise<void>>()
const activeWriters = new Set<string>()
const activeReaders = new Map<string, number>()
const maintenanceDirs = new Set<string>()
const blockedEntries = new Set<string>()

function emptyIndex(): AudioCacheIndexV1 {
  return { schema: INDEX_SCHEMA, entries: {} }
}

function isOnlineSource(value: unknown): value is OnlineSource {
  return value === 'netease' || value === 'qq'
}

function cleanText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function normalizeOrigin(value: AudioCacheOriginInput): AudioCacheOriginInput | null {
  const id = String(value?.id ?? '').trim()
  if (!isOnlineSource(value?.source) || !id) return null
  const duration = Number(value.duration)
  return {
    source: value.source,
    id,
    name: cleanText(value.name),
    artist: cleanText(value.artist),
    album: cleanText(value.album),
    cover: cleanText(value.cover),
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  }
}

function originKey(origin: Pick<AudioCacheOriginInput, 'source' | 'id'>): string {
  return `${origin.source}:${String(origin.id)}`
}

export function audioCacheEntryId(cacheKey: string): string {
  return createHash('sha1').update(cacheKey).digest('hex')
}

function fileNameFor(cacheKey: string): string {
  return `${audioCacheEntryId(cacheKey)}.bin`
}

function entryActivityKey(dir: string, entryId: string): string {
  return `${dir}\u0000${entryId}`
}

function hasSavedOrigin(entry: AudioCacheEntry): boolean {
  return !entry.legacy && entry.origins.some((origin) => origin.savedAt != null)
}

function savedAliasCount(entry: AudioCacheEntry): number {
  return entry.legacy ? 0 : entry.origins.filter((origin) => origin.savedAt != null).length
}

function isCacheFileEntry(value: unknown): value is CacheFileEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CacheFileEntry>
  return typeof entry.entryId === 'string' && /^[a-f0-9]{40}$/i.test(entry.entryId)
    && entry.fileName === `${entry.entryId}.bin`
    && Number.isSafeInteger(entry.size) && entry.size! >= 0
    && Number.isFinite(entry.createdAt) && entry.createdAt! >= 0
    && Number.isFinite(entry.updatedAt) && entry.updatedAt! >= 0
}

function isCacheOrigin(value: unknown): value is CacheOrigin {
  if (!value || typeof value !== 'object') return false
  const origin = value as Partial<CacheOrigin>
  return isOnlineSource(origin.source) && typeof origin.id === 'string' && !!origin.id.trim()
    && Number.isFinite(origin.lastUsedAt) && origin.lastUsedAt! >= 0
    && (origin.savedAt == null || (Number.isFinite(origin.savedAt) && origin.savedAt >= 0))
}

function isManagedEntry(value: unknown): value is ManagedAudioCacheEntry {
  if (!isCacheFileEntry(value)) return false
  const entry = value as Partial<ManagedAudioCacheEntry>
  return (value as { legacy?: unknown }).legacy !== true
    && typeof entry.cacheKey === 'string' && audioCacheEntryId(entry.cacheKey) === entry.entryId
    && typeof entry.contentType === 'string' && !!entry.contentType && !/[\r\n]/.test(entry.contentType)
    && Array.isArray(entry.origins)
    && entry.origins.every(isCacheOrigin)
    && !!entry.resolved
    && isOnlineSource(entry.resolved.source)
    && typeof entry.resolved.id === 'string' && !!entry.resolved.id.trim()
    && typeof entry.quality === 'string' && !!entry.quality.trim()
    && entry.cacheKey === `${entry.resolved.source}:${entry.resolved.id}:${entry.quality}`
}

function isLegacyEntry(value: unknown): value is LegacyAudioCacheEntry {
  if (!isCacheFileEntry(value)) return false
  const entry = value as Partial<LegacyAudioCacheEntry>
  return entry.legacy === true
}

function parseIndex(raw: string): AudioCacheIndexV1 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AudioCacheIndexV1>
    if (parsed.schema !== INDEX_SCHEMA || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) return null
    const entries: Record<string, AudioCacheEntry> = {}
    for (const [id, entry] of Object.entries(parsed.entries)) {
      if (!(isManagedEntry(entry) || isLegacyEntry(entry)) || entry.entryId !== id) return null
      entries[id] = entry
    }
    return { schema: INDEX_SCHEMA, entries }
  } catch {
    return null
  }
}

async function readIndexFile(path: string): Promise<AudioCacheIndexV1 | null> {
  try {
    return parseIndex(await fsp.readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await fsp.writeFile(temp, JSON.stringify(value, null, 2))
  await fsp.rename(temp, path)
}

async function writeIndex(dir: string, index: AudioCacheIndexV1): Promise<void> {
  await fsp.mkdir(dir, { recursive: true })
  const current = await readIndexFile(join(dir, INDEX_FILE))
  if (current) await writeJsonAtomic(join(dir, INDEX_BACKUP_FILE), current)
  await writeJsonAtomic(join(dir, INDEX_FILE), index)
}

async function scanLegacyEntries(dir: string): Promise<Record<string, LegacyAudioCacheEntry>> {
  const entries: Record<string, LegacyAudioCacheEntry> = {}
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return entries
  }
  const now = Date.now()
  for (const fileName of names) {
    const match = /^([a-f0-9]{40})\.bin$/i.exec(fileName)
    if (!match) continue
    try {
      const stat = await fsp.stat(join(dir, fileName))
      entries[match[1]] = {
        legacy: true,
        entryId: match[1],
        fileName,
        size: stat.size,
        createdAt: stat.birthtimeMs || now,
        updatedAt: stat.mtimeMs || now,
      }
    } catch {
      /* 并发删除，忽略 */
    }
  }
  return entries
}

async function loadIndex(userDataDir: string, dir: string): Promise<AudioCacheIndexV1> {
  const primary = await readIndexFile(join(dir, INDEX_FILE))
  if (primary) return primary
  const backup = await readIndexFile(join(dir, INDEX_BACKUP_FILE))
  if (backup) {
    await writeJsonAtomic(join(dir, INDEX_FILE), backup).catch(() => {})
    return backup
  }

  const marker = join(userDataDir, INDEX_MARKER_FILE)
  let migrated = false
  try {
    await fsp.access(marker)
    migrated = true
  } catch {
    /* 首次迁移 */
  }
  if (migrated) return emptyIndex()

  const index: AudioCacheIndexV1 = { schema: INDEX_SCHEMA, entries: await scanLegacyEntries(dir) }
  await writeIndex(dir, index)
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.writeFile(marker, '1')
  return index
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

async function acquireEntryLock(key: string): Promise<() => void> {
  const previous = entryLockTails.get(key) ?? Promise.resolve()
  let unlock!: () => void
  const current = new Promise<void>((resolve) => { unlock = resolve })
  const tail = previous.then(() => current)
  entryLockTails.set(key, tail)
  await previous
  let released = false
  return () => {
    if (released) return
    released = true
    unlock()
    if (entryLockTails.get(key) === tail) entryLockTails.delete(key)
  }
}

/** 默认缓存目录。 */
export function audioCacheDir(userDataDir: string): string {
  return join(userDataDir, 'audio-cache')
}

function clampLimit(value: number): number {
  return Math.min(AUDIO_CACHE_MAX_LIMIT, Math.max(AUDIO_CACHE_MIN_LIMIT, Math.floor(value)))
}

export async function getAudioCacheConfig(userDataDir: string): Promise<AudioCacheConfig> {
  const memo = configMemo.get(userDataDir)
  if (memo) return memo
  const config: AudioCacheConfig = { dir: audioCacheDir(userDataDir), limitBytes: AUDIO_CACHE_LIMIT_BYTES }
  try {
    const raw = JSON.parse(await fsp.readFile(join(userDataDir, CONFIG_FILE), 'utf8')) as Partial<AudioCacheConfig>
    if (typeof raw.dir === 'string' && isAbsolute(raw.dir)) config.dir = raw.dir
    if (typeof raw.limitBytes === 'number' && Number.isFinite(raw.limitBytes)) config.limitBytes = clampLimit(raw.limitBytes)
  } catch {
    /* 无配置或配置损坏时使用默认值 */
  }
  configMemo.set(userDataDir, config)
  return config
}

async function probeWritable(dir: string): Promise<boolean> {
  try {
    await fsp.mkdir(dir, { recursive: true })
    const probe = join(dir, `.sm-write-probe-${randomBytes(4).toString('hex')}`)
    await fsp.writeFile(probe, '')
    await fsp.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function hasActiveEntriesInDir(dir: string): boolean {
  const prefix = `${dir}\u0000`
  if ([...activeWriters].some((key) => key.startsWith(prefix))) return true
  return [...activeReaders].some(([key, count]) => count > 0 && key.startsWith(prefix))
}

function isAudioCachePartFile(name: string): boolean {
  return /^[a-f0-9]{40}(?:\.bin|\.[a-f0-9]{12})\.part$/i.test(name)
}

async function clearCacheFilesIn(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return
  }
  await Promise.all(names
    .filter((name) => /^[a-f0-9]{40}\.bin$/i.test(name) || isAudioCachePartFile(name)
      || [INDEX_FILE, INDEX_BACKUP_FILE].some((file) => name === file
        || (name.startsWith(`${file}.`) && /^[a-f0-9]{12}\.tmp$/i.test(name.slice(file.length + 1)))))
    .map((name) => fsp.rm(join(dir, name), { force: true }).catch(() => {})))
}

export async function updateAudioCacheConfig(
  userDataDir: string,
  patch: { dir?: string; limitBytes?: number; confirmPinned?: boolean }
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

  if (next.dir !== current.dir) {
    let preflight: string | null
    try {
      preflight = await withMutation(userDataDir, async () => {
        maintenanceDirs.add(current.dir)
        if (hasActiveEntriesInDir(current.dir)) return 'CACHE_BUSY'
        const index = await loadIndex(userDataDir, current.dir)
        if (!patch.confirmPinned && Object.values(index.entries).some(hasSavedOrigin)) return 'PINNED_CONTENT'
        return null
      })
    } catch (error) {
      maintenanceDirs.delete(current.dir)
      throw error
    }
    if (preflight) {
      maintenanceDirs.delete(current.dir)
      return { ok: false, error: preflight }
    }
  }

  try {
    await fsp.mkdir(userDataDir, { recursive: true })
    await writeJsonAtomic(join(userDataDir, CONFIG_FILE), next)
  } catch {
    maintenanceDirs.delete(current.dir)
    return { ok: false, error: 'CONFIG_SAVE_FAILED' }
  }

  configMemo.set(userDataDir, next)
  if (next.dir !== current.dir) {
    await clearCacheFilesIn(current.dir)
    maintenanceDirs.delete(current.dir)
  }
  if (next.limitBytes < current.limitBytes) await enforceAudioCacheLimit(userDataDir)
  return { ok: true, config: next }
}

export function isFullStreamRequest(range: string): boolean {
  const value = range.trim()
  return value === '' || /^bytes=0-$/i.test(value)
}

export function coversWholeFile(status: number, contentRange: string | null): boolean {
  if (status === 200) return true
  if (status !== 206 || !contentRange) return false
  const match = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(contentRange.trim())
  return !!match && Number(match[1]) + 1 === Number(match[2])
}

export function parseByteRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start >= size || start > end) return null
  return { start, end }
}

function mergeOrigin(
  origins: CacheOrigin[],
  input: AudioCacheOriginInput,
  pinned: boolean,
  now: number
): CacheOrigin[] {
  const key = originKey(input)
  const previous = origins.find((origin) => originKey(origin) === key)
  const merged: CacheOrigin = {
    ...previous,
    ...input,
    name: input.name ?? previous?.name,
    artist: input.artist ?? previous?.artist,
    album: input.album ?? previous?.album,
    cover: input.cover ?? previous?.cover,
    duration: input.duration ?? previous?.duration,
    lastUsedAt: now,
    savedAt: pinned ? now : previous?.savedAt,
  }
  const next = origins.filter((origin) => originKey(origin) !== key)
  next.push(merged)
  const saved = next.filter((origin) => origin.savedAt != null)
  const temporary = next
    .filter((origin) => origin.savedAt == null)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_TEMP_ORIGINS)
  return [...saved, ...temporary]
}

async function upsertManagedEntry(
  userDataDir: string,
  dir: string,
  cacheKey: string,
  size: number,
  context: AudioCacheContext
): Promise<void> {
  const origin = normalizeOrigin(context.origin)
  const resolved = normalizeOrigin(context.resolved)
  const quality = cleanText(context.quality)
  if (!origin || !resolved || !quality) return
  await withMutation(userDataDir, async () => {
    const entryId = audioCacheEntryId(cacheKey)
    const activityKey = entryActivityKey(dir, entryId)
    if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) return
    try {
      if ((await fsp.stat(join(dir, fileNameFor(cacheKey)))).size !== size) return
    } catch {
      return
    }
    const index = await loadIndex(userDataDir, dir)
    const previous = index.entries[entryId]
    const now = Date.now()
    const origins = previous && !previous.legacy ? previous.origins : []
    if (context.pinned) {
      const key = originKey(origin)
      for (const entry of Object.values(index.entries)) {
        if (entry.legacy || entry.entryId === entryId) continue
        entry.origins = entry.origins.map((item) => (
          originKey(item) === key ? { ...item, savedAt: undefined } : item
        ))
      }
    }
    index.entries[entryId] = {
      entryId,
      fileName: fileNameFor(cacheKey),
      cacheKey,
      contentType: cleanText(context.contentType)
        ?? (previous && !previous.legacy ? previous.contentType : 'application/octet-stream'),
      size,
      origins: mergeOrigin(origins, origin, !!context.pinned, now),
      resolved,
      quality,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    await writeIndex(dir, index)
  })
}

export async function findCachedAudio(
  userDataDir: string,
  cacheKey: string,
  context?: AudioCacheContext,
  acquireReadLease = false
): Promise<{ path: string; size: number; entryId: string; release?: () => void } | null> {
  const dir = (await getAudioCacheConfig(userDataDir)).dir
  const entryId = audioCacheEntryId(cacheKey)
  const activityKey = entryActivityKey(dir, entryId)
  if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) return null
  const path = join(dir, fileNameFor(cacheKey))
  try {
    const indexedSize = await withMutation(userDataDir, async () => {
      if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) return null
      return (await loadIndex(userDataDir, dir)).entries[entryId]?.size ?? null
    })
    // 索引灾难恢复后的未识别文件保持隔离；只服务首次迁移或正常提交过的条目。
    if (indexedSize == null) return null
    const stat = await fsp.stat(path)
    if (stat.size !== indexedSize) return null
    const now = new Date()
    await fsp.utimes(path, now, now).catch(() => {})
    if (context) await upsertManagedEntry(userDataDir, dir, cacheKey, stat.size, context)
    if (!acquireReadLease) return { path, size: stat.size, entryId }
    return withMutation(userDataDir, async () => {
      if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) return null
      const indexed = (await loadIndex(userDataDir, dir)).entries[entryId]
      const latest = await fsp.stat(path).catch(() => null)
      if (!indexed || !latest || latest.size !== indexed.size) return null
      activeReaders.set(activityKey, (activeReaders.get(activityKey) ?? 0) + 1)
      let released = false
      return {
        path,
        size: latest.size,
        entryId,
        release() {
          if (released) return
          released = true
          const remaining = (activeReaders.get(activityKey) ?? 1) - 1
          if (remaining > 0) activeReaders.set(activityKey, remaining)
          else activeReaders.delete(activityKey)
        },
      }
    })
  } catch {
    return null
  }
}

export interface AudioCacheWriter {
  write(chunk: Uint8Array): Promise<void>
  /** 返回 false 表示长度不符或写入失败，没有正式缓存。 */
  commit(): Promise<boolean>
  abort(): void
}

export async function openAudioCacheWriter(
  userDataDir: string,
  cacheKey: string,
  context?: AudioCacheContext
): Promise<AudioCacheWriter | null> {
  const { dir } = await getAudioCacheConfig(userDataDir)
  const entryId = audioCacheEntryId(cacheKey)
  const activityKey = entryActivityKey(dir, entryId)
  if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) return null
  const releaseLock = await acquireEntryLock(activityKey)
  if (maintenanceDirs.has(dir) || blockedEntries.has(activityKey)) {
    releaseLock()
    return null
  }
  activeWriters.add(activityKey)
  const finalPath = join(dir, fileNameFor(cacheKey))
  const tempPath = join(dir, `${entryId}.${randomBytes(6).toString('hex')}.part`)
  let stream: WriteStream
  try {
    await fsp.mkdir(dir, { recursive: true })
    stream = createWriteStream(tempPath)
  } catch {
    activeWriters.delete(activityKey)
    releaseLock()
    return null
  }

  let failed = false
  let finished = false
  let bytesWritten = 0
  stream.on('error', () => { failed = true })
  const release = () => {
    if (finished) return
    finished = true
    activeWriters.delete(activityKey)
    releaseLock()
  }

  return {
    async write(chunk) {
      if (failed || finished) return
      bytesWritten += chunk.byteLength
      if (stream.write(chunk)) return
      await new Promise<void>((resolve) => {
        const finish = () => {
          stream.off('drain', finish)
          stream.off('close', finish)
          stream.off('error', finish)
          resolve()
        }
        stream.once('drain', finish)
        stream.once('close', finish)
        stream.once('error', finish)
      })
    },
    async commit() {
      if (finished) return false
      await new Promise<void>((resolve) => stream.end(resolve))
      const expected = context?.expectedBytes
      if (failed || (expected != null && expected !== bytesWritten)) {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
        release()
        return false
      }
      try {
        try {
          const existing = await fsp.stat(finalPath)
          if (context?.expectedBytes != null && existing.size !== context.expectedBytes) {
            await fsp.rm(finalPath, { force: true })
            await fsp.rename(tempPath, finalPath)
          } else {
            await fsp.rm(tempPath, { force: true })
          }
        } catch {
          await fsp.rename(tempPath, finalPath)
        }
        const stat = await fsp.stat(finalPath)
        if (context) {
          await upsertManagedEntry(userDataDir, dir, cacheKey, stat.size, context)
        } else {
          await withMutation(userDataDir, async () => {
            const index = await loadIndex(userDataDir, dir)
            if (!index.entries[entryId]) {
              const now = Date.now()
              index.entries[entryId] = {
                legacy: true,
                entryId,
                fileName: fileNameFor(cacheKey),
                size: stat.size,
                createdAt: now,
                updatedAt: now,
              }
              await writeIndex(dir, index)
            }
          })
        }
        release()
        await enforceAudioCacheLimit(userDataDir)
        return true
      } catch {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
        release()
        return false
      }
    },
    abort() {
      if (finished) return
      failed = true
      stream.destroy()
      void fsp.rm(tempPath, { force: true }).catch(() => {})
      release()
    },
  }
}

async function listBinFiles(dir: string): Promise<Array<{ entryId: string; path: string; size: number; mtimeMs: number }>> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const files: Array<{ entryId: string; path: string; size: number; mtimeMs: number }> = []
  for (const name of names) {
    const match = /^([a-f0-9]{40})\.bin$/i.exec(name)
    if (!match) continue
    const path = join(dir, name)
    try {
      const stat = await fsp.stat(path)
      files.push({ entryId: match[1], path, size: stat.size, mtimeMs: stat.mtimeMs })
    } catch {
      /* 并发删除，忽略 */
    }
  }
  return files
}

async function enforceAudioCacheLimit(userDataDir: string, explicitLimit?: number): Promise<void> {
  const config = await getAudioCacheConfig(userDataDir)
  await withMutation(userDataDir, async () => {
    const index = await loadIndex(userDataDir, config.dir)
    const files = await listBinFiles(config.dir)
    const indexed = new Map(Object.values(index.entries).map((entry) => [entry.entryId, entry]))
    const candidates = files.filter((file) => {
      const entry = indexed.get(file.entryId)
      if (!entry || hasSavedOrigin(entry)) return false
      const key = entryActivityKey(config.dir, file.entryId)
      return !activeWriters.has(key) && !(activeReaders.get(key) ?? 0)
    })
    let temporaryBytes = candidates.reduce((sum, file) => sum + file.size, 0)
    const limit = explicitLimit ?? config.limitBytes
    if (temporaryBytes <= limit) return
    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let changed = false
    for (const file of candidates) {
      if (temporaryBytes <= limit) break
      const activityKey = entryActivityKey(config.dir, file.entryId)
      blockedEntries.add(activityKey)
      try {
        await fsp.rm(file.path, { force: true })
        delete index.entries[file.entryId]
        temporaryBytes -= file.size
        changed = true
      } catch {
        /* 下次超限检查重试。 */
      } finally {
        blockedEntries.delete(activityKey)
      }
    }
    if (changed) await writeIndex(config.dir, index)
  })
}

/** 兼容原调用；缺索引时按旧语义处理全部 .bin。 */
export async function enforceCacheLimit(dir: string, limit = AUDIO_CACHE_LIMIT_BYTES): Promise<void> {
  const index = await readIndexFile(join(dir, INDEX_FILE))
  const files = await listBinFiles(dir)
  const candidates = files.filter((file) => {
    const entry = index?.entries[file.entryId]
    return !entry || !hasSavedOrigin(entry)
  }).sort((a, b) => a.mtimeMs - b.mtimeMs)
  let bytes = candidates.reduce((sum, file) => sum + file.size, 0)
  for (const file of candidates) {
    if (bytes <= limit) break
    await fsp.rm(file.path, { force: true }).catch(() => {})
    bytes -= file.size
  }
}

function matchingCandidates(index: AudioCacheIndexV1, source: OnlineSource, id: string): ManagedAudioCacheEntry[] {
  const key = `${source}:${id}`
  return Object.values(index.entries).filter((entry): entry is ManagedAudioCacheEntry => (
    !entry.legacy && entry.origins.some((origin) => originKey(origin) === key)
  ))
}

function pickOfflineEntry(entries: ManagedAudioCacheEntry[], source: OnlineSource, id: string): ManagedAudioCacheEntry | null {
  const key = `${source}:${id}`
  return [...entries].sort((a, b) => {
    const ao = a.origins.find((origin) => originKey(origin) === key)
    const bo = b.origins.find((origin) => originKey(origin) === key)
    const saved = Number(bo?.savedAt ?? 0) - Number(ao?.savedAt ?? 0)
    if (saved) return saved
    const direct = Number(b.resolved.source === source) - Number(a.resolved.source === source)
    if (direct) return direct
    const used = Number(bo?.lastUsedAt ?? 0) - Number(ao?.lastUsedAt ?? 0)
    if (used) return used
    return a.entryId.localeCompare(b.entryId)
  })[0] ?? null
}

export interface SavedAudioCacheItem {
  origin: AudioCacheOriginInput
  entryId: string
  savedAt: number
  size: number
  quality: string
}

async function validateIndexFiles(dir: string, index: AudioCacheIndexV1): Promise<void> {
  let changed = false
  for (const entry of Object.values(index.entries)) {
    try {
      const stat = await fsp.stat(join(dir, entry.fileName))
      if (stat.size !== entry.size) {
        delete index.entries[entry.entryId]
        changed = true
      }
    } catch {
      delete index.entries[entry.entryId]
      changed = true
    }
  }
  if (changed) await writeIndex(dir, index)
}

/** 按原始曲目列出主动保存内容，不暴露文件路径或临时缓存。 */
export async function listSavedAudioCache(userDataDir: string): Promise<SavedAudioCacheItem[]> {
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return []
    const index = await loadIndex(userDataDir, dir)
    await validateIndexFiles(dir, index)
    const saved = new Map<string, SavedAudioCacheItem>()
    for (const entry of Object.values(index.entries)) {
      if (entry.legacy) continue
      for (const origin of entry.origins) {
        if (origin.savedAt == null) continue
        const key = originKey(origin)
        const previous = saved.get(key)
        if (previous && previous.savedAt >= origin.savedAt) continue
        const { lastUsedAt: _lastUsedAt, savedAt, ...snapshot } = origin
        saved.set(key, { origin: snapshot, savedAt, entryId: entry.entryId, size: entry.size, quality: entry.quality })
      }
    }
    return [...saved.values()].sort((a, b) => b.savedAt - a.savedAt || originKey(a.origin).localeCompare(originKey(b.origin)))
  })
}

export async function getAudioCacheStatuses(
  userDataDir: string,
  refs: Array<{ source: OnlineSource; id: string }>
): Promise<OfflineCacheStatus[]> {
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return refs.map(({ source, id }) => ({ source, id, state: 'missing' as const }))
    const index = await loadIndex(userDataDir, dir)
    await validateIndexFiles(dir, index)

    return refs.map((ref) => {
      const source = ref.source
      const id = String(ref.id)
      const selected = pickOfflineEntry(matchingCandidates(index, source, id), source, id)
      if (!selected) return { source, id, state: 'missing' }
      const alias = selected.origins.find((origin) => originKey(origin) === `${source}:${id}`)
      return {
        source,
        id,
        state: alias?.savedAt != null ? 'pinned' : 'cached',
        entryId: selected.entryId,
        resolved: selected.resolved,
        quality: selected.quality,
        size: selected.size,
        savedAliasCount: savedAliasCount(selected),
      }
    })
  })
}

export async function openAudioCacheEntry(
  userDataDir: string,
  entryId: string,
  origin: { source: OnlineSource; id: string }
): Promise<{ path: string; size: number; contentType: string; release(): void } | null> {
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return null
    const index = await loadIndex(userDataDir, dir)
    const entry = index.entries[entryId]
    if (!entry || entry.legacy) return null
    const key = originKey(origin)
    const alias = entry.origins.find((item) => originKey(item) === key)
    if (!alias) return null
    const path = join(dir, entry.fileName)
    let stat
    try {
      stat = await fsp.stat(path)
    } catch {
      delete index.entries[entryId]
      await writeIndex(dir, index)
      return null
    }
    if (stat.size !== entry.size) {
      delete index.entries[entryId]
      await writeIndex(dir, index)
      return null
    }
    const now = Date.now()
    alias.lastUsedAt = now
    entry.updatedAt = now
    await fsp.utimes(path, new Date(now), new Date(now)).catch(() => {})
    await writeIndex(dir, index)
    const activityKey = entryActivityKey(dir, entryId)
    activeReaders.set(activityKey, (activeReaders.get(activityKey) ?? 0) + 1)
    let released = false
    return {
      path,
      size: stat.size,
      contentType: entry.contentType,
      release() {
        if (released) return
        released = true
        const remaining = (activeReaders.get(activityKey) ?? 1) - 1
        if (remaining > 0) activeReaders.set(activityKey, remaining)
        else activeReaders.delete(activityKey)
      },
    }
  })
}

export async function pinAudioCacheEntry(
  userDataDir: string,
  entryId: string,
  originInput: AudioCacheOriginInput,
  pinned: boolean
): Promise<CacheMutationResult> {
  const origin = normalizeOrigin(originInput)
  if (!origin) return { ok: false, error: 'NOT_FOUND' }
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return { ok: false, error: 'CACHE_BUSY' }
    const index = await loadIndex(userDataDir, dir)
    const entry = index.entries[entryId]
    if (!entry || entry.legacy) return { ok: false, error: 'NOT_FOUND' }
    const key = originKey(origin)
    const alias = entry.origins.find((item) => originKey(item) === key)
    if (!alias) return { ok: false, error: 'NOT_FOUND' }
    if (pinned) {
      for (const candidate of Object.values(index.entries)) {
        if (candidate.legacy || candidate.entryId === entryId) continue
        candidate.origins = candidate.origins.map((item) => (
          originKey(item) === key ? { ...item, savedAt: undefined } : item
        ))
      }
      Object.assign(alias, origin, { savedAt: Date.now(), lastUsedAt: Date.now() })
    } else {
      alias.savedAt = undefined
    }
    await writeIndex(dir, index)
    return { ok: true }
  })
}

export async function deleteAudioCacheEntry(
  userDataDir: string,
  entryId: string,
  originInput: Pick<AudioCacheOriginInput, 'source' | 'id'>,
  confirmShared = false,
  expectedSavedAt?: number
): Promise<CacheMutationResult> {
  const origin = normalizeOrigin(originInput as AudioCacheOriginInput)
  if (!origin) return { ok: false, error: 'NOT_FOUND' }
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return { ok: false, error: 'CACHE_BUSY' }
    const index = await loadIndex(userDataDir, dir)
    const entry = index.entries[entryId]
    if (!entry || entry.legacy) return { ok: false, error: 'NOT_FOUND' }
    const key = originKey(origin)
    const alias = entry.origins.find((item) => originKey(item) === key)
    if (!alias || (expectedSavedAt != null && alias.savedAt !== expectedSavedAt)) return { ok: false, error: 'NOT_FOUND' }
    const otherSaved = entry.origins.filter((item) => item.savedAt != null && originKey(item) !== key).length
    // 按离线列表快照删除时，只移除所选保存；其他歌曲仍使用的共享音频必须保留。
    if (expectedSavedAt != null && otherSaved > 0) {
      alias.savedAt = undefined
      await writeIndex(dir, index)
      return { ok: true }
    }
    if (otherSaved > 0 && !confirmShared) {
      return { ok: false, error: 'CACHE_SHARED', savedAliasCount: savedAliasCount(entry) }
    }
    const activityKey = entryActivityKey(dir, entryId)
    blockedEntries.add(activityKey)
    try {
      if (activeWriters.has(activityKey) || (activeReaders.get(activityKey) ?? 0) > 0) {
        return { ok: false, error: 'CACHE_BUSY' }
      }
      try {
        await fsp.rm(join(dir, entry.fileName), { force: true })
      } catch {
        return { ok: false, error: 'CACHE_BUSY' }
      }
      delete index.entries[entryId]
      await writeIndex(dir, index)
      return { ok: true }
    } finally {
      blockedEntries.delete(activityKey)
    }
  })
}

export async function clearAudioCacheScope(
  userDataDir: string,
  scope: 'temporary' | 'pinned' | 'unmanaged' | 'all'
): Promise<CacheMutationResult> {
  const { dir } = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    if (maintenanceDirs.has(dir)) return { ok: false, error: 'CACHE_BUSY' }
    maintenanceDirs.add(dir)
    try {
      if (hasActiveEntriesInDir(dir)) return { ok: false, error: 'CACHE_BUSY' }
      const index = await loadIndex(userDataDir, dir)
      const files = await listBinFiles(dir)
      const indexedIds = new Set(Object.keys(index.entries))
      const removeIds = new Set<string>()
      if (scope === 'temporary' || scope === 'all') {
        for (const entry of Object.values(index.entries)) if (!hasSavedOrigin(entry)) removeIds.add(entry.entryId)
      }
      if (scope === 'pinned' || scope === 'all') {
        for (const entry of Object.values(index.entries)) if (hasSavedOrigin(entry)) removeIds.add(entry.entryId)
      }
      if (scope === 'unmanaged' || scope === 'all') {
        for (const file of files) if (!indexedIds.has(file.entryId)) removeIds.add(file.entryId)
      }
      let failed = false
      for (const file of files) {
        if (!removeIds.has(file.entryId)) continue
        try {
          await fsp.rm(file.path, { force: true })
          delete index.entries[file.entryId]
        } catch {
          failed = true
        }
      }
      const names = await fsp.readdir(dir).catch(() => [] as string[])
      await Promise.all(names.filter(isAudioCachePartFile).map((name) => fsp.rm(join(dir, name), { force: true }).catch(() => {})))
      await writeIndex(dir, index)
      return failed ? { ok: false, error: 'CACHE_BUSY' } : { ok: true }
    } finally {
      maintenanceDirs.delete(dir)
    }
  })
}

export async function clearAudioCache(userDataDir: string): Promise<void> {
  await clearAudioCacheScope(userDataDir, 'all')
}

export async function audioCacheStats(userDataDir: string): Promise<AudioCacheStats> {
  const config = await getAudioCacheConfig(userDataDir)
  return withMutation(userDataDir, async () => {
    const index = await loadIndex(userDataDir, config.dir)
    const files = await listBinFiles(config.dir)
    let temporaryBytes = 0
    let temporaryFiles = 0
    let pinnedBytes = 0
    let pinnedFiles = 0
    let unmanagedBytes = 0
    let unmanagedFiles = 0
    for (const file of files) {
      const entry = index.entries[file.entryId]
      if (!entry) {
        unmanagedBytes += file.size
        unmanagedFiles++
      } else if (hasSavedOrigin(entry)) {
        pinnedBytes += file.size
        pinnedFiles++
      } else {
        temporaryBytes += file.size
        temporaryFiles++
      }
    }
    return {
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      files: files.length,
      temporaryBytes,
      temporaryFiles,
      pinnedBytes,
      pinnedFiles,
      unmanagedBytes,
      unmanagedFiles,
      limit: config.limitBytes,
      dir: config.dir,
    }
  })
}

export function serveFileWithRange(
  res: ServerResponse,
  filePath: string,
  size: number,
  range: string,
  contentType: string,
  onDone?: () => void
): void {
  const base: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }
  const parsed = range ? parseByteRange(range, size) : null
  if (range && !parsed) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` })
    res.end()
    onDone?.()
    return
  }
  const stream = parsed
    ? createReadStream(filePath, { start: parsed.start, end: parsed.end })
    : createReadStream(filePath)
  if (parsed) {
    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
      'Content-Length': String(parsed.end - parsed.start + 1),
    })
  } else {
    res.writeHead(200, { ...base, 'Content-Length': String(size) })
  }
  let done = false
  const finish = () => {
    if (done) return
    done = true
    onDone?.()
  }
  stream.once('error', () => {
    res.end()
    finish()
  })
  stream.once('close', finish)
  res.once('close', finish)
  stream.pipe(res)
}

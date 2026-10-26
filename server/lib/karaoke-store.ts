import { createHash } from 'node:crypto'
import { createWriteStream, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchSafeUpstream } from './upstream-fetch'

/** AI K 歌：UVR MDX-Net 模型与分离出的伴奏都放在 userData/karaoke，不并入音频缓存索引。 */

export const KARAOKE_MODEL = {
  url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx',
  sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
  bytes: 66_759_214,
  fileName: 'UVR-MDX-NET-Inst_HQ_3.onnx',
} as const

/** 伴奏 WAV 每首约 50MB，按最久未用淘汰到此上限以内。 */
export const KARAOKE_STEM_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
/** 单个伴奏上传上限：44.1kHz 16bit 立体声约 30 分钟。 */
export const KARAOKE_STEM_MAX_BYTES = 320 * 1024 * 1024

export type KaraokeModelState = 'missing' | 'downloading' | 'ready' | 'error'

export interface KaraokeModelStatus {
  state: KaraokeModelState
  receivedBytes: number
  totalBytes: number
  error?: string
}

export function karaokeDir(userDataDir: string): string {
  return join(userDataDir, 'karaoke')
}

function modelPath(userDataDir: string): string {
  return join(karaokeDir(userDataDir), KARAOKE_MODEL.fileName)
}

function stemsDir(userDataDir: string): string {
  return join(karaokeDir(userDataDir), 'stems')
}

/** 伴奏文件名只由 key 的摘要决定，key 不进入路径。 */
export function karaokeStemPath(userDataDir: string, key: string): string {
  return join(stemsDir(userDataDir), `${createHash('sha1').update(key).digest('hex')}.wav`)
}

const downloads = new Map<string, { promise: Promise<void>; status: KaraokeModelStatus }>()

async function fileSize(path: string): Promise<number | null> {
  try { return (await fsp.stat(path)).size } catch { return null }
}

export async function karaokeModelStatus(userDataDir: string): Promise<KaraokeModelStatus> {
  const running = downloads.get(userDataDir)
  if (running) return { ...running.status }
  const size = await fileSize(modelPath(userDataDir))
  return size === KARAOKE_MODEL.bytes
    ? { state: 'ready', receivedBytes: size, totalBytes: size }
    : { state: 'missing', receivedBytes: 0, totalBytes: KARAOKE_MODEL.bytes }
}

/**
 * 下载并校验模型；同一目录同时只有一个下载，失败状态保留到下次调用
 *
 * @param userDataDir 应用数据目录
 * @param fetcher 测试替身，缺省逐跳校验地址
 */
export async function ensureKaraokeModel(
  userDataDir: string,
  fetcher: (url: string) => Promise<Response> = fetchSafeUpstream,
): Promise<KaraokeModelStatus> {
  const current = await karaokeModelStatus(userDataDir)
  if (current.state === 'ready' || current.state === 'downloading') return current
  const status: KaraokeModelStatus = { state: 'downloading', receivedBytes: 0, totalBytes: KARAOKE_MODEL.bytes }
  const target = modelPath(userDataDir)
  const part = `${target}.part`
  const promise = (async () => {
    await fsp.mkdir(karaokeDir(userDataDir), { recursive: true })
    const response = await fetcher(KARAOKE_MODEL.url)
    if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）`)
    const hash = createHash('sha256')
    const counted = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
      hash.update(chunk)
      status.receivedBytes += chunk.length
    })
    await pipeline(counted, createWriteStream(part))
    if (hash.digest('hex') !== KARAOKE_MODEL.sha256) throw new Error('模型校验失败，请重试')
    await fsp.rename(part, target)
  })()
  downloads.set(userDataDir, { promise, status })
  promise.then(() => {
    downloads.delete(userDataDir)
  }, async (error: unknown) => {
    await fsp.rm(part, { force: true }).catch(() => {})
    status.state = 'error'
    // 失败状态保留给轮询展示，下次 ensure 时重新下载
    status.error = error instanceof Error ? error.message : '模型下载失败'
  })
  return { ...status }
}

export async function karaokeModelFile(userDataDir: string): Promise<{ path: string; size: number } | null> {
  const path = modelPath(userDataDir)
  const size = await fileSize(path)
  return size === KARAOKE_MODEL.bytes ? { path, size } : null
}

export async function findKaraokeStem(userDataDir: string, key: string): Promise<{ path: string; size: number } | null> {
  const path = karaokeStemPath(userDataDir, key)
  const size = await fileSize(path)
  if (!size) return null
  // 访问时间作为淘汰依据
  const now = new Date()
  await fsp.utimes(path, now, now).catch(() => {})
  return { path, size }
}

/**
 * 写入伴奏：先落临时文件，校验 WAV 头后改名，再按上限淘汰旧文件
 *
 * @param body 上传的 WAV 字节流
 */
export async function writeKaraokeStem(
  userDataDir: string,
  key: string,
  body: AsyncIterable<Buffer>,
  limitBytes = KARAOKE_STEM_LIMIT_BYTES,
): Promise<number> {
  const dir = stemsDir(userDataDir)
  await fsp.mkdir(dir, { recursive: true })
  const target = karaokeStemPath(userDataDir, key)
  const part = `${target}.${process.pid}.${Date.now()}.part`
  const out = createWriteStream(part)
  let size = 0
  let header = Buffer.alloc(0)
  try {
    for await (const chunk of body) {
      size += chunk.length
      if (size > KARAOKE_STEM_MAX_BYTES) throw new Error('伴奏文件过大')
      if (header.length < 12) header = Buffer.concat([header, chunk.subarray(0, 12 - header.length)])
      if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()))
    if (header.toString('latin1', 0, 4) !== 'RIFF' || header.toString('latin1', 8, 12) !== 'WAVE') throw new Error('不是有效的 WAV 文件')
    await fsp.rename(part, target)
  } catch (error) {
    out.destroy()
    await fsp.rm(part, { force: true }).catch(() => {})
    throw error
  }
  await enforceKaraokeStemLimit(userDataDir, limitBytes, target)
  return size
}

/** 按访问时间从旧到新删除，直到总量不超过上限；刚写入的文件不删。 */
export async function enforceKaraokeStemLimit(userDataDir: string, limitBytes: number, keep?: string): Promise<void> {
  const dir = stemsDir(userDataDir)
  const names = await fsp.readdir(dir).catch(() => [] as string[])
  const files = (await Promise.all(names.filter(name => name.endsWith('.wav')).map(async name => {
    const path = join(dir, name)
    const stat = await fsp.stat(path).catch(() => null)
    return stat ? { path, size: stat.size, used: stat.mtimeMs } : null
  }))).filter((file): file is { path: string; size: number; used: number } => !!file)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((a, b) => a.used - b.used)) {
    if (total <= limitBytes) break
    if (file.path === keep) continue
    await fsp.rm(file.path, { force: true }).catch(() => {})
    total -= file.size
  }
}

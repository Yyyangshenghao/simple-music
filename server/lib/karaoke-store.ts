import { createHash } from 'node:crypto'
import { createWriteStream, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchSafeUpstream } from './upstream-fetch'
import type { KaraokeModelId, KaraokeModelParams, KaraokeModelState, KaraokeModelView } from '../../src/types/karaoke'

/**
 * AI K 歌：UVR MDX-Net 模型与分离出的伴奏都放在 userData/karaoke，不并入音频缓存索引。
 * 模型在 karaoke/models/，伴奏按模型分目录放在 karaoke/stems/<模型>/。
 */

export interface KaraokeModelInfo {
  id: KaraokeModelId
  name: string
  description: string
  precision: 'fp32' | 'fp16'
  url: string
  sha256: string
  bytes: number
  fileName: string
  params: KaraokeModelParams
  peakVramMb: number
}

const UVR_RELEASE = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models'
/**
 * 自转模型随首次带上它的版本 Release 一起发布（附件由 scripts/karaoke/ 生成，见 docs/build-and-release.md），
 * 之后的版本继续指向这里，不要随版本号改动，也不要删除该 Release 的附件。
 */
const APP_RELEASE = 'https://github.com/Yyyangshenghao/simple-music/releases/download/v2.6.0'

/** 参数按 UVR model_data 表（模型文件末 10000KB 的 MD5 为键）逐个核对过。 */
export const KARAOKE_MODELS: readonly KaraokeModelInfo[] = [
  {
    id: 'hq3',
    name: 'HQ3 标准',
    description: '去人声最干净，适合大多数歌曲',
    precision: 'fp32',
    url: `${UVR_RELEASE}/UVR-MDX-NET-Inst_HQ_3.onnx`,
    sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
    bytes: 66_759_214,
    fileName: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    params: { nFft: 6144, dimF: 3072, dimT: 256 },
    peakVramMb: 1640,
  },
  {
    id: 'hq3-fp16',
    name: 'HQ3 省显存',
    description: '同 HQ3 的半精度版本，显存约减半、速度快约四分之一，音质几乎无差别',
    precision: 'fp16',
    url: `${APP_RELEASE}/UVR-MDX-NET-Inst_HQ_3-fp16.onnx`,
    sha256: '62d30044a9e0980efe2daeba0e0f2080fcb23bf8a46b98c0ba5183fe9bf80a9e',
    bytes: 33_398_584,
    fileName: 'UVR-MDX-NET-Inst_HQ_3-fp16.onnx',
    params: { nFft: 6144, dimF: 3072, dimT: 256 },
    peakVramMb: 900,
  },
  {
    id: 'kara2',
    name: 'Karaoke 2 保留和声',
    description: '只去掉主唱，保留和声与伴唱',
    precision: 'fp32',
    url: `${UVR_RELEASE}/UVR_MDXNET_KARA_2.onnx`,
    sha256: 'bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4',
    bytes: 52_786_726,
    fileName: 'UVR_MDXNET_KARA_2.onnx',
    params: { nFft: 5120, dimF: 2048, dimT: 256 },
    peakVramMb: 1100,
  },
]

export function karaokeModelInfo(id: string): KaraokeModelInfo | undefined {
  return KARAOKE_MODELS.find(model => model.id === id)
}

/** 伴奏 WAV 每首约 50MB，所有模型合计按最久未用淘汰到此上限以内。 */
export const KARAOKE_STEM_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
/** 单个伴奏上传上限：44.1kHz 16bit 立体声约 30 分钟。 */
export const KARAOKE_STEM_MAX_BYTES = 320 * 1024 * 1024

export interface KaraokeModelStatus {
  state: KaraokeModelState
  receivedBytes: number
  totalBytes: number
  error?: string
}

export function karaokeDir(userDataDir: string): string {
  return join(userDataDir, 'karaoke')
}

function modelPath(userDataDir: string, model: KaraokeModelInfo): string {
  return join(karaokeDir(userDataDir), 'models', model.fileName)
}

function stemsDir(userDataDir: string, model?: KaraokeModelId): string {
  const root = join(karaokeDir(userDataDir), 'stems')
  return model ? join(root, model) : root
}

/** 伴奏文件名只由 key 的摘要决定，key 不进入路径。 */
export function karaokeStemPath(userDataDir: string, model: KaraokeModelId, key: string): string {
  return join(stemsDir(userDataDir, model), `${createHash('sha1').update(key).digest('hex')}.wav`)
}

const migrations = new Map<string, Promise<void>>()

/** 旧版只有 HQ3：模型放在 karaoke/ 根目录、伴奏平铺在 stems/，一次性挪进新布局。 */
function migrateLegacy(userDataDir: string): Promise<void> {
  let running = migrations.get(userDataDir)
  if (!running) {
    running = (async () => {
      const hq3 = karaokeModelInfo('hq3')!
      const legacyModel = join(karaokeDir(userDataDir), hq3.fileName)
      if ((await fileSize(legacyModel)) === hq3.bytes) {
        await fsp.mkdir(join(karaokeDir(userDataDir), 'models'), { recursive: true })
        await fsp.rename(legacyModel, modelPath(userDataDir, hq3)).catch(() => {})
      }
      const root = stemsDir(userDataDir)
      const legacyStems = (await fsp.readdir(root).catch(() => [] as string[])).filter(name => name.endsWith('.wav'))
      if (legacyStems.length) {
        await fsp.mkdir(stemsDir(userDataDir, 'hq3'), { recursive: true })
        for (const name of legacyStems) await fsp.rename(join(root, name), join(stemsDir(userDataDir, 'hq3'), name)).catch(() => {})
      }
    })()
    migrations.set(userDataDir, running)
  }
  return running
}

const downloads = new Map<string, { promise: Promise<void>; status: KaraokeModelStatus; abort: AbortController }>()
const downloadKey = (userDataDir: string, model: KaraokeModelInfo) => `${userDataDir}\n${model.id}`

async function fileSize(path: string): Promise<number | null> {
  try { return (await fsp.stat(path)).size } catch { return null }
}

export async function karaokeModelStatus(userDataDir: string, model: KaraokeModelInfo): Promise<KaraokeModelStatus> {
  await migrateLegacy(userDataDir)
  const running = downloads.get(downloadKey(userDataDir, model))
  if (running) return { ...running.status }
  const size = await fileSize(modelPath(userDataDir, model))
  return size === model.bytes
    ? { state: 'ready', receivedBytes: size, totalBytes: size }
    : { state: 'missing', receivedBytes: 0, totalBytes: model.bytes }
}

/**
 * 下载并校验模型；同一模型同时只有一个下载，失败状态保留到下次调用
 *
 * @param userDataDir 应用数据目录
 * @param fetcher 测试替身，缺省逐跳校验地址
 */
export async function ensureKaraokeModel(
  userDataDir: string,
  model: KaraokeModelInfo,
  fetcher: (url: string, signal: AbortSignal) => Promise<Response> = (url, signal) => fetchSafeUpstream(url, { signal }),
): Promise<KaraokeModelStatus> {
  const current = await karaokeModelStatus(userDataDir, model)
  if (current.state === 'ready' || current.state === 'downloading') return current
  const status: KaraokeModelStatus = { state: 'downloading', receivedBytes: 0, totalBytes: model.bytes }
  const abort = new AbortController()
  const target = modelPath(userDataDir, model)
  const part = `${target}.part`
  const key = downloadKey(userDataDir, model)
  const promise = (async () => {
    await fsp.mkdir(join(karaokeDir(userDataDir), 'models'), { recursive: true })
    abort.signal.throwIfAborted()
    const response = await fetcher(model.url, abort.signal)
    if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）`)
    const hash = createHash('sha256')
    const counted = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
      hash.update(chunk)
      status.receivedBytes += chunk.length
    })
    await pipeline(counted, createWriteStream(part), { signal: abort.signal })
    if (hash.digest('hex') !== model.sha256) throw new Error('模型校验失败，请重试')
    await fsp.rename(part, target)
  })()
  downloads.set(key, { promise, status, abort })
  promise.then(() => {
    if (downloads.get(key)?.promise === promise) downloads.delete(key)
  }, async (error: unknown) => {
    await fsp.rm(part, { force: true }).catch(() => {})
    if (downloads.get(key)?.promise !== promise) return
    if (abort.signal.aborted) {
      downloads.delete(key)
      return
    }
    status.state = 'error'
    // 失败状态保留给轮询展示，下次 ensure 时重新下载
    status.error = error instanceof Error ? error.message : '模型下载失败'
  })
  return { ...status }
}

/** 卸载模型：中止下载，删除模型文件和用它分离出的伴奏。 */
export async function uninstallKaraokeModel(userDataDir: string, model: KaraokeModelInfo): Promise<void> {
  await migrateLegacy(userDataDir)
  const key = downloadKey(userDataDir, model)
  const running = downloads.get(key)
  if (running) {
    running.abort.abort()
    downloads.delete(key)
    await running.promise.catch(() => {})
  }
  const target = modelPath(userDataDir, model)
  await fsp.rm(target, { force: true })
  await fsp.rm(`${target}.part`, { force: true })
  await clearKaraokeStems(userDataDir, model.id)
}

export async function karaokeModelFile(userDataDir: string, model: KaraokeModelInfo): Promise<{ path: string; size: number } | null> {
  await migrateLegacy(userDataDir)
  const path = modelPath(userDataDir, model)
  const size = await fileSize(path)
  return size === model.bytes ? { path, size } : null
}

async function listStems(userDataDir: string, model?: KaraokeModelId): Promise<Array<{ path: string; size: number; used: number; model: KaraokeModelId }>> {
  const models = model ? [model] : KARAOKE_MODELS.map(item => item.id)
  const lists = await Promise.all(models.map(async (id) => {
    const dir = stemsDir(userDataDir, id)
    const names = await fsp.readdir(dir).catch(() => [] as string[])
    return Promise.all(names.filter(name => name.endsWith('.wav')).map(async (name) => {
      const path = join(dir, name)
      const stat = await fsp.stat(path).catch(() => null)
      return stat ? { path, size: stat.size, used: stat.mtimeMs, model: id } : null
    }))
  }))
  return lists.flat().filter((file): file is { path: string; size: number; used: number; model: KaraokeModelId } => !!file)
}

export async function clearKaraokeStems(userDataDir: string, model?: KaraokeModelId): Promise<void> {
  await migrateLegacy(userDataDir)
  for (const file of await listStems(userDataDir, model)) await fsp.rm(file.path, { force: true }).catch(() => {})
}

/** 模型列表：目录表加上本机安装状态与各自的伴奏占用。 */
export async function karaokeModelViews(userDataDir: string): Promise<KaraokeModelView[]> {
  await migrateLegacy(userDataDir)
  const stems = await listStems(userDataDir)
  return Promise.all(KARAOKE_MODELS.map(async (model) => {
    const status = await karaokeModelStatus(userDataDir, model)
    const own = stems.filter(file => file.model === model.id)
    return {
      id: model.id,
      name: model.name,
      description: model.description,
      precision: model.precision,
      requiresF16: model.precision === 'fp16',
      bytes: model.bytes,
      peakVramMb: model.peakVramMb,
      params: model.params,
      state: status.state,
      receivedBytes: status.receivedBytes,
      ...(status.error ? { error: status.error } : {}),
      stemBytes: own.reduce((sum, file) => sum + file.size, 0),
      stemCount: own.length,
    }
  }))
}

export async function findKaraokeStem(userDataDir: string, model: KaraokeModelId, key: string): Promise<{ path: string; size: number } | null> {
  await migrateLegacy(userDataDir)
  const path = karaokeStemPath(userDataDir, model, key)
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
  model: KaraokeModelId,
  key: string,
  body: AsyncIterable<Buffer>,
  limitBytes = KARAOKE_STEM_LIMIT_BYTES,
): Promise<number> {
  await migrateLegacy(userDataDir)
  await fsp.mkdir(stemsDir(userDataDir, model), { recursive: true })
  const target = karaokeStemPath(userDataDir, model, key)
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

/** 所有模型的伴奏合计，按访问时间从旧到新删除，直到不超过上限；刚写入的文件不删。 */
export async function enforceKaraokeStemLimit(userDataDir: string, limitBytes: number, keep?: string): Promise<void> {
  const files = await listStems(userDataDir)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((a, b) => a.used - b.used)) {
    if (total <= limitBytes) break
    if (file.path === keep) continue
    await fsp.rm(file.path, { force: true }).catch(() => {})
    total -= file.size
  }
}

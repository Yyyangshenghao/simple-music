import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Accompaniment, KaraokeLibrary, KaraokeModelId } from '../../src/types/karaoke'
import { isKaraokeModelId, sameKaraokeTrack } from '../../src/types/karaoke'
import type { Track } from '../../src/types/domain'
import { findKaraokeStem } from './karaoke-store'

const MANIFEST = '.simplemusic-accompaniments.json'
/** 人声侧轨只供应用内混回和声，藏在保存目录的子文件夹里，用户看到的伴奏仍是普通立体声 WAV。 */
const VOCALS_DIR = '.simplemusic-vocals'
const vocalsPath = (directory: string, id: string) => join(directory, VOCALS_DIR, `${id}.wav`)
interface Config { directory: string; directories: string[]; notice?: string; defaultDirectory?: string }
type SavedAccompaniment = Omit<Accompaniment, 'directory' | 'available'>
const locks = new Map<string, Promise<void>>()

async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(done => { release = done })
  const tail = previous.then(() => current)
  locks.set(key, tail)
  await previous
  try { return await run() } finally { release(); if (locks.get(key) === tail) locks.delete(key) }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx' })
    await fs.rename(temporary, path)
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
}

async function writable(directory: string): Promise<void> {
  if (!isAbsolute(directory)) throw new Error('请选择有效的伴奏保存文件夹')
  await fs.mkdir(directory, { recursive: true })
  const probe = join(directory, `.simplemusic-write-${randomUUID()}`)
  await fs.writeFile(probe, '', { flag: 'wx' })
  await fs.unlink(probe)
}

const configFile = (root: string) => join(root, 'karaoke-library.json')

async function readConfig(root: string, defaultDir?: string, fallbackDir?: string): Promise<Config> {
  try {
    const value = JSON.parse(await fs.readFile(configFile(root), 'utf8')) as Config
    if (!isAbsolute(value.directory) || !Array.isArray(value.directories) || !value.directories.every(isAbsolute)) throw new Error('INVALID_CONFIG')
    // 随启动器复制的完整库以新位置为准，外部自选目录仍保留。
    if (defaultDir && value.defaultDirectory === value.directory && value.directory !== defaultDir) {
      const copiedLibrary = await fs.stat(join(defaultDir, MANIFEST)).catch(() => null)
      const directories = copiedLibrary ? value.directories.filter(directory => directory !== value.defaultDirectory) : value.directories
      return { ...value, directory: defaultDir, defaultDirectory: defaultDir, directories: [...new Set([defaultDir, ...directories])] }
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('伴奏目录配置读取失败，原文件已保留')
  }
  let directory = defaultDir ?? join(root, 'Accompaniments')
  let notice: string | undefined
  try { await writable(directory) } catch {
    directory = fallbackDir ?? join(root, 'Accompaniments')
    await writable(directory)
    notice = '默认位置不可写，已改用音乐文件夹中的伴奏目录'
  }
  return { directory: resolve(directory), directories: [resolve(directory)], notice, ...(!notice && defaultDir ? { defaultDirectory: resolve(directory) } : {}) }
}

async function config(root: string, defaultDir?: string, fallbackDir?: string): Promise<Config> {
  return locked(configFile(root), async () => {
    const value = await readConfig(root, defaultDir, fallbackDir)
    await fs.mkdir(root, { recursive: true })
    await writeJson(configFile(root), value)
    return value
  })
}

function validTrack(value: unknown): value is Track {
  const track = value as Track | null
  return !!track && ['netease', 'qq', 'local'].includes(track.source)
    && ['string', 'number'].includes(typeof track.id) && String(track.id).length > 0
    && typeof track.name === 'string' && typeof track.artist === 'string' && Array.isArray(track.artists)
}

async function readManifest(directory: string): Promise<SavedAccompaniment[]> {
  try {
    const data = JSON.parse(await fs.readFile(join(directory, MANIFEST), 'utf8'))
    if (data.version !== 1 || !Array.isArray(data.items) || !data.items.every((item: SavedAccompaniment) =>
      item && /^[a-f0-9]{40}$/.test(item.id) && isKaraokeModelId(item.model) && validTrack(item.track)
      && typeof item.key === 'string' && typeof item.fileName === 'string' && basename(item.fileName) === item.fileName
      && !/[\\/]/.test(item.fileName) && item.fileName.endsWith('.wav') && Number.isFinite(item.generatedAt) && Number.isFinite(item.bytes))) throw new Error('INVALID_MANIFEST')
    return data.items
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`伴奏索引读取失败，原文件已保留：${directory}`)
  }
}

export async function readKaraokeLibrary(root: string, defaultDir?: string, fallbackDir?: string): Promise<KaraokeLibrary> {
  const current = await config(root, defaultDir, fallbackDir)
  const items: Accompaniment[] = []
  for (const directory of current.directories) {
    for (const item of await readManifest(directory)) {
      const stat = await fs.stat(join(directory, item.fileName)).catch(() => null)
      const vocals = await fs.stat(vocalsPath(directory, item.id)).catch(() => null)
      items.push({ ...item, directory, available: !!stat?.isFile(), vocals: !!vocals?.isFile() && vocals.size === stat?.size })
    }
  }
  // 便携目录被整体搬动后，优先使用本次目录中可以读取的记录。
  items.sort((a, b) => Number(b.available) - Number(a.available) || b.generatedAt - a.generatedAt || Number(b.directory === current.directory) - Number(a.directory === current.directory))
  const unique = new Map<string, Accompaniment>()
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item)
  return { directory: current.directory, directoryNotice: current.notice, items: [...unique.values()] }
}

export async function setKaraokeDirectory(root: string, directory: string, defaultDir?: string, fallbackDir?: string): Promise<void> {
  await writable(directory)
  const target = resolve(directory)
  await locked(configFile(root), async () => {
    const current = await readConfig(root, defaultDir, fallbackDir)
    await fs.mkdir(root, { recursive: true })
    await writeJson(configFile(root), { directory: target, directories: [...new Set([...current.directories, target])] })
  })
}

export async function saveAccompaniment(root: string, input: { model: KaraokeModelId; key: string; track: Track; directory: string }, defaults: { defaultDir?: string; fallbackDir?: string } = {}): Promise<Accompaniment> {
  if (!isKaraokeModelId(input.model) || !validTrack(input.track) || !/^[a-z]+:[^\s]{1,200}$/.test(input.key)) throw new Error('伴奏信息不完整')
  const current = await config(root, defaults.defaultDir, defaults.fallbackDir)
  if (!current.directories.includes(input.directory)) throw new Error('伴奏保存目录未配置，请重新选择')
  return locked(input.directory, async () => {
    const items = await readManifest(input.directory)
    await writable(input.directory)
    // 实际音源可被多平台原曲共用；用户成品必须按原曲身份区分，并保留旧索引的 ID。
    const existing = items.find(item => item.model === input.model && item.key === input.key && sameKaraokeTrack(item.track, input.track))
    const id = existing?.id ?? createHash('sha1').update(JSON.stringify([input.model, input.track.source, String(input.track.mid ?? input.track.id), input.key])).digest('hex')
    if (existing && await fs.stat(join(input.directory, existing.fileName)).catch(() => null)) {
      const vocals = await fs.stat(vocalsPath(input.directory, existing.id)).catch(() => null)
      return { ...existing, directory: input.directory, available: true, vocals: !!vocals?.isFile() }
    }
    const stem = await findKaraokeStem(root, input.model, input.key)
    const vocalStem = await findKaraokeStem(root, input.model, input.key, 'vocals')
    if (!stem) throw new Error('伴奏文件不存在，请重新生成')
    const label = `${input.track.artist} - ${input.track.name} [${input.model}]`.replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '')
    const safe = Array.from(label).slice(0, 70).join('') || '伴奏'
    const fileName = `${safe} (${randomUUID().slice(0, 8)}).wav`
    const target = join(input.directory, fileName)
    const temporary = `${target}.part`
    let created = false
    let copied = false
    let vocals = false
    const { url: _url, ...track } = input.track
    const saved: SavedAccompaniment = { id, key: input.key, model: input.model, track, fileName, generatedAt: Date.now(), bytes: stem.size }
    try {
      await fs.copyFile(stem.path, temporary, constants.COPYFILE_EXCL)
      copied = true
      // 不覆盖用户放在同一路径的文件。
      await fs.link(temporary, target).catch(async error => {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await fs.copyFile(temporary, target, constants.COPYFILE_EXCL)
      })
      created = true
      // 侧轨缺失或复制失败只影响和声调节，不影响伴奏本身。
      if (vocalStem?.size === stem.size) {
        const sidecar = vocalsPath(input.directory, id)
        vocals = await fs.mkdir(join(input.directory, VOCALS_DIR), { recursive: true })
          .then(() => fs.copyFile(vocalStem.path, `${sidecar}.part`))
          .then(() => fs.rename(`${sidecar}.part`, sidecar))
          .then(() => true, () => fs.rm(`${sidecar}.part`, { force: true }).then(() => false, () => false))
      }
      await writeJson(join(input.directory, MANIFEST), { version: 1, items: [...items.filter(item => item.id !== id), saved] })
    } catch (error) {
      if (created) await fs.rm(target, { force: true }).catch(() => {})
      if (vocals) await fs.rm(vocalsPath(input.directory, id), { force: true }).catch(() => {})
      throw error
    }
    finally { if (copied) await fs.rm(temporary, { force: true }).catch(() => {}) }
    // 用户文件与索引都发布成功后才删除中间 WAV，避免长期保留两份音频。
    await fs.rm(stem.path, { force: true }).catch(() => {})
    if (vocalStem) await fs.rm(vocalStem.path, { force: true }).catch(() => {})
    return { ...saved, directory: input.directory, available: true, vocals }
  })
}

export async function accompanimentFile(root: string, id: string, defaultDir?: string, fallbackDir?: string): Promise<{ path: string; size: number; vocalsPath?: string } | null> {
  if (!/^[a-f0-9]{40}$/.test(id)) return null
  const item = (await readKaraokeLibrary(root, defaultDir, fallbackDir)).items.find(item => item.id === id && item.available)
  return item ? { path: join(item.directory, item.fileName), size: item.bytes, ...(item.vocals ? { vocalsPath: vocalsPath(item.directory, item.id) } : {}) } : null
}

export async function deleteAccompaniment(root: string, id: string, generatedAt: number, defaultDir?: string, fallbackDir?: string): Promise<void> {
  const item = (await readKaraokeLibrary(root, defaultDir, fallbackDir)).items.find(item => item.id === id)
  if (!item) return
  await locked(item.directory, async () => {
    const items = await readManifest(item.directory)
    const found = items.find(entry => entry.id === id)
    if (!found || found.generatedAt !== generatedAt) throw new Error('伴奏已更新，请刷新后重试')
    await fs.rm(join(item.directory, found.fileName), { force: true })
    await fs.rm(vocalsPath(item.directory, found.id), { force: true })
    await writeJson(join(item.directory, MANIFEST), { version: 1, items: items.filter(entry => entry.id !== id) })
  })
}

import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { getAudioCacheConfig, openAudioCacheEntry, type AudioCacheOriginInput } from './audio-cache'

const CONFIG_FILE = 'song-downloads.json'
const configTails = new Map<string, Promise<void>>()

async function withConfigMutation<T>(userDataDir: string, task: () => Promise<T>): Promise<T> {
  const previous = configTails.get(userDataDir) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  configTails.set(userDataDir, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (configTails.get(userDataDir) === tail) configTails.delete(userDataDir)
  }
}

async function prepareDownloadDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const probe = join(dir, `.simplemusic-write-${randomBytes(8).toString('hex')}`)
  await fs.writeFile(probe, '', { flag: 'wx' })
  await fs.unlink(probe)
}

export async function getSongDownloadConfig(userDataDir: string, defaultDir?: string): Promise<{ dir: string }> {
  return withConfigMutation(userDataDir, async () => {
    const fallback = (await getAudioCacheConfig(userDataDir)).dir
    try {
      const config = JSON.parse(await fs.readFile(join(userDataDir, CONFIG_FILE), 'utf8'))
      return { dir: typeof config?.dir === 'string' && isAbsolute(config.dir) ? config.dir : fallback }
    } catch (error) {
      // 仅无配置时启用新默认值；损坏或不可读的旧配置原样保留。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { dir: fallback }
    }
    let dir = fallback
    if (defaultDir && isAbsolute(defaultDir)) {
      try {
        await prepareDownloadDir(defaultDir)
        dir = resolve(defaultDir)
      } catch { /* 新目录不可写时继续使用原缓存位置，不移动或删除旧音频。 */ }
    }
    await fs.mkdir(userDataDir, { recursive: true })
    try {
      await fs.writeFile(join(userDataDir, CONFIG_FILE), JSON.stringify({ dir, mode: 'default' }), { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const config = JSON.parse(await fs.readFile(join(userDataDir, CONFIG_FILE), 'utf8'))
        if (typeof config?.dir === 'string' && isAbsolute(config.dir)) return { dir: config.dir }
      } catch { /* 并发出现的旧配置不可读时保留原文件并使用缓存位置。 */ }
      return { dir: fallback }
    }
    return { dir }
  })
}

export async function setSongDownloadDir(userDataDir: string, dir: string): Promise<{ dir: string }> {
  if (!isAbsolute(dir)) throw new Error('请选择有效的下载文件夹')
  const target = resolve(dir)
  return withConfigMutation(userDataDir, async () => {
    await prepareDownloadDir(target)
    await fs.mkdir(userDataDir, { recursive: true })
    const temporary = join(userDataDir, `${CONFIG_FILE}.${randomBytes(8).toString('hex')}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify({ dir: target, mode: 'custom' }), { flag: 'wx' })
      await fs.rename(temporary, join(userDataDir, CONFIG_FILE))
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
    return { dir: target }
  })
}

function safeName(text: string): string {
  let value = text.replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '-').trim().replace(/[. ]+$/, '')
  while (Buffer.byteLength(value) > 180) value = Array.from(value).slice(0, -1).join('')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`
  return value || '歌曲'
}

export function songExtension(header: Buffer, mime: string): string {
  const magic = header.toString('ascii')
  if (magic.startsWith('fLaC')) return '.flac'
  if (magic.startsWith('OggS')) return '.ogg'
  if (magic.startsWith('RIFF') && magic.slice(8, 12) === 'WAVE') return '.wav'
  if (magic.slice(4, 8) === 'ftyp') return '.m4a'
  if (magic.startsWith('ID3')) return '.mp3'
  if (header[0] === 0xff && (header[1] & 0xf6) === 0xf0) return '.aac'
  if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return '.mp3'
  const types: Record<string, string> = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/flac': '.flac', 'audio/x-flac': '.flac',
    'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac',
    'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  }
  const extension = types[mime.split(';')[0].trim().toLowerCase()]
  if (!extension) throw new Error('暂不支持导出此音频格式')
  return extension
}

/** 只读取索引中属于该歌曲的缓存；导出与缓存清理、目录设置相互独立。 */
export async function exportDownloadedSong(
  userDataDir: string, entryId: string, origin: AudioCacheOriginInput, dir: string, signal?: AbortSignal
): Promise<{ filePath: string; size: number }> {
  if (!isAbsolute(dir)) throw new Error('请选择有效的下载文件夹')
  const hit = await openAudioCacheEntry(userDataDir, entryId, origin)
  if (!hit) throw new Error('本地音频不存在，请重新下载')
  const temporary = join(dir, `.simplemusic-download-${randomBytes(12).toString('hex')}.tmp`)
  let completed: string | null = null
  try {
    signal?.throwIfAborted()
    await fs.mkdir(dir, { recursive: true })
    const handle = await fs.open(hit.path, 'r')
    const header = Buffer.alloc(16)
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    const extension = songExtension(header, hit.contentType)
    const name = safeName([origin.artist, origin.name || origin.id].filter(Boolean).join(' - '))
    await fs.copyFile(hit.path, temporary, constants.COPYFILE_EXCL)
    signal?.throwIfAborted()
    for (let index = 0; index < 1000; index++) {
      const filePath = join(dir, `${name}${index ? ` (${index})` : ''}${extension}`)
      try {
        try {
          // 同文件系统硬链接可原子发布完整文件，且已有同名文件永不覆盖。
          await fs.link(temporary, filePath)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code || '')) throw error
          await fs.copyFile(temporary, filePath, constants.COPYFILE_EXCL)
        }
        completed = filePath
        signal?.throwIfAborted()
        return { filePath, size: hit.size }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('同名歌曲文件过多，请选择其他目录')
  } catch (error) {
    if (completed) await fs.unlink(completed).catch(() => {})
    throw error
  } finally {
    await fs.unlink(temporary).catch(() => {})
    hit.release()
  }
}

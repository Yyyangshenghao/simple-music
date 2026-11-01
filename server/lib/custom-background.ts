import { promises as fsp } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, extname, join } from 'node:path'

export type CustomBackgroundKind = 'image' | 'video'

export interface CustomBackgroundMedia {
  /** 复制进 userData/backgrounds 后的文件名（随机 hex + 扩展名），同时作为服务端查找 id。 */
  id: string
  kind: CustomBackgroundKind
  /** 展示用名称：原文件名。 */
  name: string
}

const BACKGROUND_DIR = 'backgrounds'

const CONTENT_TYPES: Record<string, { kind: CustomBackgroundKind; type: string }> = {
  '.jpg': { kind: 'image', type: 'image/jpeg' },
  '.jpeg': { kind: 'image', type: 'image/jpeg' },
  '.png': { kind: 'image', type: 'image/png' },
  '.webp': { kind: 'image', type: 'image/webp' },
  '.gif': { kind: 'image', type: 'image/gif' },
  '.avif': { kind: 'image', type: 'image/avif' },
  '.mp4': { kind: 'video', type: 'video/mp4' },
  '.m4v': { kind: 'video', type: 'video/mp4' },
  '.webm': { kind: 'video', type: 'video/webm' },
  '.mov': { kind: 'video', type: 'video/quicktime' },
}

export const CUSTOM_BACKGROUND_EXTENSIONS = Object.keys(CONTENT_TYPES).map(ext => ext.slice(1))

const ID_PATTERN = new RegExp(`^[a-f0-9]{32}\\.(${CUSTOM_BACKGROUND_EXTENSIONS.join('|')})$`)

export class CustomBackgroundError extends Error {}

/** 背景图长边上限：原图多大，界面就按多大解码并上传 GPU（10000×5625 约 225MB），4K 足够铺满屏幕。 */
export const BACKGROUND_IMAGE_MAX_EDGE = 3840

/** 按原格式编码的缩小图；返回 null 表示不需要缩小或无法处理，保留原文件。 */
export type BackgroundImageShrinker = (sourcePath: string, maxEdge: number) => Promise<Buffer | null>

/** 解析用户选中的文件：只接受图片或视频，Wallpaper Engine 壁纸走独立的壁纸库。 */
export async function resolveBackgroundSource(path: string): Promise<{ sourcePath: string; kind: CustomBackgroundKind; name: string }> {
  const entry = CONTENT_TYPES[extname(path).toLowerCase()]
  if (!entry) throw new CustomBackgroundError('UNSUPPORTED_FILE')
  return { sourcePath: path, kind: entry.kind, name: basename(path) }
}

/**
 * 把选中的背景复制进 userData，之后与原文件无关（原文件移动/删除不影响）。
 * 传入 shrinkImage 时，超过长边上限的图片存缩小后的版本；缩图失败仍复制原图。
 */
export async function importCustomBackground(userDataDir: string, path: string, shrinkImage?: BackgroundImageShrinker): Promise<CustomBackgroundMedia> {
  const { sourcePath, kind, name } = await resolveBackgroundSource(path)
  const st = await fsp.stat(sourcePath).catch(() => null)
  if (!st?.isFile()) throw new CustomBackgroundError('FILE_MISSING')
  const dir = join(userDataDir, BACKGROUND_DIR)
  await fsp.mkdir(dir, { recursive: true })
  const shrunk = kind === 'image' && shrinkImage ? await shrinkImage(sourcePath, BACKGROUND_IMAGE_MAX_EDGE).catch(() => null) : null
  const id = `${randomBytes(16).toString('hex')}${extname(sourcePath).toLowerCase()}`
  if (shrunk) await fsp.writeFile(join(dir, id), shrunk)
  else await fsp.copyFile(sourcePath, join(dir, id))
  return { id, kind, name }
}

/** 早于导入缩图存下的超大背景原地换成缩小版，id 不变，已保存的背景设置无需改动。 */
export async function shrinkStoredBackgrounds(userDataDir: string, shrinkImage: BackgroundImageShrinker): Promise<void> {
  const dir = join(userDataDir, BACKGROUND_DIR)
  const ids = await fsp.readdir(dir).catch(() => [] as string[])
  for (const id of ids) {
    if (!ID_PATTERN.test(id) || CONTENT_TYPES[extname(id).toLowerCase()]?.kind !== 'image') continue
    const path = join(dir, id)
    const shrunk = await shrinkImage(path, BACKGROUND_IMAGE_MAX_EDGE).catch(() => null)
    if (!shrunk) continue
    // 先写临时文件再改名，中途退出也不会留下半截图片。
    const temp = `${path}.tmp`
    await fsp.writeFile(temp, shrunk)
    await fsp.rename(temp, path)
  }
}

/** id 校验通过才返回路径，避免路径穿越。 */
export function customBackgroundPath(userDataDir: string, id: string): string | null {
  return ID_PATTERN.test(id) ? join(userDataDir, BACKGROUND_DIR, id) : null
}

export function customBackgroundContentType(id: string): string {
  return CONTENT_TYPES[extname(id).toLowerCase()]?.type || 'application/octet-stream'
}

export async function removeCustomBackground(userDataDir: string, id: string): Promise<void> {
  const path = customBackgroundPath(userDataDir, id)
  if (path) await fsp.rm(path, { force: true })
}

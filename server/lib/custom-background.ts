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

/** 解析用户选中的文件：只接受图片或视频，Wallpaper Engine 壁纸走独立的壁纸库。 */
export async function resolveBackgroundSource(path: string): Promise<{ sourcePath: string; kind: CustomBackgroundKind; name: string }> {
  const entry = CONTENT_TYPES[extname(path).toLowerCase()]
  if (!entry) throw new CustomBackgroundError('UNSUPPORTED_FILE')
  return { sourcePath: path, kind: entry.kind, name: basename(path) }
}

/** 把选中的背景复制进 userData，之后与原文件无关（原文件移动/删除不影响）。 */
export async function importCustomBackground(userDataDir: string, path: string): Promise<CustomBackgroundMedia> {
  const { sourcePath, kind, name } = await resolveBackgroundSource(path)
  const st = await fsp.stat(sourcePath).catch(() => null)
  if (!st?.isFile()) throw new CustomBackgroundError('FILE_MISSING')
  const dir = join(userDataDir, BACKGROUND_DIR)
  await fsp.mkdir(dir, { recursive: true })
  const id = `${randomBytes(16).toString('hex')}${extname(sourcePath).toLowerCase()}`
  await fsp.copyFile(sourcePath, join(dir, id))
  return { id, kind, name }
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

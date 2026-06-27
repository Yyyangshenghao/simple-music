import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerContext } from '../types'

export type Source = 'netease' | 'qq'

const file = (ctx: ServerContext, s: Source) => join(ctx.userDataDir, `cookie-${s}.txt`)

export function getCookie(ctx: ServerContext, s: Source): string {
  const f = file(ctx, s)
  return existsSync(f) ? readFileSync(f, 'utf-8').trim() : ''
}

export function setCookie(ctx: ServerContext, s: Source, cookie: string): void {
  mkdirSync(ctx.userDataDir, { recursive: true })
  writeFileSync(file(ctx, s), cookie ?? '', 'utf-8')
}

export function clearCookie(ctx: ServerContext, s: Source): void {
  const f = file(ctx, s)
  if (existsSync(f)) rmSync(f)
}

/**
 * 节拍图缓存目录。替代原项目硬编码的 `D:\\MineradioCache\\beatmaps`，
 * 默认落在 userData 下，跨平台兼容；保留环境变量覆盖以兼容原行为。
 */
export function getBeatmapCacheDir(ctx: ServerContext): string {
  const dir = process.env.MINERADIO_BEAT_CACHE_DIR || join(ctx.userDataDir, 'beatmaps')
  mkdirSync(dir, { recursive: true })
  return dir
}

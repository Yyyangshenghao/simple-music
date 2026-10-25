import { api, tokenPathBase } from './api'
import type { WallpaperSelection } from '../types/domain'
import type { WallpaperSceneQuality, WallpaperSceneSettings } from '../stores/background'

/** 与 server/lib/wallpaper-engine.ts 的 WallpaperEngineLibrary 保持一致。 */
export interface WallpaperEngineLibrary {
  /** 找到的 Steam 库数量；0 表示本机没检测到。 */
  roots: number
  /** 手动指定的壁纸目录；null 表示自动检测。 */
  customRoot: string | null
  wallpapers: WallpaperSelection[]
  /** 网页型壁纸 iframe 的专用 token，和 API token 无关。 */
  webToken: string
}

interface LibraryPayload extends Partial<WallpaperEngineLibrary> {
  ok?: boolean
  error?: string
}

/** 最近一次读取到的 iframe token，应用重启后第一次渲染网页壁纸需要重新取。 */
let cachedWebToken = ''
const webTokenListeners = new Set<(token: string) => void>()

function cacheWebToken(webToken: string): void {
  if (!webToken || webToken === cachedWebToken) return
  cachedWebToken = webToken
  for (const listener of webTokenListeners) {
    try { listener(webToken) } catch { /* 单个订阅者出错不影响其它 */ }
  }
}

function toLibrary(payload: LibraryPayload): WallpaperEngineLibrary {
  if (payload.ok === false) throw new Error(payload.error ?? 'WALLPAPER_SCAN_FAILED')
  const webToken = typeof payload.webToken === 'string' ? payload.webToken : ''
  cacheWebToken(webToken)
  return {
    roots: payload.roots ?? 0,
    customRoot: payload.customRoot ?? null,
    wallpapers: payload.wallpapers ?? [],
    webToken,
  }
}

/** 列出 Steam 订阅的壁纸；refresh 忽略服务端 15 秒缓存，用于用户刚订阅后的「重新扫描」。 */
export async function fetchWallpaperEngineLibrary(refresh = false): Promise<WallpaperEngineLibrary> {
  return toLibrary(await api.get<LibraryPayload>('/api/wallpaper-engine/library', refresh ? { refresh: 1 } : undefined))
}

/** 指定壁纸目录；传 null 恢复自动检测 Steam。 */
export async function setWallpaperEngineRoot(path: string | null): Promise<WallpaperEngineLibrary> {
  return toLibrary(await api.post<LibraryPayload>('/api/wallpaper-engine/config', { path }))
}

/** 视频型壁纸的入口（支持 Range，可被 <video> 直接播放）。 */
export function wallpaperEngineVideoUrl(id: string): string {
  return api.url('/api/wallpaper-engine/file', { id })
}

/** 预览图；视频/网页/场景型都用它做卡片缩略图。 */
export function wallpaperEnginePreviewUrl(id: string): string {
  return api.url('/api/wallpaper-engine/preview', { id })
}

export function wallpaperEngineCachedWebToken(): string {
  return cachedWebToken
}

/**
 * 订阅 iframe token 就绪。启动时补取失败后，用户在设置页打开壁纸库
 * （或重新扫描）仍会更新缓存，背景据此重新挂载而不必等下次重启。
 */
export function subscribeWallpaperEngineWebToken(listener: (token: string) => void): () => void {
  webTokenListeners.add(listener)
  return () => { webTokenListeners.delete(listener) }
}

/** 应用启动后直接显示已选网页壁纸时，还没读过壁纸库，需要先取一次 iframe token。 */
export async function ensureWallpaperEngineWebToken(): Promise<string> {
  if (cachedWebToken) return cachedWebToken
  return (await fetchWallpaperEngineLibrary()).webToken
}

/** 网页型壁纸的整页地址，token 在路径段里，同目录资源才能一起加载。 */
export function wallpaperEngineWebUrl(id: string, token = cachedWebToken): string {
  return `${tokenPathBase('/we-wallpaper', token)}/${encodeURIComponent(id)}/`
}

/** 画质档位对应的内部渲染分辨率倍数；最高档由引擎按物理最长边 4096 再封顶。 */
export const WALLPAPER_SCENE_QUALITY_DPR: Record<WallpaperSceneQuality, number> = {
  smooth: 0.75,
  balanced: 1,
  detailed: 1.5,
}

/**
 * 场景型壁纸的遥控页地址。它在 127.0.0.1 的独立源里运行 WebWallGL 与壁纸脚本，
 * 主界面只通过 postMessage 控制暂停/帧率/频谱。
 *
 * 帧率不放进地址：遥控页挂载后可以热调，放进来会让改帧率时整页重载。
 * 画质与脚本开关只在挂载时读取，变化时由调用方换 key 重挂。
 */
export function wallpaperEngineSceneUrl(
  id: string,
  token = cachedWebToken,
  scene?: Pick<WallpaperSceneSettings, 'quality' | 'scripts'>
): string {
  const base = `${tokenPathBase('/we-scene', token)}/host?id=${encodeURIComponent(id)}`
  if (!scene) return base
  const query = new URLSearchParams({
    dpr: String(WALLPAPER_SCENE_QUALITY_DPR[scene.quality]),
    quality: scene.quality,
  })
  if (!scene.scripts) query.set('scripts', '0')
  return `${base}&${query.toString()}`
}

export const WALLPAPER_TYPE_LABELS: Record<WallpaperSelection['type'], string> = {
  video: '视频',
  web: '网页',
  scene: '场景',
  application: '应用',
  unknown: '未知',
}

/** 视频、网页与场景型能在应用内播放；应用型是独立 exe，只能显示预览图。 */
export function isPlayableWallpaper(type: WallpaperSelection['type']): boolean {
  return type === 'video' || type === 'web' || type === 'scene'
}

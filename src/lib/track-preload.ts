import { api } from './api'
import type { AudioQuality, Track } from '../types/domain'
import { sizedImage } from './image-size'
import { providerAccountSession } from './provider-account-session'

/**
 * 相邻曲目预加载:提前解析队列中前/后曲目的播放 URL、预热封面图 HTTP 缓存,
 * 切歌时省掉 URL 解析 RTT(起播延迟的大头)与封面网络等待。
 *
 * 普通队列与刷歌各保留一个窗口 合并保留集后再释放无人使用的资源
 */

export interface SongUrlResponse {
  url?: string
  /** 实际取到的档位标签(如"超清母带"/"无损"),用于播放条展示。 */
  quality?: string
  /** 实际交付的档位 level(如 lossless/exhigh);上游对不存在档位会降级,此为真实 level,用于磁盘缓存分键。 */
  level?: string
  /** 是否仅为试听片段(非完整文件);true 时不应写盘缓存,否则半截音频会被固化。 */
  trial?: boolean
  restriction?: { message: string }
  message?: string
  /** 同一解析请求发现的有序地址候选（QQ 可同时返回多档文件和多个 sip）。 */
  candidates?: Array<{
    url: string
    quality?: string
    level?: string
    trial?: boolean
  }>
}

/** 解析曲目的可播放上游 URL(按音源拼参数);loadTrack 与预加载共用同一份逻辑。 */
export function resolveSongUrl(
  track: Track,
  quality: AudioQuality,
  signal?: AbortSignal
): Promise<SongUrlResponse> {
  if (track.source === 'apple') return Promise.resolve({ message: 'Apple Music 使用官方播放器' })
  if (track.source === 'local') return Promise.resolve({ url: track.url })
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  // 已完成缓存由播放器和预热入口读取 进入普通解析也可能是坏地址重试
  const key = trackKey(track, quality)
  const pending = songUrlRequests.get(key)
  if (pending && !pending.controller.signal.aborted) return joinUrlRequest(pending, signal)
  const path = track.source === 'qq' ? '/api/qq/song/url' : '/api/song/url'
  const params =
    track.source === 'qq'
      ? {
          mid: String(track.mid ?? track.id ?? ''),
          mediaMid: String(track.mediaMid ?? ''),
          quality,
          fee: String(track.fee ?? ''),
        }
      : { id: String(track.id ?? ''), quality }
  const controller = new AbortController()
  const request: UrlRequest = { controller, users: 0, promise: Promise.resolve({}) }
  // 旧方案由调用方直接发起独立请求
  // return api.get<SongUrlResponse>(path, params, signal ? { signal } : undefined)
  request.promise = api.get<SongUrlResponse>(path, params, { signal: controller.signal })
    .then(result => {
      if (!controller.signal.aborted && result.url && latestKeep.has(key)) {
        urlCache.set(key, { ...result, url: result.url, expiresAt: Date.now() + URL_TTL_MS })
      }
      return result
    })
    .finally(() => {
      if (songUrlRequests.get(key) === request) songUrlRequests.delete(key)
    })
  songUrlRequests.set(key, request)
  return joinUrlRequest(request, signal)
}

// 上游播放 URL 有时效(网易 CDN 链约十几分钟过期),只作短期预热,过期即弃
const URL_TTL_MS = 5 * 60 * 1000

interface CachedUrl extends SongUrlResponse {
  url: string
  quality?: string
  level?: string
  trial?: boolean
  expiresAt: number
}

const urlCache = new Map<string, CachedUrl>()
const coverCache = new Map<string, HTMLImageElement>()
const urlPreloads = new Map<string, AbortController>()
const preloadTasks = new Map<string, Promise<void>>()
interface UrlRequest {
  controller: AbortController
  users: number
  promise: Promise<SongUrlResponse>
}
const songUrlRequests = new Map<string, UrlRequest>()
type PreloadOwner = 'player' | 'shuange'
const windows = new Map<PreloadOwner, { urls: Set<string>; covers: Set<string> }>()
// 最近一个批次的保留集:在途请求晚到时若已不在窗口内,直接丢弃不入缓存
let latestKeep = new Set<string>()

export interface TrackPreloadOptions {
  /** 必须与实际渲染请求一致，否则浏览器图片缓存无法命中。 */
  coverPx?: number
  /** 仅支持普通播放和刷歌两个有界窗口 */
  owner?: PreloadOwner
  /** 刷歌由自己的并发队列调度 URL 仅在此登记窗口和封面 */
  deferUrls?: boolean
}

/**
 * 共享 URL 请求 单个消费者取消不影响其他消费者
 *
 * @param request 在途请求
 * @param signal 当前消费者的取消信号
 */
function joinUrlRequest(request: UrlRequest, signal?: AbortSignal): Promise<SongUrlResponse> {
  request.users++
  return new Promise((resolve, reject) => {
    let finished = false
    const release = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', abort)
      request.users--
      return true
    }
    const abort = () => {
      if (!release()) return
      if (!request.users) request.controller.abort()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.promise.then(result => {
      if (release()) resolve(result)
    }, error => {
      if (release()) reject(error)
    })
  })
}

/**
 * 按账号会话和音质区分短期播放地址
 *
 * @param track 目标曲目
 * @param quality 请求音质
 */
function trackKey(track: Track, quality: AudioQuality): string {
  const session = track.source === 'local' ? 0 : providerAccountSession(track.source)
  return `${track.source}:${session}:${String(track.mid ?? track.id ?? '')}:${quality}`
}

/**
 * 音频磁盘缓存 key(server 侧 /api/audio 落盘用):按**实际交付的档位** level 分键,
 * 而非请求档 —— 请求母带但上游降级返回无损时,要缓存在"无损"key 下,否则降级结果
 * 会占住母带 key,后续请求母带永远命中到降级音频。level 缺省(如 QQ 未回传)退回请求档。
 */
export function audioDiskCacheKey(track: Track, level: string): string {
  return `${track.source}:${String(track.mid ?? track.id ?? '')}:${level}`
}

function getFreshHit(track: Track, quality: AudioQuality, now: number): CachedUrl | undefined {
  const key = trackKey(track, quality)
  const hit = urlCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt <= now) {
    urlCache.delete(key)
    return undefined
  }
  return hit
}

/** 取预解析好的播放 URL;过期或未命中返回 undefined(调用方走正常解析)。 */
export function getPreloadedUrl(
  track: Track,
  quality: AudioQuality,
  now = Date.now()
): string | undefined {
  return getFreshHit(track, quality, now)?.url
}

/** 取预解析结果的实际档位标签(与 getPreloadedUrl 同一条缓存)。 */
export function getPreloadedQuality(
  track: Track,
  quality: AudioQuality,
  now = Date.now()
): string | undefined {
  return getFreshHit(track, quality, now)?.quality
}

export interface PreloadedResolution {
  url: string
  quality?: string
  level?: string
  trial?: boolean
}

/** 取完整的预解析结果(url + 实际档位标签/level + 是否试听),供 loadTrack 决定缓存 key 与是否落盘。 */
export function getPreloadedResolution(
  track: Track,
  quality: AudioQuality,
  now = Date.now()
): PreloadedResolution | undefined {
  const hit = getFreshHit(track, quality, now)
  if (!hit) return undefined
  return { url: hit.url, quality: hit.quality, level: hit.level, trial: hit.trial }
}

/** 预加载给定曲目(通常是前/后曲目)的播放 URL 与封面;失败静默,播放时会重试并提示。 */
export function preloadTracks(
  tracks: Track[],
  quality: AudioQuality,
  currentTrack?: Track | null,
  options: TrackPreloadOptions = {}
): void {
  const coverPx = options.coverPx ?? 128
  const windowTracks = currentTrack ? [currentTrack, ...tracks] : tracks
  const keep = new Set<string>()
  const keepCovers = new Set<string>()
  for (const t of windowTracks) {
    keep.add(trackKey(t, quality))
    if (typeof t.cover === 'string' && (typeof window === 'undefined' || window.desktop?.playbackRole !== 'host')) keepCovers.add(sizedImage(t.cover, coverPx))
  }
  // 旧方案 latestKeep = keep 会驱逐另一个消费者的窗口
  windows.set(options.owner ?? 'player', { urls: keep, covers: keepCovers })
  const allUrls = new Set([...windows.values()].flatMap(window => [...window.urls]))
  const allCovers = new Set([...windows.values()].flatMap(window => [...window.covers]))
  latestKeep = allUrls

  // 先清出窗口的旧条目,再发新预取
  for (const k of urlCache.keys()) if (!allUrls.has(k)) urlCache.delete(k)
  for (const [k, controller] of urlPreloads) {
    if (!allUrls.has(k)) {
      controller.abort()
      urlPreloads.delete(k)
    }
  }
  for (const [k, img] of coverCache) {
    if (!allCovers.has(k)) {
      img.onload = null
      img.onerror = null
      img.src = ''
      coverCache.delete(k)
    }
  }

  for (const track of windowTracks) {
    // 占位曲目缺 mid/cover 等详情,等 playAt 补全后的下个批次再预载
    if (track.pending) continue

    const coverUrl = track.cover ? sizedImage(track.cover, coverPx) : ''
    if (coverUrl && keepCovers.has(coverUrl) && !coverCache.has(coverUrl) && typeof Image !== 'undefined') {
      const img = new Image()
      img.decoding = 'async'
      img.src = coverUrl
      coverCache.set(coverUrl, img)
    }
  }

  if (!options.deferUrls) for (const track of tracks) void preloadTrackUrl(track, quality)
}

/**
 * 预取单曲地址供刷歌的两个并发任务使用
 *
 * @param track 目标曲目
 * @param quality 请求音质
 */
export function preloadTrackUrl(track: Track, quality: AudioQuality): Promise<void> {
  if (track.source === 'apple' || track.source === 'local' || track.pending || track.url) return Promise.resolve()
  const key = trackKey(track, quality)
  if (!latestKeep.has(key) || getFreshHit(track, quality, Date.now())) return Promise.resolve()
  const pending = preloadTasks.get(key)
  if (pending && urlPreloads.has(key) && !urlPreloads.get(key)?.signal.aborted) return pending
  const controller = new AbortController()
  urlPreloads.set(key, controller)
  const task = resolveSongUrl(track, quality, controller.signal)
    .then(() => {})
    .catch(() => { /* 播放时由现有路径重试并提示 */ })
    .finally(() => {
      if (urlPreloads.get(key) === controller) urlPreloads.delete(key)
      if (preloadTasks.get(key) === task) preloadTasks.delete(key)
    })
  preloadTasks.set(key, task)
  return task
}

/**
 * 只释放指定使用方的窗口
 *
 * @param owner 普通队列或刷歌
 */
export function releasePreloadWindow(owner: PreloadOwner): void {
  preloadTracks([], 'standard', null, { owner })
  windows.delete(owner)
}

/** 清空全部预加载缓存(测试/切换登录态用)。 */
export function clearPreloadCaches(): void {
  for (const controller of urlPreloads.values()) controller.abort()
  for (const request of songUrlRequests.values()) request.controller.abort()
  for (const img of coverCache.values()) {
    img.onload = null
    img.onerror = null
    img.src = ''
  }
  urlCache.clear()
  coverCache.clear()
  urlPreloads.clear()
  preloadTasks.clear()
  songUrlRequests.clear()
  windows.clear()
  latestKeep = new Set()
}

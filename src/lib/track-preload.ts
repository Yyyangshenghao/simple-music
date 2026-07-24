import { api } from './api'
import type { AudioQuality, Track } from '../types/domain'
import { sizedImage } from './image-size'

/**
 * 相邻曲目预加载:提前解析队列中前/后曲目的播放 URL、预热封面图 HTTP 缓存,
 * 切歌时省掉 URL 解析 RTT(起播延迟的大头)与封面网络等待。
 *
 * 内存纪律:每次 preloadTracks 即一个批次,缓存里不属于本批次(±当前曲目)的
 * 条目立即清除——URL 缓存最多同时保留 3 条字符串,封面最多 3 个 Image 引用。
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
}

/** 解析曲目的可播放上游 URL(按音源拼参数);loadTrack 与预加载共用同一份逻辑。 */
export function resolveSongUrl(
  track: Track,
  quality: AudioQuality,
  signal?: AbortSignal
): Promise<SongUrlResponse> {
  const path = track.source === 'qq' ? '/api/qq/song/url' : '/api/song/url'
  const params =
    track.source === 'qq'
      ? { mid: String(track.mid ?? track.id ?? ''), quality, fee: String(track.fee ?? '') }
      : { id: String(track.id ?? ''), quality }
  return api.get<SongUrlResponse>(path, params, signal ? { signal } : undefined)
}

// 上游播放 URL 有时效(网易 CDN 链约十几分钟过期),只作短期预热,过期即弃
const URL_TTL_MS = 5 * 60 * 1000

interface CachedUrl {
  url: string
  quality?: string
  level?: string
  trial?: boolean
  expiresAt: number
}

const urlCache = new Map<string, CachedUrl>()
const coverCache = new Map<string, HTMLImageElement>()
// 最近一个批次的保留集:在途请求晚到时若已不在窗口内,直接丢弃不入缓存
let latestKeep = new Set<string>()

function trackKey(track: Track, quality: AudioQuality): string {
  return `${track.source}:${String(track.mid ?? track.id ?? '')}:${quality}`
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
  currentTrack?: Track | null
): void {
  const keep = new Set<string>()
  const keepCovers = new Set<string>()
  for (const t of currentTrack ? [currentTrack, ...tracks] : tracks) {
    keep.add(trackKey(t, quality))
    if (typeof t.cover === 'string') keepCovers.add(t.cover)
  }
  latestKeep = keep

  // 先清出窗口的旧条目,再发新预取
  for (const k of urlCache.keys()) if (!keep.has(k)) urlCache.delete(k)
  for (const k of coverCache.keys()) if (!keepCovers.has(k)) coverCache.delete(k)

  for (const track of tracks) {
    // 占位曲目缺 mid/cover 等详情,等 playAt 补全后的下个批次再预载
    if (track.pending) continue

    if (track.cover && !coverCache.has(track.cover) && typeof Image !== 'undefined') {
      const img = new Image()
      img.src = sizedImage(track.cover, 128)
      coverCache.set(track.cover, img)
    }

    if (track.url) continue
    const key = trackKey(track, quality)
    const hit = urlCache.get(key)
    if (hit && hit.expiresAt > Date.now()) continue
    void resolveSongUrl(track, quality)
      .then((res) => {
        if (res.url && latestKeep.has(key)) {
          urlCache.set(key, {
            url: res.url,
            quality: res.quality,
            level: res.level,
            trial: res.trial,
            expiresAt: Date.now() + URL_TTL_MS,
          })
        }
      })
      .catch(() => {
        /* 预加载失败静默 */
      })
  }
}

/** 清空全部预加载缓存(测试/切换登录态用)。 */
export function clearPreloadCaches(): void {
  urlCache.clear()
  coverCache.clear()
  latestKeep = new Set()
}

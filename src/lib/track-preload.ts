import { api } from './api'
import type { AudioQuality, Track } from '../types/domain'

/**
 * 相邻曲目预加载:提前解析队列中前/后曲目的播放 URL、预热封面图 HTTP 缓存,
 * 切歌时省掉 URL 解析 RTT(起播延迟的大头)与封面网络等待。
 *
 * 内存纪律:每次 preloadTracks 即一个批次,缓存里不属于本批次(±当前曲目)的
 * 条目立即清除——URL 缓存最多同时保留 3 条字符串,封面最多 3 个 Image 引用。
 */

export interface SongUrlResponse {
  url?: string
  restriction?: { message: string }
  message?: string
}

/** 解析曲目的可播放上游 URL(按音源拼参数);loadTrack 与预加载共用同一份逻辑。 */
export function resolveSongUrl(track: Track, quality: AudioQuality): Promise<SongUrlResponse> {
  const path = track.source === 'qq' ? '/api/qq/song/url' : '/api/song/url'
  const params =
    track.source === 'qq'
      ? { mid: String(track.mid ?? track.id ?? ''), quality, fee: String(track.fee ?? '') }
      : { id: String(track.id ?? ''), quality }
  return api.get<SongUrlResponse>(path, params)
}

// 上游播放 URL 有时效(网易 CDN 链约十几分钟过期),只作短期预热,过期即弃
const URL_TTL_MS = 5 * 60 * 1000

interface CachedUrl {
  url: string
  expiresAt: number
}

const urlCache = new Map<string, CachedUrl>()
const coverCache = new Map<string, HTMLImageElement>()
// 最近一个批次的保留集:在途请求晚到时若已不在窗口内,直接丢弃不入缓存
let latestKeep = new Set<string>()

function trackKey(track: Track, quality: AudioQuality): string {
  return `${track.source}:${String(track.mid ?? track.id ?? '')}:${quality}`
}

/** 音频磁盘缓存 key(server 侧 /api/audio 落盘用),与预加载 key 同构。 */
export function trackCacheKey(track: Track, quality: AudioQuality): string {
  return trackKey(track, quality)
}

/** 取预解析好的播放 URL;过期或未命中返回 undefined(调用方走正常解析)。 */
export function getPreloadedUrl(
  track: Track,
  quality: AudioQuality,
  now = Date.now()
): string | undefined {
  const key = trackKey(track, quality)
  const hit = urlCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt <= now) {
    urlCache.delete(key)
    return undefined
  }
  return hit.url
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
      img.src = api.url('/proxy/cover', { url: track.cover })
      coverCache.set(track.cover, img)
    }

    if (track.url) continue
    const key = trackKey(track, quality)
    const hit = urlCache.get(key)
    if (hit && hit.expiresAt > Date.now()) continue
    void resolveSongUrl(track, quality)
      .then((res) => {
        if (res.url && latestKeep.has(key)) {
          urlCache.set(key, { url: res.url, expiresAt: Date.now() + URL_TTL_MS })
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

import { api } from './api'
import { providerAccountSession } from './provider-account-session'
import type { Track } from '../types/domain'

/** 单曲真实可得的音质档(服务端逐档探测的结果),按从高到低排序。 */
export interface TrackQualityOption {
  level: string
  label: string
  br?: number
}

/**
 * 查询曲目在其所属音源上实际存在的音质档;本地音乐无档位概念,返回空。
 * 服务端逐档串行探测(最多 8 档),弱网下单次可能超过全局兜底 30s,单独放宽到 60s。
 */
export function fetchTrackQualities(track: Track): Promise<TrackQualityOption[]> {
  if (track.source === 'apple') return Promise.resolve([])
  if (track.source === 'local') return Promise.resolve([])
  const req =
    track.source === 'qq'
      ? api.get<{ qualities?: TrackQualityOption[] }>(
          '/api/qq/song/qualities',
          {
            mid: String(track.mid ?? track.id ?? ''),
            mediaMid: String(track.mediaMid ?? ''),
          },
          { timeoutMs: 60_000 }
        )
      : api.get<{ qualities?: TrackQualityOption[] }>(
          '/api/song/qualities',
          { id: String(track.id ?? '') },
          { timeoutMs: 60_000 }
        )
  return req.then((r) => r.qualities ?? [])
}

/** 最多缓存的曲目数；按最近使用淘汰。 */
const CACHE_LIMIT = 40
// 上游单档失败也可能返回不完整列表，只短暂复用，不因反复打开菜单延长有效期。
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { options: TrackQualityOption[]; expiresAt: number }>()
const inflight = new Map<string, Promise<TrackQualityOption[]>>()

/** 档位随账号（VIP）不同，键里带上账号会话，切换账号后自然失效。 */
function cacheKey(track: Track): string | null {
  if (track.source !== 'netease' && track.source !== 'qq') return null
  const id = track.source === 'qq' ? `${String(track.mid ?? track.id ?? '')}:${String(track.mediaMid ?? '')}` : String(track.id ?? '')
  return `${track.source}:${providerAccountSession(track.source)}:${id}`
}

/** 已探测过的档位；未探测或不支持档位时返回 undefined。 */
export function peekTrackQualities(track: Track): TrackQualityOption[] | undefined {
  const key = cacheKey(track)
  if (!key) return undefined
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.options
}

/** 带缓存的档位探测：同曲并发请求合并，非空结果短暂缓存，空结果及失败可立即重试。 */
export function loadTrackQualities(track: Track): Promise<TrackQualityOption[]> {
  const key = cacheKey(track)
  if (!key) return fetchTrackQualities(track)
  const hit = peekTrackQualities(track)
  if (hit) {
    const entry = cache.get(key)!
    cache.delete(key)
    cache.set(key, entry)
    return Promise.resolve(hit)
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const request = fetchTrackQualities(track)
    .then((list) => {
      if (list.length) {
        cache.set(key, { options: list, expiresAt: Date.now() + CACHE_TTL_MS })
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
      }
      return list
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, request)
  return request
}

/** 测试用：清空缓存。 */
export function clearTrackQualityCache(): void {
  cache.clear()
  inflight.clear()
}

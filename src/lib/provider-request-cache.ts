import type { ProviderId } from '../providers/types'

const DEFAULT_MAX_AGE_MS = 15_000

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()
const generations = new Map<ProviderId, number>()

function requestKey(source: ProviderId, scope: string): string {
  return `${source}:${scope}`
}

/**
 * 首页等只读数据面的短缓存：相同平台/数据面在途请求只发一次，成功结果短暂复用。
 * force 只绕过已完成缓存，仍会加入相同的在途请求，避免连续点重试造成请求风暴。
 */
export function requestProviderData<T>(
  source: ProviderId,
  scope: string,
  loader: () => Promise<T>,
  options: { force?: boolean; maxAgeMs?: number } = {}
): Promise<T> {
  const key = requestKey(source, scope)
  const generation = generations.get(source) ?? 0
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const existing = cache.get(key)
  if (!options.force && existing && existing.expiresAt > Date.now()) {
    return Promise.resolve(existing.value as T)
  }

  const request = loader()
    .then((value) => {
      if ((generations.get(source) ?? 0) === generation) {
        cache.set(key, {
          value,
          expiresAt: Date.now() + (options.maxAgeMs ?? DEFAULT_MAX_AGE_MS),
        })
      }
      return value
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

/** 账号、启用状态变化时清除该平台全部只读缓存；不取消已经在途的上游请求。 */
export function clearProviderRequestCache(source?: ProviderId): void {
  if (!source) {
    cache.clear()
    inflight.clear()
    for (const id of ['netease', 'qq'] as const) {
      generations.set(id, (generations.get(id) ?? 0) + 1)
    }
    return
  }
  generations.set(source, (generations.get(source) ?? 0) + 1)
  const prefix = `${source}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

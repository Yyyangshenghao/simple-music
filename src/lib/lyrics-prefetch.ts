import { resolveLyricsSerial, type LyricsSourceQuery, type OrderedLyricsOptions, type OrderedLyricsResult } from './lyrics-ordered-resolve'
import type { LyricOrigin } from '../types/lyrics-source'

const MAX_ENTRIES = 30
const MAX_AGE_MS = 30 * 60_000

interface CacheEntry {
  context: string
  value: OrderedLyricsResult
  expiresAt: number
}

interface PrefetchJob {
  key: string
  context: string
  controller: AbortController
  queries: Map<LyricOrigin, LyricsSourceQuery>
  adopted: boolean
}

/**
 * 歌词来源的跨曲缓存与下一首串行预取。`context` 由来源顺序、参与平台、补全开关与账号会话组成，
 * 任一变化即视为未命中；只缓存已落定且未因前序来源失败而降级的歌词，失败与未收录留给播放时重新判断。
 */
export function createLyricsPrefetcher(now: () => number = Date.now) {
  const cache = new Map<string, CacheEntry>()
  let job: PrefetchJob | undefined

  const store = (key: string, context: string, value: OrderedLyricsResult) => {
    cache.delete(key)
    cache.set(key, { context, value, expiresAt: now() + MAX_AGE_MS })
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  const cancel = () => {
    if (job && !job.adopted) {
      job.controller.abort()
      for (const query of job.queries.values()) query.controller.abort()
    }
    job = undefined
  }

  return {
    store,
    cancel,
    take(key: string, context: string): OrderedLyricsResult | undefined {
      const entry = cache.get(key)
      if (!entry) return undefined
      if (entry.context !== context || entry.expiresAt <= now()) { cache.delete(key); return undefined }
      cache.delete(key)
      cache.set(key, entry)
      return entry.value
    },
    /** 当前播放接手同曲预取：预取停止发起后续来源，已发出的查询交给调用方，不再随预取取消。 */
    adopt(key: string, context: string): Map<LyricOrigin, LyricsSourceQuery> | undefined {
      if (!job || job.key !== key || job.context !== context) return undefined
      job.adopted = true
      const queries = new Map(job.queries)
      job = undefined
      return queries
    },
    prefetch(key: string, context: string, options: Omit<OrderedLyricsOptions, 'signal'>): void {
      if (job?.key === key && job.context === context) return
      cancel()
      const cached = cache.get(key)
      if (cached?.context === context && cached.expiresAt > now()) return
      const current: PrefetchJob = { key, context, controller: new AbortController(), queries: new Map(), adopted: false }
      job = current
      void resolveLyricsSerial({ ...options, signal: current.controller.signal },
        (origin, query) => current.queries.set(origin, query), () => current.adopted)
        .then(found => { if (found && !found.degraded) store(key, context, found) })
        .catch(() => { /* 预取取消或失败不影响播放。 */ })
        .finally(() => { if (job === current) job = undefined })
    },
    clear() {
      cancel()
      cache.clear()
    },
  }
}

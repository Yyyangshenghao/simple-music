// 榜单数据的渲染层缓存 + 预览预取队列。
// 榜单页一屏放不下 60+ 张卡片,逐张"进视口再拉预览"会让用户一路往下滚一路等;
// 这里把预览请求收进一个全局并发池:卡片挂载即入队(页面一打开就在后台按顺序预取),
// 进视口的卡片插队到队首,保证看得见的那几张最先出。并发上限避免一次性把上游打崩。
// 分组数据(groups)另做短 TTL 缓存:探索页「榜单精选」拉过之后,点进全部榜单页可直接出网格。

import { serviceFor } from './service-registry'
import type { ToplistGroup, ToplistPreviewTrack } from './music-service'
import type { MusicSource } from '../types/domain'

/** 榜单一天更新几次,分组本身(榜名/封面/更新节奏)更稳定,缓存 5 分钟足够。 */
const GROUPS_TTL = 5 * 60 * 1000
/** 与服务端 TOPLIST_PREVIEW_TTL 保持一致。 */
const PREVIEW_TTL = 10 * 60 * 1000
/** 预览条目极小(3 行文本),但仍设上限防长跑无界增长。 */
const PREVIEW_CACHE_MAX = 200
/** 同时在途的预览请求数:太大顶不住上游限流,太小则末尾卡片等太久。 */
const PREVIEW_CONCURRENCY = 4

// ---------- 分组 ----------

const groupsCache = new Map<MusicSource, { at: number; groups: ToplistGroup[] }>()
const groupsInflight = new Map<MusicSource, Promise<ToplistGroup[]>>()

/** 同步取缓存(未命中/已过期返回 null),用于首屏直接渲染而不闪一帧空白。 */
export function getCachedToplistGroups(source: MusicSource): ToplistGroup[] | null {
  const hit = groupsCache.get(source)
  if (!hit || Date.now() - hit.at >= GROUPS_TTL) return null
  return hit.groups
}

export function loadToplistGroups(source: MusicSource): Promise<ToplistGroup[]> {
  const cached = getCachedToplistGroups(source)
  if (cached) return Promise.resolve(cached)
  const existing = groupsInflight.get(source)
  if (existing) return existing
  const service = serviceFor(source)
  if (!service.getToplists) return Promise.resolve([])
  const p = service.getToplists()
    .then((groups) => {
      groupsCache.set(source, { at: Date.now(), groups })
      return groups
    })
    .catch(() => [] as ToplistGroup[])
    .finally(() => { groupsInflight.delete(source) })
  groupsInflight.set(source, p)
  return p
}

// ---------- 预览(并发池) ----------

interface PreviewJob {
  key: string
  source: MusicSource
  id: unknown
  resolve(preview: ToplistPreviewTrack[]): void
}

const previewCache = new Map<string, { at: number; preview: ToplistPreviewTrack[] }>()
const previewInflight = new Map<string, Promise<ToplistPreviewTrack[]>>()
const queue: PreviewJob[] = []
let running = 0

function previewKey(source: MusicSource, id: unknown): string {
  return `${source}:${String(id)}`
}

/** 同步取缓存(未命中/已过期返回 null)。 */
export function getCachedToplistPreview(source: MusicSource, id: unknown): ToplistPreviewTrack[] | null {
  const hit = previewCache.get(previewKey(source, id))
  if (!hit || Date.now() - hit.at >= PREVIEW_TTL) return null
  return hit.preview
}

function pump(): void {
  while (running < PREVIEW_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!
    running += 1
    void runJob(job).finally(() => {
      running -= 1
      pump()
    })
  }
}

async function runJob(job: PreviewJob): Promise<void> {
  // 榜单可能来自另一音源(导航历史/缓存),按数据自身 source 取 service
  const service = serviceFor(job.source)
  try {
    const preview = (await service.getToplistPreview?.(job.id)) ?? []
    if (previewCache.size >= PREVIEW_CACHE_MAX) previewCache.clear()
    previewCache.set(job.key, { at: Date.now(), preview })
    job.resolve(preview)
  } catch {
    // 失败不写缓存,下次请求还能重试(否则一次抖动会把空列表钉死 10 分钟)
    job.resolve([])
  } finally {
    previewInflight.delete(job.key)
  }
}

/**
 * 取某个榜单的 Top3 预览:命中缓存直接返回,否则排队等并发池。
 * `priority: 'high'`(卡片已进视口)会把该任务提到队首。
 */
export function requestToplistPreview(
  source: MusicSource,
  id: unknown,
  opts: { priority?: 'high' } = {}
): Promise<ToplistPreviewTrack[]> {
  const cached = getCachedToplistPreview(source, id)
  if (cached) return Promise.resolve(cached)
  const key = previewKey(source, id)
  const existing = previewInflight.get(key)
  if (existing) {
    if (opts.priority === 'high') {
      const i = queue.findIndex((j) => j.key === key)
      if (i > 0) queue.unshift(queue.splice(i, 1)[0])
    }
    return existing
  }
  if (!serviceFor(source).getToplistPreview) return Promise.resolve([])
  const p = new Promise<ToplistPreviewTrack[]>((resolve) => {
    const job: PreviewJob = { key, source, id, resolve }
    if (opts.priority === 'high') queue.unshift(job)
    else queue.push(job)
  })
  previewInflight.set(key, p)
  pump()
  return p
}

/** 清空全部榜单缓存与待跑队列(测试用;运行时靠 TTL 自然失效)。 */
export function clearToplistCaches(): void {
  groupsCache.clear()
  groupsInflight.clear()
  previewCache.clear()
  previewInflight.clear()
  queue.length = 0
}

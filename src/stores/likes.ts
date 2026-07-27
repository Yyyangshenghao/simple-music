import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import type { Track } from '../types/domain'

/** 红心状态缓存:key 为 `source:id`,乐观更新,服务端失败回滚。 */

/** 缓存条目上限:浏览大量曲目时 likedByKey 只增不减会无界增长,超限按插入顺序
 *  淘汰最旧一批(Object.keys 即插入序)。被淘汰的曲目下次遇到时 ensureChecked 重查,
 *  不影响服务端真实状态。 */
const MAX_LIKED_KEYS = 5000
const TRIM_LIKED_KEYS = 1000

/** ensureChecked 失败后的冷却时长:期间该曲目不重查,避免逐行红心在虚拟列表滚动时
 *  对上游反复发同样的失败请求(上游 500/限流时尤其会刷屏)。冷却到期后重进视口可再试,
 *  给登录恢复 / 上游恢复后补查的机会。 */
const FAIL_COOLDOWN_MS = 60_000
const failedCooldown = new Map<string, number>()

/** 批量合并:ensureChecked 收集视口内曲目,按 source 分组一次性 checkLiked(多 ids),
 *  避免逐行红心对每首网易曲目各发一个请求(列表 50 首就 50 个 HTTP)。
 *  debounce 窗口内收集,到期一次 flush;同一 key 多次 await(滚动重复挂载)共用 resolve。 */
const BATCH_DELAY_MS = 200
interface PendingEntry {
  track: Track
  resolvers: Array<() => void>
}
let pending = new Map<string, PendingEntry>()
let batchTimer: ReturnType<typeof setTimeout> | null = null

function scheduleBatch(): void {
  if (batchTimer) return
  batchTimer = setTimeout(() => {
    batchTimer = null
    void flushBatch()
  }, BATCH_DELAY_MS)
}

/** 取出 pending 一次 flush:已知/冷却中的直接 resolve,其余按 source 分组各发一次 checkLiked。 */
async function flushBatch(): Promise<void> {
  const batch = pending
  pending = new Map()
  const state = useLikesStore.getState()
  const now = Date.now()
  const bySource = new Map<Track['source'], PendingEntry[]>()
  for (const [key, p] of batch) {
    if (key in state.likedByKey || (failedCooldown.get(key) ?? 0) > now) {
      p.resolvers.forEach((r) => r())
      continue
    }
    const arr = bySource.get(p.track.source)
    if (arr) arr.push(p)
    else bySource.set(p.track.source, [p])
  }
  if (!bySource.size) return
  await Promise.all(
    [...bySource.entries()].map(async ([source, items]) => {
      const svc = serviceFor(source)
      if (!svc.checkLiked) {
        items.forEach((p) => p.resolvers.forEach((r) => r()))
        return
      }
      try {
        const res = await svc.checkLiked(items.map((p) => p.track.id))
        useLikesStore.setState((s) => {
          let map = s.likedByKey
          for (const p of items) map = withLike(map, keyOf(p.track), !!res[String(p.track.id)])
          return { likedByKey: map }
        })
        for (const p of items) {
          failedCooldown.delete(keyOf(p.track))
          p.resolvers.forEach((r) => r())
        }
      } catch {
        for (const p of items) {
          failedCooldown.set(keyOf(p.track), now + FAIL_COOLDOWN_MS)
          p.resolvers.forEach((r) => r())
        }
        if (failedCooldown.size > MAX_LIKED_KEYS) {
          for (const [k, e] of failedCooldown) if (e <= now) failedCooldown.delete(k)
        }
      }
    })
  )
}

function keyOf(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

/** 写入一条红心状态,并在超限时淘汰最旧的一批。 */
function withLike(map: Record<string, boolean>, key: string, liked: boolean): Record<string, boolean> {
  const next = { ...map, [key]: liked }
  const keys = Object.keys(next)
  if (keys.length <= MAX_LIKED_KEYS) return next
  const keep = new Set(keys.slice(keys.length - (MAX_LIKED_KEYS - TRIM_LIKED_KEYS)))
  const trimmed: Record<string, boolean> = {}
  for (const k of keys) if (keep.has(k)) trimmed[k] = next[k]
  return trimmed
}

export function likeKeyOf(track: Track): string {
  return keyOf(track)
}

interface LikesStore {
  likedByKey: Record<string, boolean>
  /** 该曲目所属音源是否支持红心。 */
  supports(track: Track | null): boolean
  /** 首次遇到该曲目时查询红心状态(已知则跳过)。 */
  ensureChecked(track: Track): Promise<void>
  toggleLike(track: Track): Promise<void>
}

export const useLikesStore = create<LikesStore>((set, get) => ({
  likedByKey: {},

  supports(track) {
    if (!track) return false
    return typeof serviceFor(track.source).likeTrack === 'function'
  },

  ensureChecked(track) {
    // 批量合并:不立即发请求,收集进 pending,debounce 窗口到期按 source 分组一次 flush。
    // 已知 / 冷却中 / 音源不支持:立即 resolve 不入队。
    const key = keyOf(track)
    return new Promise<void>((resolve) => {
      if (key in get().likedByKey) {
        resolve()
        return
      }
      const now = Date.now()
      if ((failedCooldown.get(key) ?? 0) > now) {
        resolve()
        return
      }
      if (!serviceFor(track.source).checkLiked) {
        resolve()
        return
      }
      const p = pending.get(key)
      if (p) p.resolvers.push(resolve)
      else pending.set(key, { track, resolvers: [resolve] })
      scheduleBatch()
    })
  },

  async toggleLike(track) {
    const svc = serviceFor(track.source)
    if (!svc.likeTrack) return
    const key = keyOf(track)
    const next = !get().likedByKey[key]
    set((s) => ({ likedByKey: withLike(s.likedByKey, key, next) }))
    try {
      if (!(await svc.likeTrack(track, next))) throw new Error('like failed')
    } catch {
      set((s) => ({ likedByKey: withLike(s.likedByKey, key, !next) }))
    }
  }
}))

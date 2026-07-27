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

  async ensureChecked(track) {
    const key = keyOf(track)
    if (key in get().likedByKey) return
    // 冷却中(上次失败未到期)不重查,避免滚动时对上游反复发失败请求
    const now = Date.now()
    const exp = failedCooldown.get(key)
    if (exp && exp > now) return
    const svc = serviceFor(track.source)
    if (!svc.checkLiked) return
    try {
      const res = await svc.checkLiked([track.id])
      const liked = !!res[String(track.id)]
      set((s) => ({ likedByKey: withLike(s.likedByKey, key, liked) }))
      failedCooldown.delete(key)
    } catch {
      /* 未登录/网络失败:记冷却,保持未知(不写 likedByKey),滚动期间不重试 */
      failedCooldown.set(key, now + FAIL_COOLDOWN_MS)
      // 顺手清理过期项,避免 Map 无界增长
      if (failedCooldown.size > MAX_LIKED_KEYS) {
        for (const [k, e] of failedCooldown) if (e <= now) failedCooldown.delete(k)
      }
    }
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

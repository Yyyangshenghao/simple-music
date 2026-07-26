import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import type { Track } from '../types/domain'

/** 红心状态缓存:key 为 `source:id`,乐观更新,服务端失败回滚。 */

/** 缓存条目上限:浏览大量曲目时 likedByKey 只增不减会无界增长,超限按插入顺序
 *  淘汰最旧一批(Object.keys 即插入序)。被淘汰的曲目下次遇到时 ensureChecked 重查,
 *  不影响服务端真实状态。 */
const MAX_LIKED_KEYS = 5000
const TRIM_LIKED_KEYS = 1000

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
    const svc = serviceFor(track.source)
    if (!svc.checkLiked) return
    try {
      const res = await svc.checkLiked([track.id])
      const liked = !!res[String(track.id)]
      set((s) => ({ likedByKey: withLike(s.likedByKey, key, liked) }))
    } catch {
      /* 未登录/网络失败:保持未知,不写缓存 */
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

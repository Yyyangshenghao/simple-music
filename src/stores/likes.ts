import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import type { Track } from '../types/domain'

/** 红心状态缓存:key 为 `source:id`,乐观更新,服务端失败回滚。 */

function keyOf(track: Track): string {
  return `${track.source}:${String(track.id)}`
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
      set((s) => ({ likedByKey: { ...s.likedByKey, [key]: liked } }))
    } catch {
      /* 未登录/网络失败:保持未知,不写缓存 */
    }
  },

  async toggleLike(track) {
    const svc = serviceFor(track.source)
    if (!svc.likeTrack) return
    const key = keyOf(track)
    const next = !get().likedByKey[key]
    set((s) => ({ likedByKey: { ...s.likedByKey, [key]: next } }))
    try {
      if (!(await svc.likeTrack(track, next))) throw new Error('like failed')
    } catch {
      set((s) => ({ likedByKey: { ...s.likedByKey, [key]: !next } }))
    }
  }
}))

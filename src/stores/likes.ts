import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import type { Track } from '../types/domain'
import { isProviderId, PROVIDER_IDS } from '../providers/types'
import { isProviderParticipating, useProviderStore } from './providers'
import { expireProviderAccount } from './provider-auth'
import { providerAccountSession } from '../lib/provider-account-session'

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

function canInteract(track: Track): boolean {
  return !isProviderId(track.source) || isProviderParticipating(track.source)
}
interface PendingEntry {
  track: Track
  accountSession: number
  resolvers: Array<() => void>
}
let pending = new Map<string, PendingEntry>()
let batchTimer: ReturnType<typeof setTimeout> | null = null
// 同曲写入串行，队列结果保存已确认状态，连续失败也能正确回滚。
const writes = new Map<string, Promise<boolean>>()

function sessionOf(track: Track): number {
  return isProviderId(track.source) ? providerAccountSession(track.source) : 0
}

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
    if (p.accountSession !== sessionOf(p.track) || key in state.likedByKey || (failedCooldown.get(key) ?? 0) > now) {
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
      if (isProviderId(source) && !isProviderParticipating(source)) {
        items.forEach((p) => p.resolvers.forEach((r) => r()))
        return
      }
      const svc = serviceFor(source)
      if (!svc.checkLiked) {
        items.forEach((p) => p.resolvers.forEach((r) => r()))
        return
      }
      try {
        const res = await svc.checkLiked(items.map((p) => p.track.id))
        useLikesStore.setState((s) => {
          const updates: Record<string, boolean> = {}
          for (const p of items) {
            const key = keyOf(p.track)
            // 查询期间新写入的乐观状态优先，旧账号的结果直接丢弃。
            if (p.accountSession !== sessionOf(p.track) || key in s.likedByKey) continue
            updates[key] = !!res[String(p.track.id)]
          }
          return Object.keys(updates).length > 0
            ? { likedByKey: trimLikes({ ...s.likedByKey, ...updates }) }
            : s
        })
        for (const p of items) {
          if (p.accountSession === sessionOf(p.track)) failedCooldown.delete(keyOf(p.track))
          p.resolvers.forEach((r) => r())
        }
      } catch (error) {
        if (isProviderId(source) && items[0].accountSession === providerAccountSession(source)) {
          expireProviderAccount(source, error)
        }
        for (const p of items) {
          if (p.accountSession === sessionOf(p.track)) failedCooldown.set(keyOf(p.track), Date.now() + FAIL_COOLDOWN_MS)
          p.resolvers.forEach((r) => r())
        }
        if (failedCooldown.size > MAX_LIKED_KEYS) {
          for (const [k, e] of failedCooldown) if (e <= now) failedCooldown.delete(k)
          while (failedCooldown.size > MAX_LIKED_KEYS) failedCooldown.delete(failedCooldown.keys().next().value!)
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
  return trimLikes({ ...map, [key]: liked })
}

function trimLikes(next: Record<string, boolean>): Record<string, boolean> {
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
  revision: number
  /** 该曲目所属音源是否支持红心。 */
  supports(track: Track | null): boolean
  /** 首次遇到该曲目时查询红心状态(已知则跳过)。 */
  ensureChecked(track: Track): Promise<void>
  toggleLike(track: Track): Promise<void>
}

export const useLikesStore = create<LikesStore>((set, get) => ({
  likedByKey: {},
  revision: 0,

  supports(track) {
    if (!track) return false
    if (!canInteract(track)) return false
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
      if (!canInteract(track)) {
        resolve()
        return
      }
      if (!serviceFor(track.source).checkLiked) {
        resolve()
        return
      }
      const p = pending.get(key)
      if (p) p.resolvers.push(resolve)
      else pending.set(key, { track, accountSession: sessionOf(track), resolvers: [resolve] })
      scheduleBatch()
    })
  },

  async toggleLike(track) {
    if (!canInteract(track)) return
    const svc = serviceFor(track.source)
    if (!svc.likeTrack) return
    const key = keyOf(track)
    const accountSession = sessionOf(track)
    const current = !!get().likedByKey[key]
    const previous = writes.get(key)
    const next = !current
    set((s) => ({ likedByKey: withLike(s.likedByKey, key, next) }))
    const operation: Promise<boolean> = Promise.resolve(previous ?? current).then(async (confirmed) => {
      if (accountSession !== sessionOf(track)) return confirmed
      try {
        if (!(await svc.likeTrack!(track, next))) throw new Error('like failed')
        return next
      } catch (error) {
        if (accountSession === sessionOf(track)) {
          if (writes.get(key) === operation) {
            set((s) => ({ likedByKey: withLike(s.likedByKey, key, confirmed) }))
          }
          if (isProviderId(track.source)) expireProviderAccount(track.source, error)
        }
        return confirmed
      } finally {
        if (writes.get(key) === operation) writes.delete(key)
      }
    })
    writes.set(key, operation)
    await operation
  }
}))

const accountSessions = Object.fromEntries(PROVIDER_IDS.map((source) => [source, providerAccountSession(source)]))
useProviderStore.subscribe(() => {
  for (const source of PROVIDER_IDS) {
    const session = providerAccountSession(source)
    if (session === accountSessions[source]) continue
    accountSessions[source] = session
    const prefix = `${source}:`
    for (const [key, entry] of pending) {
      if (!key.startsWith(prefix)) continue
      pending.delete(key)
      entry.resolvers.forEach((resolve) => resolve())
    }
    for (const key of failedCooldown.keys()) if (key.startsWith(prefix)) failedCooldown.delete(key)
    for (const key of writes.keys()) if (key.startsWith(prefix)) writes.delete(key)
    useLikesStore.setState((state) => ({
      likedByKey: Object.fromEntries(Object.entries(state.likedByKey).filter(([key]) => !key.startsWith(prefix))),
      revision: state.revision + 1,
    }))
  }
})

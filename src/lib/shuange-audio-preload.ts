import type { AudioPreloadRequest } from './audio-engine'
import type { PlaybackEngine } from './playback-core'
import type { AudioQuality, Track } from '../types/domain'
import { fetchOfflineStatuses, offlineFileUrl, offlineTrackKey } from './offline-cache'
import { audioDiskCacheKey, getPreloadedResolution } from './track-preload'
import { buildPlaybackSourceOrder } from './playback-resolver'
import { providerAccountSession } from './provider-account-session'
import { isProviderParticipating, useProviderStore } from '../stores/providers'

export interface ShuangeAudioTarget {
  track: Track
  startAt: number
}

interface Entry extends ShuangeAudioTarget {
  key: string
  resolutionKey: string
  request?: AudioPreloadRequest
  prepared: Promise<void>
  checked: boolean
}

let engine: PlaybackEngine | undefined
let scope = ''
let entries = new Map<string, Entry>()
const controllers = new Map<AbortController, Entry[]>()

/**
 * 区分账号 音质和精彩段位置
 *
 * @param target 相邻曲目及起点
 * @param quality 请求音质
 */
function keyOf(target: ShuangeAudioTarget, quality: AudioQuality): string {
  const { track, startAt } = target
  const account = track.source === 'local' ? 0 : providerAccountSession(track.source)
  return `${track.source}:${account}:${String(track.id)}:${quality}:${startAt}`
}

/** 仅把仍在窗口内的请求交给串行媒体准备队列 */
function publish(): void {
  // 新邻居离线状态未返回前保留旧当前曲实例 防止先清空窗口丢失回看缓冲
  if ([...entries.values()].some(entry => !entry.checked)) return
  engine?.preloadAudio?.([...entries.values()].flatMap(entry => entry.request ? [entry.request] : []))
}

/** 清理刷歌准备窗口 不影响当前播放 */
export function releaseShuangeAudio(): void {
  for (const controller of controllers.keys()) controller.abort()
  controllers.clear()
  entries.clear()
  engine?.releasePreloads?.()
  engine = undefined
  scope = ''
}

/**
 * 准备前后各两首曲目 复用数据缓存并保持现有来源偏好
 *
 * @param nextEngine 宿主内的当前音频引擎
 * @param targets 前后各两首 不包含备用批额外音频
 * @param quality 请求音质
 */
export function prepareShuangeAudio(nextEngine: PlaybackEngine, targets: ShuangeAudioTarget[], quality: AudioQuality): void {
  const preferences = useProviderStore.getState()
  const nextScope = JSON.stringify([quality, preferences.playbackOrder, preferences.preferOriginSource,
    preferences.multiSourceFallback, preferences.playbackOrder.map(source => [source, isProviderParticipating(source), providerAccountSession(source)])])
  if (engine !== nextEngine || scope !== nextScope) releaseShuangeAudio()
  engine = nextEngine
  scope = nextScope
  const next = new Map<string, Entry>()
  const missing: Entry[] = []
  for (const target of targets) {
    if (next.size >= 4) break
    const { track } = target
    if (track.source !== 'netease' && track.source !== 'qq') continue
    const key = keyOf(target, quality)
    const cached = getPreloadedResolution(track, quality)
    const url = track.url ?? cached?.url
    // 等待数据窗口完成地址准备 不在音频预热中另发跨源搜索
    if (!url || next.has(key)) continue
    const resolutionKey = JSON.stringify([url, track.url ? 'direct' : cached?.level ?? track.quality ?? quality, !!cached?.trial])
    const known = entries.get(key)
    const existing = known?.resolutionKey === resolutionKey ? known : undefined
    const entry = existing ?? { ...target, key, resolutionKey, checked: false, prepared: Promise.resolve() }
    next.set(key, entry)
    if (!existing) missing.push(entry)
  }
  entries = next
  for (const [controller, pending] of controllers) {
    if (pending.every(entry => entries.get(entry.key) !== entry)) {
      controller.abort()
      controllers.delete(controller)
    }
  }
  publish()
  if (!missing.length) return
  const controller = new AbortController()
  controllers.set(controller, missing)
  const task = fetchOfflineStatuses(missing.map(entry => entry.track), controller.signal).then(statuses => {
    if (controller.signal.aborted) return
    const byKey = new Map(statuses.map(status => [`${status.source}:${status.id}`, status]))
    for (const entry of missing) {
      if (entries.get(entry.key) !== entry) continue
      const { track, startAt } = entry
      const status = byKey.get(offlineTrackKey(track))
      if (!status) continue
      const localUrl = offlineFileUrl(status, track)
      if (localUrl) { entry.request = { url: localUrl, startAt }; continue }
      const first = buildPlaybackSourceOrder(track, preferences, isProviderParticipating)[0]
      if (first !== track.source) continue
      const cached = getPreloadedResolution(track, quality)
      const url = track.url ?? cached?.url
      if (!url) continue
      const level = cached?.level ?? track.quality ?? quality
      const cacheKey = track.url || cached?.trial ? undefined : audioDiskCacheKey(track, level)
      entry.request = { url, startAt, cacheKey, cacheContext: cacheKey ? {
        originSource: track.source as 'netease' | 'qq', originId: String(track.id),
        resolvedSource: track.source as 'netease' | 'qq', resolvedId: String(track.mid ?? track.id), quality: String(level),
      } : undefined }
    }
  }).catch(() => {}).finally(() => {
    controllers.delete(controller)
    if (controller.signal.aborted) return
    for (const entry of missing) entry.checked = true
    publish()
  })
  for (const entry of missing) entry.prepared = task
}

/**
 * 等待已有相邻准备 最多短暂延续旧曲 不创建额外媒体
 *
 * @param target 待切目标及本次选段起点
 * @param quality 请求音质
 * @param budgetMs 旧曲允许继续的最长毫秒数
 */
export function waitForShuangeAudio(target: ShuangeAudioTarget, quality: AudioQuality, budgetMs: number): Promise<void> | undefined {
  const entry = entries.get(keyOf(target, quality))
  if (!entry || budgetMs <= 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    entry.prepared.then(() => entries.get(entry.key) === entry && entry.request
      ? engine?.waitForPreload?.(entry.request) : false),
    new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs) }),
  ]).then(() => {}).finally(() => { if (timer) clearTimeout(timer) })
}

import type { ProviderId } from '../providers/types'
import type { Track } from '../types/domain'
import type { LyricOrigin, RememberedLyricSource } from '../types/lyrics-source'
import { queryLyricsSource, type LyricsSourceQueryResult } from './lyrics-source-query'

/** 正在进行的单来源查询；预取转交给当前播放时，接手方继续等待而不是重发。 */
export interface LyricsSourceQuery {
  promise: Promise<LyricsSourceQueryResult>
  controller: AbortController
}

export interface OrderedLyricsResult {
  origin: LyricOrigin
  response: LyricsSourceQueryResult
  /** 排在前面的来源有连接失败，结果只是本次降级，不应进入跨曲缓存。 */
  degraded: boolean
}

export interface OrderedLyricsOptions {
  track: Track
  origins: LyricOrigin[]
  sources: ProviderId[]
  signal: AbortSignal
  chosen?: RememberedLyricSource
  onSettled?(origin: LyricOrigin, response: LyricsSourceQueryResult): void
}

/** 当前播放未命中缓存时，超过该时长仍有更高优先级来源未结束，先显示已到达的低优先级歌词。 */
export const LYRICS_PROVISIONAL_MS = 1500

export function isReadyLyrics(response: LyricsSourceQueryResult | undefined): response is LyricsSourceQueryResult & { result: NonNullable<LyricsSourceQueryResult['result']> } {
  return response?.status === 'ready' && !!response.result?.main.length
}

/** 记住的来源排最前，Apple 曲目其次查自带歌词，再按用户顺序；本地歌曲只查本地。 */
export function lyricsOriginOrder(track: Track, order: readonly LyricOrigin[], chosen?: RememberedLyricSource): LyricOrigin[] {
  if (track.source === 'local') return ['local']
  return Array.from(new Set<LyricOrigin>([...(chosen ? [chosen.origin] : []), ...(track.source === 'apple' ? ['apple' as const] : []), ...order]))
}

function cancelled(): DOMException {
  return new DOMException('Cancelled', 'AbortError')
}

function startQuery(options: OrderedLyricsOptions, origin: LyricOrigin): LyricsSourceQuery {
  const controller = new AbortController()
  const { track, sources, chosen } = options
  const promise = queryLyricsSource(track, origin, sources, controller.signal, chosen?.origin === origin ? chosen.match : undefined)
  // 被取消的查询由发起方丢弃；这里只防止未处理拒绝。
  promise.catch(() => {})
  return { promise, controller }
}

function settle(query: LyricsSourceQuery): Promise<LyricsSourceQueryResult | null> {
  return query.promise.catch(() => query.controller.signal.aborted ? null : { status: 'error' as const, message: '暂时连接失败' })
}

/**
 * 预取用：逐个查询，查到即停。`started` 交出每个已发出的查询，`stopped` 为真时不再发起下一项，
 * 供当前播放接手后改为并发。
 */
export async function resolveLyricsSerial(
  options: OrderedLyricsOptions,
  started: (origin: LyricOrigin, query: LyricsSourceQuery) => void = () => {},
  stopped: () => boolean = () => false,
): Promise<OrderedLyricsResult | undefined> {
  let degraded = false
  for (const origin of options.origins) {
    if (options.signal.aborted) throw cancelled()
    if (stopped()) return undefined
    const query = startQuery(options, origin)
    const abort = () => query.controller.abort()
    options.signal.addEventListener('abort', abort, { once: true })
    started(origin, query)
    const response = await settle(query).finally(() => options.signal.removeEventListener('abort', abort))
    if (options.signal.aborted) throw cancelled()
    if (!response) return undefined
    options.onSettled?.(origin, response)
    if (isReadyLyrics(response)) return { origin, response, degraded }
    if (response.status === 'error') degraded = true
  }
  return undefined
}

/**
 * 当前播放用：全部来源同时查询，严格按优先级落定——只有排在前面的来源都已结束（未收录/错配/失败）
 * 才采用后面的结果，最高优先级就绪即取消其余查询。超过 `provisionalMs` 仍未落定时，
 * 第一份到达的歌词经 `onProvisional` 先显示一次，最终结果不同再由调用方替换。
 */
export function resolveLyricsParallel(
  options: OrderedLyricsOptions & {
    existing?: Map<LyricOrigin, LyricsSourceQuery>
    provisionalMs?: number
    onProvisional?(result: OrderedLyricsResult): void
  },
): Promise<OrderedLyricsResult | undefined> {
  const { origins, signal, existing, provisionalMs, onProvisional } = options
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const queries = new Map<LyricOrigin, LyricsSourceQuery>()
    const settled = new Map<LyricOrigin, LyricsSourceQueryResult>()
    let done = false
    let deadlinePassed = provisionalMs === undefined
    let provisional = !onProvisional
    const finish = (value: OrderedLyricsResult | undefined) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', abortAll)
      for (const [origin, query] of queries) if (origin !== value?.origin) query.controller.abort()
      resolve(value)
    }
    const abortAll = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      for (const query of queries.values()) query.controller.abort()
      reject(cancelled())
    }
    const degradedBefore = (origin: LyricOrigin) => origins.slice(0, origins.indexOf(origin)).some(item => settled.get(item)?.status === 'error')
    const showProvisional = () => {
      if (provisional || done) return
      const origin = origins.find(item => isReadyLyrics(settled.get(item)))
      if (!origin) return
      provisional = true
      onProvisional?.({ origin, response: settled.get(origin)!, degraded: true })
    }
    const evaluate = () => {
      for (const origin of origins) {
        const response = settled.get(origin)
        if (!response) {
          if (deadlinePassed) showProvisional()
          return
        }
        if (isReadyLyrics(response)) return finish({ origin, response, degraded: degradedBefore(origin) })
      }
      finish(undefined)
    }
    const timer = provisionalMs !== undefined ? setTimeout(() => { deadlinePassed = true; showProvisional() }, provisionalMs) : undefined
    signal.addEventListener('abort', abortAll, { once: true })
    for (const origin of origins) {
      const query = existing?.get(origin) ?? startQuery(options, origin)
      queries.set(origin, query)
      void settle(query).then(response => {
        if (done || signal.aborted) return
        settled.set(origin, response ?? { status: 'error', message: '暂时连接失败' })
        options.onSettled?.(origin, settled.get(origin)!)
        evaluate()
      })
    }
    if (!origins.length) finish(undefined)
  })
}

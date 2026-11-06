import { providerFor } from '../providers/registry'
import type { ProviderId } from '../providers/types'
import type { Track } from '../types/domain'
import { matchedBilibiliTrack, useBilibiliCoverStore } from '../stores/bilibili-covers'
import { bilibiliCanonicalTrack, bilibiliIdentityKey, bilibiliMatchQueries, selectBilibiliSongMatch } from './bilibili-song-match'
import { bilibiliSongReadings } from './bilibili-title'
import { lyricServiceMode, searchGuestTracks } from './lyric-service'
import { providerAccountSession } from './provider-account-session'
import { TrackMatchMismatchError, type TrackMatchResult } from './track-match'

const CATALOGS = ['netease', 'qq', 'apple', 'qishui'] as const
const MAX_ENTRIES = 200
const MISS_TTL_MS = 5 * 60_000
const HIT_TTL_MS = 30 * 24 * 60 * 60_000

interface Identification { match: TrackMatchResult | null; mismatch: boolean; ambiguous?: boolean }
interface Job {
  controller: AbortController
  promise: Promise<Identification>
  users: number
  settled: boolean
}
const pending = new Map<string, Job>()
const cache = new Map<string, { value: Identification; expiresAt: number }>()
const cancelled = () => new DOMException('Song identification cancelled', 'AbortError')

function context(sources: readonly ProviderId[]): string {
  return JSON.stringify(sources.map(source => [source, lyricServiceMode(source), providerAccountSession(source)]))
}

/** 同一识别由封面和歌词共用；只有最后一个调用者退出时才取消上游。 */
function shared(key: string, work: (signal: AbortSignal) => Promise<Identification>, signal?: AbortSignal, refresh = false): Promise<Identification> {
  if (signal?.aborted) return Promise.reject(cancelled())
  const hit = cache.get(key)
  if (!refresh && hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value)
  let job = pending.get(key)
  if (job?.controller.signal.aborted) job = undefined
  if (!job) {
    const created: Job = { controller: new AbortController(), promise: Promise.resolve({ match: null, mismatch: false }), users: 0, settled: false }
    created.promise = Promise.resolve().then(() => work(created.controller.signal)).then(value => {
      if (created.controller.signal.aborted) throw cancelled()
      cache.delete(key)
      cache.set(key, { value, expiresAt: Date.now() + (value.match ? HIT_TTL_MS : MISS_TTL_MS) })
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
      return value
    }).finally(() => {
      created.settled = true
      if (pending.get(key) === created) pending.delete(key)
    })
    job = created
    pending.set(key, job)
  }
  const active = job
  active.users++
  return new Promise((resolve, reject) => {
    let done = false
    const release = () => {
      if (done) return false
      done = true
      signal?.removeEventListener('abort', abort)
      if (--active.users === 0 && !active.settled) active.controller.abort()
      return true
    }
    const abort = () => { if (release()) reject(cancelled()) }
    signal?.addEventListener('abort', abort, { once: true })
    active.promise.then(value => { if (release()) resolve(value) }, error => { if (release()) reject(error) })
  })
}

async function search(track: Track, source: ProviderId, signal: AbortSignal, current: () => void): Promise<Identification> {
  const mode = lyricServiceMode(source)
  if (!mode) return { match: null, mismatch: false }
  const queries = bilibiliMatchQueries(track)
  const readings = typeof track.bilibiliLyricVersionTitle === 'string' ? [track]
    : bilibiliSongReadings(String(track.videoTitle ?? track.name), track.bilibiliLyricHint)
  const candidates: Track[] = []
  for (const keyword of queries) {
    current()
    const found = mode === 'guest' && (source === 'netease' || source === 'qq')
      ? await searchGuestTracks(source, keyword, signal)
      : await providerFor(source).catalog.searchTracks(keyword)
    current()
    candidates.push(...found.filter(item => item.source === source))
    // 有多种读法时，两种有序组合词共用候选集，不能先搜到哪一边就采用哪一边。
    if (readings.length <= 1) {
      const match = selectBilibiliSongMatch(track, candidates)
      if (match) return { match, mismatch: false }
    }
  }
  const match = selectBilibiliSongMatch(track, candidates)
  return { match, mismatch: candidates.length > 0, ambiguous: !match && candidates.some(candidate => !!selectBilibiliSongMatch(track, [candidate])) }
}

function identify(track: Track, signal?: AbortSignal, refresh = false): Promise<Identification> {
  const session = context(CATALOGS)
  return shared(`identity:${bilibiliIdentityKey(track)}:${session}`, async operation => {
    const current = () => { if (operation.aborted || context(CATALOGS) !== session) throw cancelled() }
    current()
    const saved = !refresh ? matchedBilibiliTrack(track) : undefined
    if (saved && CATALOGS.some(source => source === saved.source && lyricServiceMode(source))) {
      const match = selectBilibiliSongMatch(track, [saved])
      if (match) return { match, mismatch: false }
    }
    let mismatch = false
    let failure: unknown
    const catalogs = CATALOGS.slice(0, 2).some(source => lyricServiceMode(source)) ? CATALOGS.slice(0, 2) : CATALOGS
    for (const source of catalogs) {
      if (!lyricServiceMode(source)) continue
      try {
        const result = await search(track, source, operation, current)
        current()
        if (result.match) {
          useBilibiliCoverStore.getState().rememberIdentity(track, result.match.track)
          return result
        }
        if (result.ambiguous) return result
        mismatch ||= result.mismatch
      } catch (error) {
        current()
        failure = error
      }
    }
    if (failure) throw failure
    return { match: null, mismatch }
  }, signal, refresh)
}

export async function resolveBilibiliSongIdentity(track: Track, signal?: AbortSignal): Promise<TrackMatchResult | null> {
  return (await identify(track, signal)).match
}

/** 先识别一次身份，再按规范身份映射所选歌词平台；同平台直接复用歌曲 ID。 */
export async function findBilibiliLyricMatch(track: Track, source: ProviderId, signal?: AbortSignal, strict = false, refresh = false): Promise<TrackMatchResult | null> {
  const identified: Identification = await identify(track, signal, refresh).catch(error => {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')
      || source === 'netease' || source === 'qq' || !lyricServiceMode(source)) throw error
    return { match: null, mismatch: false }
  })
  if (signal?.aborted) throw cancelled()
  if (!identified.match) {
    // 主曲库未收录时，明确选择的 Apple/汽水仍可自行核验；已有歧义不能靠换库掩盖。
    if (!identified.ambiguous && source !== 'netease' && source !== 'qq' && lyricServiceMode(source)) {
      const session = context(CATALOGS)
      const result = await shared(`target:${bilibiliIdentityKey(track)}:${source}:${session}`, async operation => {
        const current = () => { if (operation.aborted || context(CATALOGS) !== session) throw cancelled() }
        const found = await search(track, source, operation, current)
        current()
        if (found.match) {
          useBilibiliCoverStore.getState().rememberIdentity(track, found.match.track)
          cache.delete(`identity:${bilibiliIdentityKey(track)}:${session}`)
        }
        return found
      }, signal, refresh)
      if (strict && !result.match && (result.mismatch || identified.mismatch)) throw new TrackMatchMismatchError()
      return result.match
    }
    if (strict && identified.mismatch) throw new TrackMatchMismatchError()
    return null
  }
  if (!lyricServiceMode(source)) return null
  if (identified.match.track.source === source) return identified.match
  const canonical = bilibiliCanonicalTrack(track, identified.match.track)
  const session = context([...CATALOGS, source])
  const result = await shared(`mapping:${bilibiliIdentityKey(canonical)}:${source}:${session}`, operation => {
    const current = () => { if (operation.aborted || context([...CATALOGS, source]) !== session) throw cancelled() }
    return search(canonical, source, operation, current)
  }, signal, refresh)
  if (strict && !result.match && result.mismatch) throw new TrackMatchMismatchError()
  return result.match
}

export function clearBilibiliSongIdentityCache(): void {
  for (const job of pending.values()) job.controller.abort()
  pending.clear()
  cache.clear()
}

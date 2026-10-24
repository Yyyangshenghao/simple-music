import type { ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'
import type { LyricCandidateStatus, LyricOrigin } from '../types/lyrics-source'
import { reportLyricsSource, suspendedLyricsSource } from './lyrics-source-health'
import { ProviderAuthError, providerAccountSession } from './provider-account-session'
import {
  emptyLyrics, cachedLyrics, fetchLyrics, fitsLyricDuration, isLyricMatch, LyricMismatchError,
  upgradeLyricsWithAmll, upgradeLyricsWithKugou, type LyricsResult,
} from './lyrics-fetch'
import { findEquivalentTrack, TrackMatchMismatchError } from './track-match'

export interface LyricsSourceQueryResult {
  status: LyricCandidateStatus
  message?: string
  result?: LyricsResult
  match?: Track
}

type Availability = Pick<LyricsSourceQueryResult, 'status' | 'message'>

function providerAvailability(origin: ProviderId, sources: ProviderId[], probe = false): Availability {
  const state = useProviderStore.getState().byId[origin]
  if (origin === 'apple' && state.auth !== 'authenticated') return { status: 'login', message: '登录后可查找' }
  if ((origin === 'apple' && !state.enabled && !probe) || !sources.includes(origin)) return { status: 'disabled', message: '已在设置中关闭' }
  return { status: 'idle' }
}

function matchingSources(sources: ProviderId[], probe = false): Array<'netease' | 'qq'> {
  return [...new Set(sources)].filter((source): source is 'netease' | 'qq' =>
    (source === 'netease' || source === 'qq') && providerAvailability(source, sources, probe).status === 'idle')
}

export function candidateAvailability(track: Track, origin: LyricOrigin, sources: ProviderId[], probe = false): Availability {
  if (track.source === 'local') return origin === 'local'
    ? { status: 'idle' } : { status: 'unavailable', message: '本地歌曲仅使用本地歌词' }
  if (origin === 'local') return { status: 'unavailable', message: '仅本地歌曲可用' }
  if (origin === 'apple' && track.source !== 'apple') return { status: 'unavailable', message: '仅 Apple Music 曲目可用' }
  if (!probe && suspendedLyricsSource(origin)) return { status: 'unavailable', message: '来源连接异常，稍后自动重试；也可在设置中测试恢复' }
  const settings = useSettingsStore.getState()
  if (origin === 'amll') {
    if (!settings.lyricsAmllFallback) return { status: 'disabled', message: '已在设置中关闭' }
    if (!matchingSources(sources, probe).length) return { status: 'unavailable', message: '需启用可匹配的平台' }
  } else if (origin === 'kugou') {
    if (!settings.lyricsKugouFallback) return { status: 'disabled', message: '已在设置中关闭' }
  } else {
    const availability = providerAvailability(origin, sources, probe)
    if (availability.status !== 'idle') return availability
  }
  const needsMatch = origin === 'kugou' || (origin === 'amll'
    ? !matchingSources(sources, probe).includes(track.source as 'netease' | 'qq') : origin !== track.source)
  if (needsMatch && (!Number.isFinite(track.duration) || !(track.duration! > 0))) {
    return { status: 'unavailable', message: '缺少歌曲时长，无法校验匹配版本' }
  }
  return { status: 'idle' }
}

function failureResult(error: unknown): LyricsSourceQueryResult {
  if (error instanceof ProviderAuthError) return { status: 'login', message: '登录后可查找' }
  if (error instanceof LyricMismatchError || error instanceof TrackMatchMismatchError) {
    return { status: 'mismatch', message: '未找到匹配版本' }
  }
  return { status: 'error', message: '暂时连接失败' }
}

/** 只查询指定的歌词库，绝不调用自动补全链或改变正式歌词。 */
async function queryLyricsSourceImpl(
  track: Track,
  origin: LyricOrigin,
  sources: ProviderId[],
  signal?: AbortSignal,
  rememberedMatch?: Track,
  probe = false,
  targetAccess: (status: LyricCandidateStatus) => void = () => {},
): Promise<LyricsSourceQueryResult> {
  const availability = candidateAvailability(track, origin, sources, probe)
  if (availability.status !== 'idle') return availability
  const sessions = new Map(sources.map(source => [source, providerAccountSession(source)]))
  const checkCurrent = () => {
    if (signal?.aborted || [...sessions].some(([source, epoch]) => providerAccountSession(source) !== epoch)) {
      throw new DOMException('Lyrics source query cancelled', 'AbortError')
    }
  }
  const findTarget = async (source: 'netease' | 'qq'): Promise<Track | undefined> => {
    checkCurrent()
    if (track.source === source) return track
    if (!probe && suspendedLyricsSource(source)) return undefined
    if (rememberedMatch?.source === source && isLyricMatch(track, rememberedMatch)) return rememberedMatch
    const match = await findEquivalentTrack(track, source, signal, Date.now(), true, probe)
    checkCurrent()
    if (!match) return undefined
    if (match.track.source !== source || !isLyricMatch(track, match.track)) throw new LyricMismatchError()
    return match.track
  }
  const ready = (result: LyricsResult | null, match?: Track): LyricsSourceQueryResult => {
    checkCurrent()
    const current = candidateAvailability(track, origin, sources, probe)
    if (current.status !== 'idle') return current
    if (origin === 'amll' && match && (match.source === 'netease' || match.source === 'qq')) {
      const mapping = providerAvailability(match.source, sources, probe)
      if (mapping.status !== 'idle') return mapping
    }
    if (!result?.main.length) return { status: 'empty', message: '未找到本曲歌词' }
    // 本曲平台按自身 ID 取到的歌词不存在错配；网易音乐人歌词末尾常带 [99:00] 推广行，不能因此整份丢弃。
    if (origin !== track.source && !fitsLyricDuration(track, result)) return { status: 'mismatch', message: '未找到匹配版本' }
    return { status: 'ready', result, match }
  }
  try {
    checkCurrent()
    if (origin === 'amll') {
      const targets = matchingSources(sources, probe)
      // 本曲平台与已核验的记忆匹配优先；不同映射 ID 不产生重复候选。
      targets.sort((a, b) => Number(b === track.source) - Number(a === track.source)
        || Number(b === rememberedMatch?.source) - Number(a === rememberedMatch?.source))
      let failure: LyricsSourceQueryResult | undefined
      for (const source of targets) {
        try {
          const target = await findTarget(source)
          if (!target) continue
          checkCurrent()
          if (providerAvailability(source, sources, probe).status !== 'idle') continue
          // 可选翻译只读取现有缓存，不能阻塞目标库或把依赖故障归给 AMLL。
          const native = !probe ? cachedLyrics(target) : undefined
          const base = { ...(native ?? emptyLyrics), source, wordLines: [] }
          targetAccess('loading')
          let result: LyricsResult | null
          try {
            result = await upgradeLyricsWithAmll(target, base, signal, true, probe)
          } catch (error) {
            checkCurrent()
            targetAccess(failureResult(error).status)
            throw error
          }
          const candidate = ready(result, target)
          targetAccess(candidate.status)
          if (candidate.status === 'ready') return candidate
          if (candidate.status !== 'empty') failure = candidate
        } catch (error) {
          checkCurrent()
          const candidate = failureResult(error)
          if (!failure || candidate.status === 'error') failure = candidate
        }
      }
      return failure ?? ready(null)
    }
    if (origin === 'kugou') {
      return ready(await upgradeLyricsWithKugou(track, { ...emptyLyrics, source: track.source }, signal, true, probe))
    }
    const target = origin === 'netease' || origin === 'qq' ? await findTarget(origin) : track
    if (!target) return ready(null)
    checkCurrent()
    const current = candidateAvailability(track, origin, sources, probe)
    if (current.status !== 'idle') return current
    return ready(await fetchLyrics(target, [], signal, origin === 'qq', true, probe), target)
  } catch (error) {
    checkCurrent()
    return failureResult(error)
  }
}

/** 每个来源有独立超时与本次运行熔断；用户取消和切换账号不累计故障。 */
export async function queryLyricsSource(
  track: Track, origin: LyricOrigin, sources: ProviderId[], signal?: AbortSignal,
  rememberedMatch?: Track, options: { probe?: boolean } = {}
): Promise<LyricsSourceQueryResult> {
  const available = candidateAvailability(track, origin, sources, options.probe)
  if (available.status !== 'idle') return available
  const controller = new AbortController()
  let timedOut = false
  let targetStatus: LyricCandidateStatus | undefined
  const abort = () => controller.abort()
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  signal?.addEventListener('abort', abort, { once: true })
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
  })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 8000)
  try {
    let result: LyricsSourceQueryResult
    try {
      result = await Promise.race([queryLyricsSourceImpl(track, origin, sources, controller.signal, rememberedMatch, options.probe, status => { targetStatus = status }), cancelled])
    } catch (error) {
      if (!timedOut || signal?.aborted) throw error
      result = { status: 'error', message: '连接超时' }
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (timedOut) result = { status: 'error', message: '连接超时' }
    const healthStatus = origin === 'amll' ? targetStatus === 'loading' ? 'error' : targetStatus : result.status
    if (healthStatus) reportLyricsSource(origin, healthStatus, options.probe)
    return result
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

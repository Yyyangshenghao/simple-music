import type { ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'
import type { LyricCandidateStatus, LyricOrigin } from '../types/lyrics-source'
import { ProviderAuthError, providerAccountSession } from './provider-account-session'
import {
  emptyLyrics, fetchLyrics, findLyricMatch, fitsLyricDuration, isLyricMatch, localLyricSource, LyricMismatchError,
  upgradeLyricsWithAmll, upgradeLyricsWithKugou, type LyricsResult,
} from './lyrics-fetch'
import { lyricServiceMode } from './lyric-service'
import { TrackMatchMismatchError } from './track-match'

export interface LyricsSourceQueryResult {
  status: LyricCandidateStatus
  message?: string
  result?: LyricsResult
  match?: Track
}

type Availability = Pick<LyricsSourceQueryResult, 'status' | 'message'>

/** 平台作为歌词来源是否可用：网易云、QQ 未登录时可按设置以游客身份查询；Apple Music 需要账号。 */
function providerAvailability(origin: ProviderId, sources: ProviderId[]): Availability {
  const mode = lyricServiceMode(origin)
  if (!mode) {
    if (useProviderStore.getState().byId[origin].auth !== 'authenticated') {
      return { status: 'login', message: origin === 'apple' ? '登录后可查找' : '登录或开启游客查询后可查找' }
    }
    return { status: 'disabled', message: '已在设置中关闭' }
  }
  if (!sources.includes(origin)) return { status: 'disabled', message: '已在设置中关闭' }
  return { status: 'idle' }
}

function matchingSources(sources: ProviderId[]): Array<'netease' | 'qq'> {
  return [...new Set(sources)].filter((source): source is 'netease' | 'qq' =>
    (source === 'netease' || source === 'qq') && providerAvailability(source, sources).status === 'idle')
}

export function candidateAvailability(track: Track, origin: LyricOrigin, sources: ProviderId[]): Availability {
  if (track.source === 'local' && origin === 'local') return { status: 'idle' }
  if (origin === 'local') return { status: 'unavailable', message: '仅本地歌曲可用' }
  if (origin === 'apple' && track.source !== 'apple') return { status: 'unavailable', message: '仅 Apple Music 曲目可用' }
  const settings = useSettingsStore.getState()
  if (origin === 'amll') {
    if (!settings.lyricsAmllFallback) return { status: 'disabled', message: '已在设置中关闭' }
    if (!matchingSources(sources).length) return { status: 'unavailable', message: '需启用可匹配的平台' }
  } else if (origin === 'kugou') {
    if (!settings.lyricsKugouFallback) return { status: 'disabled', message: '已在设置中关闭' }
  } else {
    const availability = providerAvailability(origin, sources)
    if (availability.status !== 'idle') return availability
  }
  const needsMatch = origin === 'kugou' || (origin === 'amll'
    ? !matchingSources(sources).includes(track.source as 'netease' | 'qq') : origin !== track.source)
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
export async function queryLyricsSource(
  playing: Track,
  origin: LyricOrigin,
  sources: ProviderId[],
  signal?: AbortSignal,
  rememberedMatch?: Track,
): Promise<LyricsSourceQueryResult> {
  const availability = candidateAvailability(playing, origin, sources)
  if (availability.status !== 'idle') return availability
  let track = playing
  // 本地曲目查在线来源时改用文件标签确认的身份；标签不全不自动套词。只发送曲目元数据。
  if (playing.source === 'local' && origin !== 'local') {
    try {
      const { identity } = await localLyricSource(playing, signal)
      if (signal?.aborted) throw new DOMException('Lyrics source query cancelled', 'AbortError')
      if (!identity) return { status: 'unavailable', message: '本地标签不完整，无法可靠匹配' }
      track = identity
    } catch (error) {
      if (signal?.aborted) throw error
      return { status: 'error', message: '暂时连接失败' }
    }
  }
  const sessions = new Map(sources.map(source => [source, providerAccountSession(source)]))
  const checkCurrent = () => {
    if (signal?.aborted || [...sessions].some(([source, epoch]) => providerAccountSession(source) !== epoch)) {
      throw new DOMException('Lyrics source query cancelled', 'AbortError')
    }
  }
  const findTarget = async (source: 'netease' | 'qq'): Promise<Track | undefined> => {
    checkCurrent()
    if (track.source === source) return track
    if (rememberedMatch?.source === source && isLyricMatch(track, rememberedMatch)) return rememberedMatch
    const match = await findLyricMatch(track, source, signal, true)
    checkCurrent()
    if (!match) return undefined
    if (match.track.source !== source || !isLyricMatch(track, match.track)) throw new LyricMismatchError()
    return match.track
  }
  const ready = (result: LyricsResult | null, match?: Track): LyricsSourceQueryResult => {
    checkCurrent()
    const current = candidateAvailability(track, origin, sources)
    if (current.status !== 'idle') return current
    if (origin === 'amll' && match && (match.source === 'netease' || match.source === 'qq')) {
      const mapping = providerAvailability(match.source, sources)
      if (mapping.status !== 'idle') return mapping
    }
    if (!result?.main.length) return { status: 'empty', message: '未找到本曲歌词' }
    if (!fitsLyricDuration(track, result)) return { status: 'mismatch', message: '未找到匹配版本' }
    return { status: 'ready', result, match }
  }
  try {
    checkCurrent()
    if (origin === 'amll') {
      const targets = matchingSources(sources)
      // 本曲平台与已核验的记忆匹配优先；不同映射 ID 不产生重复候选。
      targets.sort((a, b) => Number(b === track.source) - Number(a === track.source)
        || Number(b === rememberedMatch?.source) - Number(a === rememberedMatch?.source))
      let failure: LyricsSourceQueryResult | undefined
      for (const source of targets) {
        try {
          const target = await findTarget(source)
          if (!target) continue
          checkCurrent()
          if (providerAvailability(source, sources).status !== 'idle') continue
          // 原生已具备逐字时序也允许主动选择 AMLL；辅助层仍使用可靠对齐。
          const native = await fetchLyrics(target, [], signal, source === 'qq')
          checkCurrent()
          if (providerAvailability(source, sources).status !== 'idle') continue
          const base = { ...native, source, wordLines: [] }
          const result = await upgradeLyricsWithAmll(target, base, signal, true)
          const candidate = ready(result, target)
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
      return ready(await upgradeLyricsWithKugou(track, { ...emptyLyrics, source: track.source }, signal, true))
    }
    const target = origin === 'netease' || origin === 'qq' ? await findTarget(origin) : track
    if (!target) return ready(null)
    checkCurrent()
    const current = candidateAvailability(track, origin, sources)
    if (current.status !== 'idle') return current
    return ready(await fetchLyrics(target, [], signal, origin === 'qq', true), target)
  } catch (error) {
    checkCurrent()
    return failureResult(error)
  }
}

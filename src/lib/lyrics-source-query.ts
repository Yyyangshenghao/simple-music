import type { ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'
import { LYRIC_PRIORITY_SOURCES, type LyricCandidateStatus, type LyricOrigin, type LyricPrioritySource, type LyricSearchInput } from '../types/lyrics-source'
import { reportLyricsSource, suspendedLyricsSource } from './lyrics-source-health'
import { ProviderAuthError, providerAccountSession } from './provider-account-session'
import {
  emptyLyrics, cachedLyrics, fetchLyrics, findLyricMatch, fitsLyricDuration, isLyricMatch, localLyricSource, LyricMismatchError,
  appleCatalogId, lyricMatchTargets, upgradeLyricsWithAmll, upgradeLyricsWithKugou, type LyricsResult,
} from './lyrics-fetch'
import { lyricPlatformEnabled, lyricServiceMode } from './lyric-service'
import { TrackMatchMismatchError } from './track-match'
import { accompanimentOriginal } from './karaoke-library'
import { realignCompanionLines } from './lyric-realign'

export interface LyricsSourceQueryResult {
  status: LyricCandidateStatus
  message?: string
  result?: LyricsResult
  match?: Track
}

type Availability = Pick<LyricsSourceQueryResult, 'status' | 'message'>

/** 平台作为歌词来源是否可用：网易云、QQ 未登录时可按设置以游客身份查询；Apple Music 需要已连接且启用的账号。 */
function providerAvailability(origin: ProviderId, sources: ProviderId[], probe = false): Availability {
  if (!lyricPlatformEnabled(origin)) return { status: 'disabled', message: '已在设置中关闭' }
  if (!lyricServiceMode(origin)) {
    if (useProviderStore.getState().byId[origin].auth !== 'authenticated') {
      return { status: 'login', message: '登录后可查找' }
    }
    return { status: 'disabled', message: origin === 'apple' ? 'Apple Music 未启用' : '已在设置中关闭' }
  }
  if (!sources.includes(origin)) return { status: 'disabled', message: '已在设置中关闭' }
  return { status: 'idle' }
}

function matchingSources(sources: ProviderId[], probe = false): Array<'netease' | 'qq'> {
  return [...new Set(sources)].filter((source): source is 'netease' | 'qq' =>
    (source === 'netease' || source === 'qq') && providerAvailability(source, sources, probe).status === 'idle')
}

export function candidateAvailability(track: Track, origin: LyricOrigin, sources: ProviderId[], probe = false, search?: LyricSearchInput): Availability {
  if (search && !LYRIC_PRIORITY_SOURCES.includes(origin as LyricPrioritySource)) return { status: 'unavailable', message: '此来源仅支持按原曲取词' }
  track = accompanimentOriginal(track) ?? track
  if (track.source === 'local' && origin === 'local') return { status: 'idle' }
  if (origin === 'local') return { status: 'unavailable', message: '仅本地歌曲可用' }
  if (!probe && suspendedLyricsSource(origin)) return { status: 'unavailable', message: '来源连接异常，稍后自动重试；也可在设置中测试恢复' }
  const settings = useSettingsStore.getState()
  if (origin === 'amll') {
    if (!settings.lyricsAmllFallback) return { status: 'disabled', message: '已在设置中关闭' }
    // Apple 曲目可直接按自身 ID 查 AMLL 的 Apple 分区，不依赖网易云、QQ。
    if ((search || !appleCatalogId(track)) && !matchingSources(sources, probe).length) return { status: 'unavailable', message: '需启用可匹配的平台' }
  } else if (origin === 'kugou') {
    if (!settings.lyricsKugouFallback) return { status: 'disabled', message: '已在设置中关闭' }
  } else {
    const availability = providerAvailability(origin, sources, probe)
    if (availability.status !== 'idle') return availability
  }
  const needsMatch = !!search || origin === 'kugou' || (origin === 'amll'
    ? !appleCatalogId(track) && !matchingSources(sources, probe).includes(track.source as 'netease' | 'qq') : origin !== track.source)
  if (needsMatch && (!Number.isFinite(track.duration) || !(track.duration! > 0))) {
    return { status: 'unavailable', message: '缺少歌曲时长，无法校验匹配版本' }
  }
  return { status: 'idle' }
}

/**
 * Apple 歌词通常没有中文翻译：网易云、QQ 歌曲改用 Apple 歌词时，按正文从原平台歌词补齐缺少的翻译与音译。
 * 原平台不可用、取词失败或对不上时保留 Apple 歌词原样。
 */
async function withOriginCompanions(track: Track, result: LyricsResult, sources: ProviderId[], signal?: AbortSignal): Promise<LyricsResult> {
  if (track.source !== 'netease' && track.source !== 'qq') return result
  const needTranslation = !result.aligned.some(line => line.text)
  const needRomaji = !result.roma.some(line => line.text)
  if ((!needTranslation && !needRomaji) || providerAvailability(track.source, sources).status !== 'idle') return result
  try {
    // 与原平台候选查询参数一致，共享同一份请求与缓存。
    const own = await fetchLyrics(track, [], signal, track.source === 'qq')
    if (signal?.aborted || !own.main.length) return result
    const aligned = needTranslation ? realignCompanionLines(own.main, result.main, own.aligned) : result.aligned
    const roma = needRomaji ? realignCompanionLines(own.main, result.main, own.roma) : result.roma
    const filled = (lines: typeof aligned) => lines.some(line => line.text)
    return {
      ...result,
      aligned: filled(aligned) ? aligned : result.aligned,
      roma: filled(roma) ? roma : result.roma,
      ...(needTranslation && filled(aligned) ? { translationOrigin: track.source } : {}),
      ...(needRomaji && filled(roma) ? { romajiOrigin: track.source } : {}),
    }
  } catch {
    return result
  }
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
  playing: Track,
  origin: LyricOrigin,
  sources: ProviderId[],
  signal?: AbortSignal,
  rememberedMatch?: Track,
  probe = false,
  targetAccess: (status: LyricCandidateStatus) => void = () => {},
  search?: LyricSearchInput,
): Promise<LyricsSourceQueryResult> {
  const availability = candidateAvailability(playing, origin, sources, probe, search)
  if (availability.status !== 'idle') return availability
  let track = playing
  // 本地曲目查在线来源时改用文件标签确认的身份；标签不全不自动套词。只发送曲目元数据。
  if (search) {
    track = {
      ...playing, lyricSearchVersionTitle: playing.name,
      name: search.name, artist: search.artist, artists: [{ id: null, name: search.artist }],
      ...(playing.source === 'bilibili' ? { bilibiliLyricVersionTitle: String(playing.videoTitle ?? playing.name) } : {}),
      ...(playing.source === 'local' ? { localTagged: true } : {}),
    }
  } else if (playing.source === 'local' && origin !== 'local') {
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
  /** 目标平台上可取词的同曲：本曲或记忆匹配只有一个；搜索匹配时最佳候选在前，其后是后备候选。 */
  const findTargets = async (source: ProviderId): Promise<Track[]> => {
    checkCurrent()
    if (!search && track.source === source) return [track]
    if (!probe && suspendedLyricsSource(source)) return []
    if (rememberedMatch?.source === source && isLyricMatch(track, rememberedMatch)) return [rememberedMatch]
    const match = await findLyricMatch(track, source, signal, true, probe)
    checkCurrent()
    if (!match) return []
    const targets = lyricMatchTargets(track, match, source)
    if (!targets.length) throw new LyricMismatchError()
    // 测试只检验来源本身，不逐个尝试后备候选。
    return probe ? targets.slice(0, 1) : targets
  }
  const ready = (result: LyricsResult | null, match?: Track): LyricsSourceQueryResult => {
    checkCurrent()
    const current = candidateAvailability(playing, origin, sources, probe, search)
    if (current.status !== 'idle') return current
    if (origin === 'amll' && match && (match.source === 'netease' || match.source === 'qq')) {
      const mapping = providerAvailability(match.source, sources, probe)
      if (mapping.status !== 'idle') return mapping
    }
    if (!result?.main.length) return { status: 'empty', message: '未找到本曲歌词' }
    // 本曲平台按自身 ID 取到的歌词不存在错配；网易音乐人歌词末尾常带 [99:00] 推广行，不能因此整份丢弃。
    if ((search || origin !== track.source) && !fitsLyricDuration(track, result)) return { status: 'mismatch', message: '未找到匹配版本' }
    return { status: 'ready', result, match }
  }
  try {
    checkCurrent()
    if (origin === 'amll') {
      const targets: ProviderId[] = [...(!search && appleCatalogId(track) ? ['apple' as const] : []), ...matchingSources(sources, probe)]
      // 本曲平台与已核验的记忆匹配优先；不同映射 ID 不产生重复候选。
      targets.sort((a, b) => Number(b === track.source) - Number(a === track.source)
        || Number(b === rememberedMatch?.source) - Number(a === rememberedMatch?.source))
      let failure: LyricsSourceQueryResult | undefined
      for (const source of targets) {
        try {
          for (const target of await findTargets(source)) {
            checkCurrent()
            // 按 Apple 自身 ID 查 AMLL 不需要 Apple 账号参与歌词来源。
            if (source !== 'apple' && providerAvailability(source, sources, probe).status !== 'idle') break
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
          }
        } catch (error) {
          checkCurrent()
          const candidate = failureResult(error)
          if (!failure || candidate.status === 'error') failure = candidate
        }
      }
      return failure ?? ready(null)
    }
    if (origin === 'kugou') {
      return ready(await upgradeLyricsWithKugou(track, { ...emptyLyrics, source: track.source }, signal, true, probe, !!search))
    }
    const targets = origin === 'netease' || origin === 'qq' || origin === 'apple' ? await findTargets(origin) : [track]
    let outcome = ready(null)
    // 最佳候选没有歌词或时间轴对不上时，依次尝试后备候选。
    for (const target of targets) {
      checkCurrent()
      const current = candidateAvailability(playing, origin, sources, probe, search)
      if (current.status !== 'idle') return current
      const result = await fetchLyrics(target, [], signal, origin === 'qq', true, probe)
      const candidate = ready(result, target)
      if (candidate.status !== 'ready') {
        if (outcome.status === 'empty') outcome = candidate
        continue
      }
      // 测试只检验来源本身是否可用，不额外请求原平台。
      if (origin !== 'apple' || probe || search) return candidate
      const filled = await withOriginCompanions(track, candidate.result!, sources, signal)
      checkCurrent()
      return { ...candidate, result: filled }
    }
    return outcome
  } catch (error) {
    checkCurrent()
    return failureResult(error)
  }
}

/** 每个来源有独立超时与本次运行熔断；用户取消和切换账号不累计故障。 */
export async function queryLyricsSource(
  track: Track, origin: LyricOrigin, sources: ProviderId[], signal?: AbortSignal,
  rememberedMatch?: Track, options: { probe?: boolean; search?: LyricSearchInput } = {}
): Promise<LyricsSourceQueryResult> {
  track = accompanimentOriginal(track) ?? track
  const available = candidateAvailability(track, origin, sources, options.probe, options.search)
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
      result = await Promise.race([queryLyricsSourceImpl(track, origin, sources, controller.signal, rememberedMatch, options.probe, status => { targetStatus = status }, options.search), cancelled])
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

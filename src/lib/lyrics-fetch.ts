import { fetchNativeAppleLyrics } from './apple-lyrics'
import { api } from './api'
import { accompanimentOriginal } from './karaoke-library'
import { localMusicService } from './local-music-service'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { parseLrc, alignTranslation, parseYrc, parseQrc, parseKrc } from './lyric-parser'
import { realignCompanionLines } from './lyric-realign'
import { findEquivalentTrack, scoreTrackMatch, TRACK_MATCH_THRESHOLD } from './track-match'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from './provider-request-cache'
import { providerAccountSession } from './provider-account-session'
import { hasWordTiming } from './word-highlight-timeline'
import { lyricServiceMode, type LyricServiceMode } from './lyric-service'
import type { LyricOrigin } from '../types/lyrics-source'
import type { ProviderId } from '../providers/types'
import { useSettingsStore } from '../stores/settings'
import type { Track, MusicSource, LyricLine as LyricLineType, WordLyricLine as WordLyricLineType } from '../types/domain'

export interface LyricsResult {
  source: MusicSource | null
  /** 补全数据的实际来源；source 仍表示匹配曲目所属平台。 */
  origin?: 'amll' | 'kugou'
  translationOrigin?: LyricOrigin
  romajiOrigin?: LyricOrigin
  main: LyricLineType[]
  aligned: LyricLineType[]
  roma: LyricLineType[]
  wordLines: WordLyricLineType[]
}

interface NeteaseLyricResponse {
  lyric?: string
  tlyric?: string
  romalrc?: string
  yromalrc?: string
  yrc?: string
  error?: string
}

interface QQLyricResponse {
  qrc?: string
  lyric?: string
  tlyric?: string
  roma?: string
  error?: string
}

export class LyricMismatchError extends Error {
  constructor() {
    super('LYRIC_VERSION_MISMATCH')
  }
}

export const emptyLyrics: LyricsResult = { source: null, main: [], aligned: [], roma: [], wordLines: [] }

function hasTimedLyrics(result: LyricsResult): boolean {
  return result.wordLines.some(line => hasWordTiming(line.words))
}

/** 歌词要求同一录音与可靠时长，不能把现场、翻唱或不同 ISRC 的时间轴套进来。 */
export function isLyricMatch(track: Track, target: Track): boolean {
  if (!Number.isFinite(track.duration) || !(track.duration! > 0)
    || !Number.isFinite(target.duration) || !(target.duration! > 0)) return false
  if ((scoreTrackMatch(track, target) ?? 0) < TRACK_MATCH_THRESHOLD) return false
  const originIsrc = String(track.isrc ?? track.ISRC ?? '').trim().toUpperCase()
  const targetIsrc = String(target.isrc ?? target.ISRC ?? '').trim().toUpperCase()
  return !originIsrc || !targetIsrc || originIsrc === targetIsrc
}

/** 按该平台当前的歌词模式找同曲：账号模式沿用播放匹配缓存，游客模式走游客搜索与独立缓存。 */
export function findLyricMatch(track: Track, source: 'netease' | 'qq', signal?: AbortSignal, strict = false, refresh = false) {
  return findEquivalentTrack(track, source, signal, Date.now(), strict, refresh, lyricServiceMode(source) === 'guest' ? 'guest' : 'account')
}

/** 本地曲目：本地歌词与在线匹配身份（标签齐全时才有）。 */
export async function localLyricSource(track: Track, signal?: AbortSignal): Promise<{ lines: LyricLineType[]; identity: Track | null }> {
  if (track.source !== 'local') return { lines: [], identity: null }
  return localMusicService.getLyricSource(track, signal)
}

export function fitsLyricDuration(track: Track, result: LyricsResult): boolean {
  if (!track.duration) return true
  const end = track.duration / 1000 + 3
  return result.main.every(line => line.time <= end) && result.wordLines.every(line =>
    line.time + Math.max(line.durationMs, ...line.words.map(word => word.startMs + (word.durationMs ?? 0))) / 1000 <= end)
}

/**
 * 平台没有逐字时序时，按歌曲 ID 去 AMLL TTML DB 补全（经本地 server 的 /api/amll/lyric）。
 * 不在歌词加载路径上等待：调用方先显示逐行歌词，拿到结果后再整体替换成逐字版本。
 * 只按已知曲目本身的 ID 查询；跨源匹配先拿到对端曲目，再进入本函数。时间轴超出本曲时长
 * 视为错配版本丢弃；默认失败返回 null，严格查询则保留请求与错配原因。
 */
export async function upgradeLyricsWithAmll(track: Track, result: LyricsResult, signal?: AbortSignal, strict = false, refresh = false): Promise<LyricsResult | null> {
  if (hasTimedLyrics(result) || result.source !== track.source || signal?.aborted) return null
  const settings = useSettingsStore.getState()
  if (!settings.lyricsAmllFallback) return null
  const target = track.source === 'netease'
    ? { platform: 'ncm' as const, ids: [String(track.id ?? '')], parse: parseYrc }
    : track.source === 'qq'
      ? { platform: 'qq' as const, ids: [qqLyricIdentifiers(track).mid, qqLyricIdentifiers(track).id].map(id => String(id ?? '')), parse: parseQrc }
      : null
  if (!target) return null
  let failure: unknown
  let mismatch = false
  for (const id of new Set(target.ids.filter(Boolean))) {
    if (signal?.aborted) return null
    try {
      const rec = await api.get<{ text?: string | null }>('/api/amll/lyric', { platform: target.platform, id, ...(refresh ? { refresh: '1' } : {}) }, { signal })
      const wordLines = typeof rec.text === 'string' ? target.parse(rec.text) : []
      if (signal?.aborted) return null
      if (!wordLines.length) continue
      const main = wordLines.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') }))
      // 换成逐字版本后按正文重新对应翻译与音译，兼容分句、行时间变化。
      const realign = (lines: LyricLineType[]) => realignCompanionLines(result.main, main, lines)
      const upgraded: LyricsResult = {
        ...result, origin: 'amll', main, aligned: realign(result.aligned), roma: realign(result.roma), wordLines,
        translationOrigin: result.translationOrigin ?? result.origin ?? result.source ?? undefined,
        romajiOrigin: result.romajiOrigin ?? result.origin ?? result.source ?? undefined,
      }
      if (fitsLyricDuration(track, upgraded)) return upgraded
      mismatch = true
    } catch (error) { failure = error }
  }
  if (strict && mismatch) throw new LyricMismatchError()
  if (strict && failure) throw failure
  return null
}

interface KugouLyricResponse {
  candidates?: { title?: unknown; artist?: unknown; duration?: unknown; text?: unknown }[]
}

/**
 * 最后一道兜底：按歌名、歌手与时长去酷狗歌词库找逐字 KRC（经本地 server 的 /api/kugou/lyric，无需登录）。
 * 酷狗没有可对应的平台 ID，候选以 KRC 自带的歌名（含版本标记）、歌手和时长走同曲校验，
 * 时间轴超出本曲时长同样视为错配；默认失败返回 null，严格查询则保留原因。
 */
export async function upgradeLyricsWithKugou(track: Track, result: LyricsResult, signal?: AbortSignal, strict = false, refresh = false): Promise<LyricsResult | null> {
  // 本地曲目只接受已由标签确认的身份（localLyricSource 的 identity），不按文件名回退的歌名查询。
  if ((track.source === 'local' && track.localTagged !== true) || hasTimedLyrics(result) || signal?.aborted) return null
  if (!useSettingsStore.getState().lyricsKugouFallback) return null
  const title = String(track.name ?? '').trim()
  const duration = Number(track.duration)
  if (!title || !Number.isFinite(duration) || duration <= 0) return null
  const names = (track.artists ?? []).map(artist => artist.name).filter(Boolean)
  const artist = (names.length ? names.join('、') : String(track.artist ?? '')).trim()
  let rec: KugouLyricResponse
  try {
    rec = await api.get<KugouLyricResponse>('/api/kugou/lyric', { title, artist, duration: String(Math.round(duration)), ...(refresh ? { refresh: '1' } : {}) }, { signal })
  } catch (error) {
    if (strict) throw error
    return null
  }
  let mismatch = false
  for (const candidate of Array.isArray(rec.candidates) ? rec.candidates : []) {
    if (signal?.aborted) return null
    if (typeof candidate.text !== 'string' || typeof candidate.title !== 'string') continue
    // 专辑与 ISRC 未知，只按歌名、歌手和时长判定；专辑带版本标记的原曲因此会保守地不匹配。
    const target: Track = {
      ...track, id: 'kugou', name: candidate.title, artist: String(candidate.artist ?? ''), artists: [],
      album: undefined, duration: Number(candidate.duration), isrc: undefined, ISRC: undefined,
    }
    if (!isLyricMatch(track, target)) { mismatch = true; continue }
    const krc = parseKrc(candidate.text)
    if (!krc.wordLines.length) continue
    const main = krc.wordLines.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') }))
    const realign = (lines: LyricLineType[]) => result.main.length ? realignCompanionLines(result.main, main, lines) : []
    const upgraded: LyricsResult = {
      source: result.source ?? track.source,
      origin: 'kugou',
      translationOrigin: krc.translation.length ? 'kugou' : result.translationOrigin ?? result.origin ?? result.source ?? undefined,
      romajiOrigin: krc.roma.length ? 'kugou' : result.romajiOrigin ?? result.origin ?? result.source ?? undefined,
      main,
      aligned: krc.translation.length ? alignTranslation(main, krc.translation) : realign(result.aligned),
      roma: krc.roma.length ? alignTranslation(main, krc.roma) : realign(result.roma),
      wordLines: krc.wordLines,
    }
    if (fitsLyricDuration(track, upgraded)) return upgraded
    mismatch = true
  }
  if (strict && mismatch) throw new LyricMismatchError()
  return null
}

/** 逐行结果先展示，后台按已参与平台查找同曲逐字；始终保留原来的可用逐行版本。 */
export async function upgradeLyrics(track: Track, result: LyricsResult, sources: ProviderId[], signal?: AbortSignal): Promise<LyricsResult | null> {
  if (hasTimedLyrics(result) || signal?.aborted) return null
  if (track.source === 'local') {
    // 本地已有歌词时保留本地版本，不在后台替换；没有本地歌词时只按标签身份在线补全。
    if (result.source === 'local' && result.main.length) return null
    const { identity } = await localLyricSource(track, signal)
    if (!identity || signal?.aborted) return null
    track = identity
  }
  if (track.source === 'qq' && (result.source === 'qq' || !result.main.length)) {
    const native = await fetchLyrics(track, [], signal, true)
    if (signal?.aborted) return null
    if (hasTimedLyrics(native) && fitsLyricDuration(track, native)) return native
  }
  const own = await upgradeLyricsWithAmll(track, result.main.length ? result : { ...result, source: track.source }, signal)
  if (own) return own
  if (!Number.isFinite(track.duration) || !(track.duration! > 0)) return null
  let fallback: LyricsResult | null = null
  for (const source of new Set(sources)) {
    if (signal?.aborted) return null
    if ((source !== 'netease' && source !== 'qq') || source === track.source) continue
    try {
      const match = await findLyricMatch(track, source, signal)
      if (signal?.aborted) return null
      if (!match || match.track.source !== source || !isLyricMatch(track, match.track)) continue
      const candidate = await fetchLyrics(match.track, [], signal, source === 'qq')
      if (signal?.aborted) return null
      if (!fitsLyricDuration(track, candidate)) continue
      if (hasTimedLyrics(candidate)) return candidate
      if (!result.main.length && candidate.main.length) fallback ??= candidate
      const amll = await upgradeLyricsWithAmll(match.track, candidate.main.length ? candidate : { ...candidate, source }, signal)
      if (amll && fitsLyricDuration(track, amll)) return amll
    } catch { /* 一个歌词平台失败不影响已显示的歌词和下一个来源。 */ }
  }
  if (signal?.aborted) return null
  // 酷狗按文字匹配，可靠性低于按平台 ID 或 ISRC 对上的来源，放在最后。
  return await upgradeLyricsWithKugou(track, fallback ?? result, signal) ?? (signal?.aborted ? null : fallback)
}

/** 只读取已完成且未过期的伴随歌词，不发起原生请求。 */
export function cachedLyrics(track: Track): LyricsResult | undefined {
  if (track.source !== 'netease' && track.source !== 'qq') return undefined
  const key = `lyrics:${lyricServiceMode(track.source) ?? 'account'}:${String(track.id)}:${String(track.mid ?? '')}:${String(track.qqId ?? '')}`
  return getCachedProviderData<LyricsResult>(track.source, `${key}:words`)
    ?? getCachedProviderData<LyricsResult>(track.source, key)
}

/**
 * 共享网易与 QQ 的歌词请求及解析结果
 *
 * @param track 目标曲目
 * @param sources Apple 歌词允许匹配的来源
 * @param signal 当前消费者的取消信号
 */
export async function fetchLyrics(track: Track, sources: ProviderId[] = [], signal?: AbortSignal, wordTiming = false, strict = false, refresh = false): Promise<LyricsResult> {
  track = accompanimentOriginal(track) ?? track
  if (signal?.aborted) return emptyLyrics
  if (track.source !== 'netease' && track.source !== 'qq') return loadLyrics(track, sources, signal, wordTiming, strict)
  const source = track.source
  // 未参与播放且游客关闭时沿用旧行为（账号请求），供其他调用方兼容。
  const mode: LyricServiceMode = lyricServiceMode(source) ?? 'account'
  const session = providerAccountSession(source)
  // 游客模式下 QQ 只有逐字接口会返回翻译与音译，直接走逐字请求。
  const words = wordTiming || (mode === 'guest' && source === 'qq')
  if (refresh) return loadLyrics(track, sources, signal, words, strict, mode)
  // 游客与账号结果分开缓存。
  const key = `lyrics:${mode}:${String(track.id)}:${String(track.mid ?? '')}:${String(track.qqId ?? '')}${words ? ':words' : ''}`
  try {
    const result = await requestProviderData(source, key, async () => {
      // 共享请求不绑定单个页面的取消信号 避免切歌中断仍在使用的预热
      const lyrics = await loadLyrics(track, [], undefined, words, true, mode)
      if (!lyrics.main.length) throw new Error('EMPTY_LYRICS')
      return lyrics
    }, { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
    // 账号结果在账号切换后作废；游客结果与账号无关。
    return signal?.aborted || (mode === 'account' && session !== providerAccountSession(source)) ? emptyLyrics : result
  } catch (error) {
    if (strict && !(error instanceof Error && error.message === 'EMPTY_LYRICS')) throw error
    return emptyLyrics
  }
}

/**
 * 按原平台能力请求并解析歌词
 *
 * @param track 目标曲目
 * @param sources Apple 歌词允许匹配的来源
 * @param signal 非共享请求的取消信号
 */
async function loadLyrics(track: Track, sources: ProviderId[], signal?: AbortSignal, wordTiming = false, strict = false, mode: LyricServiceMode = 'account'): Promise<LyricsResult> {
  if (signal?.aborted) return emptyLyrics
  if (track.source === 'apple') {
    const native = await fetchNativeAppleLyrics(track, signal, strict)
    if (signal?.aborted) return emptyLyrics
    if (native) return native
    if (!Number.isFinite(track.duration) || !(track.duration! > 0)) return emptyLyrics
    for (const source of new Set(sources)) {
      if (signal?.aborted) return emptyLyrics
      if (source !== 'netease' && source !== 'qq') continue
      try {
        const match = await findLyricMatch(track, source, signal)
        if (signal?.aborted) return emptyLyrics
        if (!match || match.track.source !== source) continue
        const target = match.track
        // 缓存匹配也重新校验；歌词对录音版本和时间轴比普通标题搜索更敏感。
        if (!isLyricMatch(track, target)) continue
        const result = await fetchLyrics(target, [], signal)
        if (signal?.aborted) return emptyLyrics
        if (result.main.length && fitsLyricDuration(track, result)) return result
      } catch { /* 一个音源失败或无可靠匹配时继续尝试下一音源。 */ }
    }
    return emptyLyrics
  }
  try {
    if (track.source === 'netease') {
      const rec = await api.get<NeteaseLyricResponse>('/api/lyric', { id: String(track.id), ...(mode === 'guest' ? { guest: '1' } : {}) }, { signal })
      if (strict && rec.error) throw new Error(rec.error)
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.romalrc === 'string' ? rec.romalrc : ''
      const yrcText = typeof rec.yrc === 'string' ? rec.yrc : ''
      const wordLines = parseYrc(yrcText)
      const main = wordLines.length
        ? wordLines.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') }))
        : parseLrc(mainText)
      if (!main.length) return emptyLyrics
      const trans = transText ? parseLrc(transText) : []
      const roma = romaText ? parseLrc(romaText) : []
      // YRC 与旧 LRC 的行时间可能不同；优先匹配对应的音译，缺行再用旧音译补位。
      const timedRoma = wordLines.length && typeof rec.yromalrc === 'string' ? parseLrc(rec.yromalrc) : []
      const alignedRoma = roma.length ? alignTranslation(main, roma) : []
      const nativeRoma = timedRoma.length ? alignTranslation(main, timedRoma) : []
      return {
        source: track.source,
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        roma: nativeRoma.length
          ? nativeRoma.map((line, index) => line.text ? line : alignedRoma[index] || line)
          : alignedRoma,
        wordLines,
      }
    }

    if (track.source === 'qq') {
      const { mid, id } = qqLyricIdentifiers(track)
      const rec = await api.get<QQLyricResponse>('/api/qq/lyric', { mid, id, ...(wordTiming ? { words: '1' } : {}), ...(mode === 'guest' ? { guest: '1' } : {}) }, { signal })
      if (strict && rec.error) throw new Error(rec.error)
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.roma === 'string' ? rec.roma : ''
      const wordLines = parseQrc(typeof rec.qrc === 'string' ? rec.qrc : '')
      const main = wordLines.length
        ? wordLines.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') }))
        : parseLrc(mainText)
      if (!main.length) return emptyLyrics
      const companion = (text: string) => {
        const timed = parseQrc(text)
        return timed.length ? timed.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') })) : parseLrc(text)
      }
      const trans = transText ? companion(transText) : []
      const roma = romaText ? companion(romaText) : []
      return {
        source: track.source,
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        roma: roma.length ? alignTranslation(main, roma) : [],
        wordLines,
      }
    }

    // 本地音乐:曲目同目录的同名 .lrc。server 端点与 localMusicService.getLyrics 一直都在,
    // 但这条管线此前只有网易/QQ 两个分支,本地曲目直接落到下面的
    // return emptyLyrics —— 表现为本地音乐永远没有歌词。
    // 本地优先：同名 .lrc 或内嵌同步歌词可用时直接使用；都没有时，只有标签齐全才按标签在线找同录音。
    if (track.source === 'local') {
      const { lines: main, identity } = await localLyricSource(track, signal)
      if (main.length) return { source: track.source, main, aligned: [], roma: [], wordLines: [] }
      if (!identity) return emptyLyrics
      if ((identity.source === 'netease' || identity.source === 'qq') && sources.includes(identity.source)) return fetchLyrics(identity, [], signal, wordTiming, strict)
      for (const source of new Set(sources)) {
        if (signal?.aborted) return emptyLyrics
        if (source !== 'netease' && source !== 'qq') continue
        try {
          const match = await findLyricMatch(identity, source, signal)
          if (signal?.aborted) return emptyLyrics
          if (!match || match.track.source !== source || !isLyricMatch(identity, match.track)) continue
          const result = await fetchLyrics(match.track, [], signal)
          if (signal?.aborted) return emptyLyrics
          if (result.main.length && fitsLyricDuration(identity, result)) return result
        } catch { /* 一个平台失败时继续下一个，本地播放不受影响。 */ }
      }
      return emptyLyrics
    }

    return emptyLyrics
  } catch (error) {
    if (strict) throw error
    return emptyLyrics
  }
}

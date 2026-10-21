import { fetchNativeAppleLyrics } from './apple-lyrics'
import { api } from './api'
import { localMusicService } from './local-music-service'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { parseLrc, alignTranslation, parseYrc, parseQrc } from './lyric-parser'
import { findEquivalentTrack, scoreTrackMatch, TRACK_MATCH_THRESHOLD } from './track-match'
import { BROWSE_CACHE_MAX_AGE_MS, requestProviderData } from './provider-request-cache'
import { providerAccountSession } from './provider-account-session'
import type { ProviderId } from '../providers/types'
import { useSettingsStore } from '../stores/settings'
import type { Track, MusicSource, LyricLine as LyricLineType, WordLyricLine as WordLyricLineType } from '../types/domain'

export interface LyricsResult {
  source: MusicSource | null
  main: LyricLineType[]
  aligned: LyricLineType[]
  roma: LyricLineType[]
  wordLines: WordLyricLineType[]
  /** 逐字时序来自 AMLL TTML DB 兜底时为 'amll' */
  wordSource?: 'amll'
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

export const emptyLyrics: LyricsResult = { source: null, main: [], aligned: [], roma: [], wordLines: [] }

/**
 * 平台没有逐字时序时，按歌曲 ID 去 AMLL TTML DB 补全（经本地 server 的 /api/amll/lyric）。
 * 时间轴超出本曲时长的结果视为错配版本，丢弃；任何失败都静默回落到逐行歌词。
 */
async function amllWordLines(
  platform: 'ncm' | 'qq',
  id: string,
  parse: (text: string) => WordLyricLineType[],
  track: Track,
  signal?: AbortSignal
): Promise<WordLyricLineType[]> {
  if (!id || !useSettingsStore.getState().lyricsAmllFallback) return []
  try {
    const rec = await api.get<{ text?: string | null }>('/api/amll/lyric', { platform, id }, { signal })
    const lines = typeof rec.text === 'string' ? parse(rec.text) : []
    if (track.duration && lines.some(line => line.time > track.duration! / 1000 + 3)) return []
    return lines
  } catch {
    return []
  }
}

/**
 * 共享网易与 QQ 的歌词请求及解析结果
 *
 * @param track 目标曲目
 * @param sources Apple 歌词允许匹配的来源
 * @param signal 当前消费者的取消信号
 */
export async function fetchLyrics(track: Track, sources: ProviderId[] = [], signal?: AbortSignal): Promise<LyricsResult> {
  if (signal?.aborted) return emptyLyrics
  if (track.source !== 'netease' && track.source !== 'qq') return loadLyrics(track, sources, signal)
  const source = track.source
  const session = providerAccountSession(source)
  const key = `lyrics:${String(track.id)}:${String(track.mid ?? '')}:${String(track.qqId ?? '')}`
  try {
    const result = await requestProviderData(source, key, async () => {
      // 共享请求不绑定单个页面的取消信号 避免切歌中断仍在使用的预热
      const lyrics = await loadLyrics(track, [])
      if (!lyrics.main.length) throw new Error('EMPTY_LYRICS')
      return lyrics
    }, { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
    return signal?.aborted || session !== providerAccountSession(source) ? emptyLyrics : result
  } catch {
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
async function loadLyrics(track: Track, sources: ProviderId[], signal?: AbortSignal): Promise<LyricsResult> {
  if (signal?.aborted) return emptyLyrics
  if (track.source === 'apple') {
    const native = await fetchNativeAppleLyrics(track, signal)
    if (signal?.aborted) return emptyLyrics
    if (native) return native
    if (!Number.isFinite(track.duration) || !(track.duration! > 0)) return emptyLyrics
    for (const source of new Set(sources)) {
      if (signal?.aborted) return emptyLyrics
      if (source !== 'netease' && source !== 'qq') continue
      try {
        const match = await findEquivalentTrack(track, source, signal)
        if (signal?.aborted) return emptyLyrics
        if (!match || match.track.source !== source) continue
        const target = match.track
        // 缓存匹配也重新校验；歌词对录音版本和时间轴比普通标题搜索更敏感。
        if (!Number.isFinite(target.duration) || !(target.duration! > 0)) continue
        if ((scoreTrackMatch(track, target) ?? 0) < TRACK_MATCH_THRESHOLD) continue
        const originIsrc = String(track.isrc ?? track.ISRC ?? '').trim().toUpperCase()
        const targetIsrc = String(target.isrc ?? target.ISRC ?? '').trim().toUpperCase()
        if (originIsrc && targetIsrc && originIsrc !== targetIsrc) continue
        const result = await fetchLyrics(target, [], signal)
        if (signal?.aborted) return emptyLyrics
        if (result.main.length && result.main.every(line => line.time <= track.duration! / 1000 + 3)) return result
      } catch { /* 一个音源失败或无可靠匹配时继续尝试下一音源。 */ }
    }
    return emptyLyrics
  }
  try {
    if (track.source === 'netease') {
      const rec = await api.get<NeteaseLyricResponse>('/api/lyric', { id: String(track.id) }, { signal })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.romalrc === 'string' ? rec.romalrc : ''
      const yrcText = typeof rec.yrc === 'string' ? rec.yrc : ''
      let wordLines = parseYrc(yrcText)
      let wordSource: LyricsResult['wordSource']
      if (!wordLines.length) {
        wordLines = await amllWordLines('ncm', String(track.id), parseYrc, track, signal)
        if (wordLines.length) wordSource = 'amll'
      }
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
        wordSource,
      }
    }

    if (track.source === 'qq') {
      const { mid, id } = qqLyricIdentifiers(track)
      const rec = await api.get<QQLyricResponse>('/api/qq/lyric', { mid, id }, { signal })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.roma === 'string' ? rec.roma : ''
      let wordLines = parseQrc(typeof rec.qrc === 'string' ? rec.qrc : '')
      let wordSource: LyricsResult['wordSource']
      if (!wordLines.length && mid) {
        wordLines = await amllWordLines('qq', String(mid), parseQrc, track, signal)
        if (wordLines.length) wordSource = 'amll'
      }
      const main = wordLines.length
        ? wordLines.map(line => ({ time: line.time, text: line.words.map(word => word.text).join('') }))
        : parseLrc(mainText)
      if (!main.length) return emptyLyrics
      const trans = transText ? parseLrc(transText) : []
      // QQ 的 roma 可能是 QRC 等非 LRC 格式,parseLrc 解析不出时间标签时得到空数组,静默降级
      const roma = romaText ? parseLrc(romaText) : []
      return {
        source: track.source,
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        roma: roma.length ? alignTranslation(main, roma) : [],
        wordLines,
        wordSource,
      }
    }

    // 本地音乐:曲目同目录的同名 .lrc。server 端点与 localMusicService.getLyrics 一直都在,
    // 但这条管线此前只有网易/QQ 两个分支,本地曲目直接落到下面的
    // return emptyLyrics —— 表现为本地音乐永远没有歌词。
    if (track.source === 'local') {
      const main = await localMusicService.getLyrics(track, signal)
      if (!main.length) return emptyLyrics
      return { source: track.source, main, aligned: [], roma: [], wordLines: [] }
    }

    return emptyLyrics
  } catch {
    return emptyLyrics
  }
}

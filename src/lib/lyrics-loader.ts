import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useProviderStore } from '../stores/providers'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'
import { providerAccountSession } from './provider-account-session'
import { fetchLyrics, emptyLyrics, upgradeLyricsWithAmll, type LyricsResult } from './lyrics-fetch'
import { estimateWordLines } from './estimated-word-timing'
import { useSettingsStore } from '../stores/settings'
import { lyricPlaybackPosition } from './lyric-playback-position'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import type { Track } from '../types/domain'

function lyricTrackKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

/** 按歌词依赖字段去重：同曲补详情要重取，canplay 仅换对象或 URL 时不清空歌词。 */
function lyricCandidateSignature(currentTrack: Track | null, resolvedTrack: Track | null): string {
  const candidates = [currentTrack, resolvedTrack].filter((track): track is Track => !!track)
    .filter((track, index, all) => all.findIndex(item => lyricTrackKey(item) === lyricTrackKey(track)) === index)
  return JSON.stringify(candidates.map(track => [
    lyricTrackKey(track), !!track.pending,
    ...(track.source === 'apple' ? [
      String(track.catalogId ?? ''), track.appleLibrary === true,
      track.name, track.artist, (track.artists ?? []).map(artist => artist.name),
      track.album, track.duration, String(track.isrc ?? track.ISRC ?? ''),
    ] : track.source === 'qq' ? [qqLyricIdentifiers(track)] : []),
  ]))
}

let stopLyricsLoader: (() => void) | undefined

export function initLyricsLoader(): () => void {
  if (stopLyricsLoader) return stopLyricsLoader
  let disposed = false
  let session = 0
  let controller: AbortController | undefined
  let activeAccounts: Array<{ source: ProviderId; version: number }> = []
  /** 当前显示的原始结果（不含估算逐字），切换「估算逐字」开关时据此重算。 */
  let raw: { key: string; result: LyricsResult } | null = null
  /** 没有逐字时序的歌按字数估算逐字时间，仅用于显示；AMLL 升级判断仍看原始结果。 */
  const withEstimate = (result: LyricsResult): LyricsResult =>
    result.main.length && !result.wordLines.length && useSettingsStore.getState().lyricsEstimateWords
      ? { ...result, wordLines: estimateWordLines(result.main), wordSource: 'estimate' }
      : result
  /** keepOffset：同一首歌换数据（逐字升级、切换估算开关），保留用户已调整的歌词偏移（setLines 会把它归零）。 */
  const apply = (key: string, result: LyricsResult, keepOffset = false) => {
    raw = { key, result }
    const { main, aligned, roma, wordLines, source, wordSource } = withEstimate(result)
    const offsetSec = useLyricsStore.getState().offsetSec
    useLyricsStore.getState().setLines(main, aligned, roma)
    useLyricsStore.getState().setWordLines(wordLines)
    useLyricsStore.setState({ source: main.length ? source : null, wordSource: main.length ? wordSource ?? null : null, loading: false, ...(keepOffset ? { offsetSec } : {}) })
    const player = usePlayerStore.getState()
    useLyricsStore.getState().tick(player.playbackTransport === 'musickit' ? lyricPlaybackPosition(player) : player.position)
  }
  const sync = () => {
    controller?.abort()
    const request = ++session
    activeAccounts = []
    const { currentTrack, resolvedTrack } = usePlayerStore.getState()
    const enabled = !useGameModeStore.getState().enabled || useVisualStore.getState().fx.desktopLyrics
    const key = enabled && currentTrack ? lyricTrackKey(currentTrack) : null
    // 曲目在 URL 解析前切换；先清空并标记归属，避免新歌显示上一首歌词。
    raw = null
    useLyricsStore.setState({ trackKey: key, source: null, wordSource: null, loading: !!key, lines: [], translation: [], romaji: [], wordLines: [], currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })
    if (!key || !currentTrack) return
    controller = new AbortController()
    const signal = controller.signal
    const providers = useProviderStore.getState()
    const participation = (source: typeof PROVIDER_IDS[number]) => providers.byId[source].enabled && providers.byId[source].auth === 'authenticated'
    const lyricSources = providers.playbackOrder.filter(participation)
    const candidates = [currentTrack, resolvedTrack]
      .filter((track): track is Track => !!track && (!isProviderId(track.source) || participation(track.source)))
      .filter((track, index, all) => all.findIndex(item => lyricTrackKey(item) === lyricTrackKey(track)) === index)
    const sources = new Set<ProviderId>()
    for (const track of candidates) {
      if (isProviderId(track.source)) sources.add(track.source)
      if (track.source === 'apple') lyricSources.forEach(source => sources.add(source))
    }
    const accounts = Array.from(sources, source => ({ source, version: providerAccountSession(source) }))
    activeAccounts = accounts
    const current = () => !disposed && request === session && !signal.aborted
    const sameAccounts = () => accounts.every(({ source, version }) => version === providerAccountSession(source))
    void (async () => {
      for (const track of candidates) {
        const result = await fetchLyrics(track, lyricSources, signal)
        if (!current() || !sameAccounts()) return { result: emptyLyrics, track: null }
        if (result.main.length) return { result, track }
      }
      return { result: emptyLyrics, track: null }
    })().catch(() => ({ result: emptyLyrics, track: null })).then(({ result, track }) => {
      if (!current() || useLyricsStore.getState().trackKey !== key) return
      // Cookie 交换失败时可能没有后续账号通知；丢弃旧数据也必须结束当前加载。
      const shown = sameAccounts() ? result : emptyLyrics
      apply(key, shown)
      // 逐行歌词先显示；缺逐字时序时后台去 AMLL 补全，拿到后整体替换。
      // 切歌、换账号或期间歌词已被替换时丢弃结果。
      if (!track || !shown.main.length || shown.wordLines.length) return
      void upgradeLyricsWithAmll(track, shown, signal).then(upgraded => {
        if (!upgraded || !current() || !sameAccounts()) return
        const state = useLyricsStore.getState()
        if (state.trackKey !== key || state.lines !== shown.main) return
        apply(key, upgraded, true)
      })
    })
  }
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack === previous.currentTrack && state.resolvedTrack === previous.resolvedTrack) return
    if (lyricCandidateSignature(state.currentTrack, state.resolvedTrack) !== lyricCandidateSignature(previous.currentTrack, previous.resolvedTrack)) sync()
  })
  const stopProviders = useProviderStore.subscribe((state, previous) => {
    if (state.playbackOrder.length !== previous.playbackOrder.length
      || state.playbackOrder.some((source, index) => source !== previous.playbackOrder[index])
      || PROVIDER_IDS.some(source => state.byId[source].enabled !== previous.byId[source].enabled
        || state.byId[source].auth !== previous.byId[source].auth)
      || activeAccounts.some(({ source, version }) => version !== providerAccountSession(source))) sync()
  })
  const syncEnabled = () => {
    const enabled = !useGameModeStore.getState().enabled || useVisualStore.getState().fx.desktopLyrics
    if (enabled !== wasEnabled) {
      wasEnabled = enabled
      sync()
    }
  }
  let wasEnabled = !useGameModeStore.getState().enabled || useVisualStore.getState().fx.desktopLyrics
  const stopGame = useGameModeStore.subscribe(syncEnabled)
  // 切换「估算逐字」时就地重算当前歌词，不重新请求
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.lyricsEstimateWords === previous.lyricsEstimateWords || !raw) return
    if (useLyricsStore.getState().trackKey === raw.key) apply(raw.key, raw.result, true)
  })
  const stopVisual = useVisualStore.subscribe((state, previous) => {
    if (state.fx.desktopLyrics !== previous.fx.desktopLyrics) syncEnabled()
  })
  sync()
  stopLyricsLoader = () => {
    if (disposed) return
    disposed = true
    controller?.abort()
    stopPlayer()
    stopProviders()
    stopGame()
    stopSettings()
    stopVisual()
    stopLyricsLoader = undefined
  }
  return stopLyricsLoader
}

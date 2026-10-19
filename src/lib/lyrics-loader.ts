import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useProviderStore } from '../stores/providers'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'
import { providerAccountSession } from './provider-account-session'
import { fetchLyrics, emptyLyrics } from './lyrics-fetch'
import { lyricPlaybackPosition } from './lyric-playback-position'
import type { Track } from '../types/domain'

function lyricTrackKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

/** 歌词候选的身份：播放核心在每次 canplay(包括跳转后重新缓冲)都会写入新的 resolvedTrack 对象，
 *  按引用比较会把跳转误判为换歌而清空重载歌词；只有 source:id 变化才需要重新加载。 */
function lyricCandidateKeys(currentTrack: Track | null, resolvedTrack: Track | null): string {
  return Array.from(new Set([currentTrack, resolvedTrack].filter((track): track is Track => !!track).map(lyricTrackKey))).join('|')
}

let stopLyricsLoader: (() => void) | undefined

export function initLyricsLoader(): () => void {
  if (stopLyricsLoader) return stopLyricsLoader
  let disposed = false
  let session = 0
  let controller: AbortController | undefined
  let activeAccounts: Array<{ source: ProviderId; version: number }> = []
  const sync = () => {
    controller?.abort()
    const request = ++session
    activeAccounts = []
    const { currentTrack, resolvedTrack } = usePlayerStore.getState()
    const enabled = !useGameModeStore.getState().enabled || useVisualStore.getState().fx.desktopLyrics
    const key = enabled && currentTrack ? lyricTrackKey(currentTrack) : null
    // 曲目在 URL 解析前切换；先清空并标记归属，避免新歌显示上一首歌词。
    useLyricsStore.setState({ trackKey: key, source: null, loading: !!key, lines: [], translation: [], romaji: [], wordLines: [], currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })
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
        if (!current() || !sameAccounts()) return emptyLyrics
        if (result.main.length) return result
      }
      return emptyLyrics
    })().catch(() => emptyLyrics).then(result => {
      if (!current() || useLyricsStore.getState().trackKey !== key) return
      // Cookie 交换失败时可能没有后续账号通知；丢弃旧数据也必须结束当前加载。
      const { main, aligned, roma, wordLines, source } = sameAccounts() ? result : emptyLyrics
      useLyricsStore.getState().setLines(main, aligned, roma)
      useLyricsStore.getState().setWordLines(wordLines)
      useLyricsStore.setState({ source: main.length ? source : null, loading: false })
      const player = usePlayerStore.getState()
      useLyricsStore.getState().tick(player.playbackTransport === 'musickit' ? lyricPlaybackPosition(player) : player.position)
    })
  }
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (lyricCandidateKeys(state.currentTrack, state.resolvedTrack) !== lyricCandidateKeys(previous.currentTrack, previous.resolvedTrack)) sync()
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
    stopVisual()
    stopLyricsLoader = undefined
  }
  return stopLyricsLoader
}

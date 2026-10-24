import { usePlayerStore } from '../stores/player'
import { indexForPosition, useLyricsStore } from '../stores/lyrics'
import { bindLyricsSourceActions, rememberLyricsSource, useLyricsSourceStore } from '../stores/lyrics-source'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'
import { providerAccountSession } from './provider-account-session'
import { fetchLyrics, emptyLyrics, upgradeLyrics, type LyricsResult } from './lyrics-fetch'
import { candidateAvailability, queryLyricsSource, type LyricsSourceQueryResult } from './lyrics-source-query'
import { createLyricsSourceProbe } from './lyrics-source-probe'
import { lyricPlaybackPosition } from './lyric-playback-position'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { hasWordTiming } from './word-highlight-timeline'
import { LYRIC_SOURCE_LABELS, type LyricOrigin, type LyricSourceCandidate, type RememberedLyricSource } from '../types/lyrics-source'
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
    ...(track.source !== 'local' ? [
      String(track.catalogId ?? ''), track.appleLibrary === true,
      track.name, track.artist, (track.artists ?? []).map(artist => artist.name),
      track.album, track.duration, String(track.isrc ?? track.ISRC ?? ''),
    ] : []),
    ...(track.source === 'qq' ? [qqLyricIdentifiers(track)] : []),
  ]))
}

function participatingSources(): ProviderId[] {
  const providers = useProviderStore.getState()
  return Array.from(new Set([...providers.playbackOrder, ...PROVIDER_IDS])).filter(source => source !== 'apple' || (providers.byId[source].enabled && providers.byId[source].auth === 'authenticated'))
}

function sourceRows(track: Track): LyricOrigin[] {
  if (track.source === 'local') return ['local']
  return Array.from(new Set<LyricOrigin>([track.source, 'netease', 'qq', 'amll', 'kugou']))
}

interface SelectionSession {
  key: string
  token: string
  controller: AbortController
  jobs: Array<() => Promise<void>>
  pending: Set<LyricOrigin>
  active: number
  application?: AbortController
}

let stopLyricsLoader: (() => void) | undefined

export function initLyricsLoader(): () => void {
  if (stopLyricsLoader) return stopLyricsLoader
  let disposed = false
  let session = 0
  let choiceVersion = 0
  let controller: AbortController | undefined
  let activeAccounts: Array<{ source: ProviderId; version: number }> = []
  let currentKey: string | null = null
  let activePreference = useLyricsSourceStore.getState().defaultSource
  let activeSourceOrder = useLyricsSourceStore.getState().sourceOrder
  const sourceProbe = createLyricsSourceProbe()
  let onceChoice: RememberedLyricSource | undefined
  let selection: SelectionSession | undefined
  // 只缓存本曲的来源结果，最多原平台、网易、QQ、AMLL、酷狗五份；切歌或账号/参与状态变化即清空。
  const results = new Map<LyricOrigin, LyricsSourceQueryResult>()

  const lyricsEnabled = () => !useGameModeStore.getState().enabled || useVisualStore.getState().fx.desktopLyrics
  const currentTrack = () => usePlayerStore.getState().currentTrack
  const sameAccounts = (accounts: typeof activeAccounts) => accounts.every(({ source, version }) => version === providerAccountSession(source))
  const captureAccounts = () => PROVIDER_IDS.map(source => ({ source, version: providerAccountSession(source) }))
  const originOf = (result: LyricsResult): LyricOrigin | null => result.main.length ? result.origin ?? result.source : null

  const preview = (origin: LyricOrigin, response: LyricsSourceQueryResult): LyricSourceCandidate => {
    const result = response.result
    const player = usePlayerStore.getState()
    const position = player.playbackTransport === 'musickit' ? lyricPlaybackPosition(player) : player.position
    const index = result ? Math.max(0, indexForPosition(result.main, position)) : 0
    return {
      origin, status: response.status, message: response.message,
      preview: result?.main.slice(index, index + 3).map((line, offset) => ({
        ...line, translation: result.aligned[index + offset]?.text || undefined, romaji: result.roma[index + offset]?.text || undefined,
      })) ?? [],
      wordTimed: result?.wordLines.some(line => hasWordTiming(line.words)) ?? false,
      hasTranslation: result?.aligned.some(line => !!line.text) ?? false,
      hasRomaji: result?.roma.some(line => !!line.text) ?? false,
      matchedName: response.match?.name, matchedArtist: response.match?.artist,
      translationOrigin: result?.translationOrigin ?? result?.source ?? undefined,
      romajiOrigin: result?.romajiOrigin ?? result?.source ?? undefined,
    }
  }
  const updateCandidate = (dialog: SelectionSession, origin: LyricOrigin, response: LyricsSourceQueryResult) => {
    if (selection !== dialog || dialog.controller.signal.aborted) return
    useLyricsSourceStore.setState(state => ({ candidates: state.candidates.map(row => row.origin === origin ? preview(origin, response) : row) }))
  }
  const apply = (result: LyricsResult, keepOffset = false, match?: Track, upgraded = keepOffset) => {
    const { main, aligned, roma, wordLines, source } = result
    const offsetSec = keepOffset ? useLyricsStore.getState().offsetSec : 0
    // 正文、逐字与辅助行一并提交，避免任一视图短暂显示旧翻译或旧时间轴。
    useLyricsStore.setState({ lines: main, translation: aligned, romaji: roma, wordLines, source: main.length ? source : null,
      loading: false, currentIndex: -1, currentCharProgress: 0, offsetSec })
    const actual = originOf(result)
    useLyricsSourceStore.setState({ appliedOrigin: actual })
    if (actual) {
      const response: LyricsSourceQueryResult = { status: 'ready', result, match }
      results.set(actual, response)
      if (selection) updateCandidate(selection, actual, response)
      console.info('[lyrics] 歌词来源', {
        trackKey: currentKey, name: currentTrack()?.name, source: actual, matchedSource: source, upgraded,
      })
    }
    const player = usePlayerStore.getState()
    useLyricsStore.getState().tick(player.playbackTransport === 'musickit' ? lyricPlaybackPosition(player) : player.position)
  }
  const cancelDialog = () => {
    selection?.controller.abort()
    selection?.application?.abort()
    selection = undefined
    useLyricsSourceStore.setState({ candidateTrackKey: null, candidateToken: null, candidates: [] })
  }
  const requireDialog = (key: string, token: string) => {
    const track = currentTrack()
    if (disposed || !lyricsEnabled() || !track || lyricTrackKey(track) !== key || !selection
      || selection.key !== key || selection.token !== token || selection.controller.signal.aborted) throw new Error('歌曲或歌词选择已改变，请重新打开')
    return { track, dialog: selection }
  }
  const pump = (dialog: SelectionSession) => {
    while (dialog.active < 2 && dialog.jobs.length && selection === dialog && !dialog.controller.signal.aborted) {
      const job = dialog.jobs.shift()!
      dialog.active++
      void job().finally(() => { dialog.active--; pump(dialog) })
    }
  }
  const queryCandidates = async (key: string, token: string, requested?: LyricOrigin) => {
    const track = currentTrack()
    if (disposed || !lyricsEnabled() || !track || lyricTrackKey(track) !== key) throw new Error('当前歌曲已改变')
    if (!selection || selection.token !== token || selection.key !== key) {
      cancelDialog()
      selection = { key, token, controller: new AbortController(), jobs: [], pending: new Set(), active: 0 }
      useLyricsSourceStore.setState({ candidateTrackKey: key, candidateToken: token, candidates: sourceRows(track).map(origin => preview(origin, {
        ...candidateAvailability(track, origin, participatingSources()),
      })) })
    }
    const dialog = selection
    const origins = sourceRows(track)
    if (requested && !origins.includes(requested)) throw new Error('此歌曲不支持该歌词来源')
    for (const origin of requested ? [requested] : origins) {
      const available = candidateAvailability(track, origin, participatingSources())
      if (available.status !== 'idle' && available.status !== 'ready') { updateCandidate(dialog, origin, available); continue }
      const cached = results.get(origin)
      if (cached?.status === 'ready') { updateCandidate(dialog, origin, cached); continue }
      if (dialog.pending.has(origin)) continue
      dialog.pending.add(origin)
      updateCandidate(dialog, origin, { status: 'loading' })
      const accounts = captureAccounts()
      dialog.jobs.push(async () => {
        try {
          const response = await queryLyricsSource(track, origin, participatingSources(), dialog.controller.signal, useLyricsSourceStore.getState().remembered[key]?.match)
          if (selection !== dialog || dialog.controller.signal.aborted || !sameAccounts(accounts)) return
          if (response.status === 'ready') results.set(origin, response)
          updateCandidate(dialog, origin, response)
        } catch {
          if (!dialog.controller.signal.aborted) updateCandidate(dialog, origin, { status: 'error', message: '暂时连接失败，请重试' })
        } finally { dialog.pending.delete(origin) }
      })
    }
    // IPC 只确认受理；结果经小型候选快照逐项发布，避免慢来源占用命令回执。
    pump(dialog)
  }

  const selectOrdered = async (track: Track, sources: ProviderId[], signal: AbortSignal, order: NonNullable<typeof activeSourceOrder>, chosen?: RememberedLyricSource) => {
    const origins: LyricOrigin[] = track.source === 'local' ? ['local']
      : Array.from(new Set<LyricOrigin>([...(chosen ? [chosen.origin] : []), ...(track.source === 'apple' ? ['apple' as const] : []), ...order]))
    for (const origin of origins) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      const response = await queryLyricsSource(track, origin, sources, signal, chosen?.origin === origin ? chosen.match : undefined)
      if (response.status === 'ready' && response.result?.main.length) {
        results.set(origin, response)
        return response
      }
      if (chosen?.origin === origin) useLyricsSourceStore.setState({ fallbackReason: `已记住${LYRIC_SOURCE_LABELS[origin]}，${response.message ?? '本次暂不可用'}；本次临时使用其他来源` })
    }
    return undefined
  }

  const sync = () => {
    controller?.abort()
    const previousDialog = selection && { key: selection.key, token: selection.token }
    cancelDialog()
    results.clear()
    const request = ++session
    const decision = choiceVersion
    activeAccounts = []
    const { currentTrack: track, resolvedTrack } = usePlayerStore.getState()
    const identity = track ? lyricTrackKey(track) : null
    if (identity !== currentKey) {
      onceChoice = undefined
      activePreference = useLyricsSourceStore.getState().defaultSource
      activeSourceOrder = useLyricsSourceStore.getState().sourceOrder
    }
    currentKey = identity
    const key = lyricsEnabled() ? identity : null
    const preferences = { ...useLyricsSourceStore.getState(), defaultSource: activePreference, sourceOrder: activeSourceOrder }
    const remembered = identity ? preferences.remembered[identity] : undefined
    // 清除全部记忆不改变本次选择；同曲补详情或窗口重建也不重新解释它。
    if (!onceChoice && remembered) onceChoice = remembered
    const chosen = onceChoice ?? remembered
    useLyricsSourceStore.setState({ appliedOrigin: null, requestedOrigin: chosen?.origin ?? 'auto', fallbackReason: null, appliedPreference: preferences.defaultSource })
    useLyricsStore.setState({ trackKey: key, source: null, loading: !!key, lines: [], translation: [], romaji: [], wordLines: [], currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })
    if (!key || !track) return
    controller = new AbortController()
    const signal = controller.signal
    const lyricSources = track.source === 'local' ? [] : participatingSources()
    const candidates = [track, resolvedTrack]
      .filter((item): item is Track => !!item && (!isProviderId(item.source) || lyricSources.includes(item.source)))
      .filter((item, index, all) => all.findIndex(other => lyricTrackKey(other) === lyricTrackKey(item)) === index)
    const sources = new Set<ProviderId>()
    for (const candidate of candidates) {
      if (isProviderId(candidate.source)) sources.add(candidate.source)
      if (candidate.source !== 'local') lyricSources.forEach(source => sources.add(source))
    }
    // 手选补全与面板查询也受参与账号的会话变化约束。
    if (chosen || preferences.defaultSource !== 'auto' || previousDialog) lyricSources.forEach(source => sources.add(source))
    const accounts = Array.from(sources, source => ({ source, version: providerAccountSession(source) }))
    activeAccounts = accounts
    const current = () => !disposed && request === session && decision === choiceVersion && !signal.aborted
    if (previousDialog?.key === key) void queryCandidates(key, previousDialog.token).catch(() => {})
    void (async () => {
      if (preferences.sourceOrder) {
        const response = await selectOrdered(track, lyricSources, signal, preferences.sourceOrder, chosen)
        if (!current() || !sameAccounts(accounts)) return { result: emptyLyrics, track: null, locked: true }
        return { result: response?.result ?? emptyLyrics, track: response?.match ?? track, locked: true }
      }
      const globalOrigin = preferences.defaultSource === 'auto' ? null : preferences.defaultSource === 'origin' ? track.source : preferences.defaultSource
      const preferred = Array.from(new Set([chosen?.origin, globalOrigin].filter((origin): origin is LyricOrigin => !!origin)))
      for (const origin of preferred) {
        const response = await queryLyricsSource(track, origin, lyricSources, signal, chosen?.origin === origin ? chosen.match : undefined)
        if (!current() || !sameAccounts(accounts)) return { result: emptyLyrics, track: null, locked: false }
        if (response.status === 'ready' && response.result?.main.length) {
          results.set(origin, response)
          return { result: response.result, track: response.match ?? track, locked: true }
        }
        if (chosen?.origin === origin) useLyricsSourceStore.setState({ fallbackReason: `已记住${LYRIC_SOURCE_LABELS[origin]}，${response.message ?? '本次暂不可用'}；本次临时使用其他来源` })
      }
      for (const candidate of candidates) {
        const result = await fetchLyrics(candidate, lyricSources, signal)
        if (!current() || !sameAccounts(accounts)) return { result: emptyLyrics, track: null, locked: false }
        if (result.main.length) return { result, track: candidate, locked: false }
      }
      return { result: emptyLyrics, track: null, locked: false }
    })().catch(() => ({ result: emptyLyrics, track: null, locked: false })).then(({ result, track: fetchedTrack, locked }) => {
      if (!current() || useLyricsStore.getState().trackKey !== key) return
      const shown = sameAccounts(accounts) ? result : emptyLyrics
      apply(shown, false, fetchedTrack ?? undefined)
      const upgradeTrack = fetchedTrack ?? candidates[0]
      if (locked || !upgradeTrack || !sameAccounts(accounts)) return
      void upgradeLyrics(upgradeTrack, shown, lyricSources, signal).then(upgraded => {
        if (!upgraded || !current() || !sameAccounts(accounts)) return
        const state = useLyricsStore.getState()
        if (state.trackKey !== key || state.lines !== shown.main) return
        apply(upgraded, true, upgradeTrack)
      }).catch(() => { /* 后台补全失败保留当前歌词。 */ })
    })
  }

  const unbind = bindLyricsSourceActions({
    async testSource(origin, sample) {
      // 测试结果通过快照发布；不让慢来源占用播放命令回执。
      void sourceProbe.test(origin, sample).catch(() => {})
    },
    queryCandidates,
    cancelSelection(token) { if (selection?.token === token) cancelDialog() },
    async chooseSource(key, token, origin, remember) {
      const { track, dialog } = requireDialog(key, token)
      dialog.application?.abort()
      const application = new AbortController()
      dialog.application = application
      const accounts = captureAccounts()
      const current = () => !application.signal.aborted && selection === dialog && !dialog.controller.signal.aborted
        && sameAccounts(accounts) && currentTrack() && lyricTrackKey(currentTrack()!) === key
      if (origin === 'auto') {
        const preference = useLyricsSourceStore.getState().defaultSource
        const sources = participatingSources()
        const preferred = preference === 'auto' ? null : preference === 'origin' ? track.source : preference
        let response: LyricsSourceQueryResult | undefined
        let upgradeTrack = track
        let allowUpgrade = true
        const order = useLyricsSourceStore.getState().sourceOrder
        if (order) {
          response = await selectOrdered(track, sources, application.signal, order)
          if (!current()) throw new Error('歌词选择已取消')
          if (response?.match) upgradeTrack = response.match
          allowUpgrade = false
        } else if (preferred) {
          response = results.get(preferred) ?? await queryLyricsSource(track, preferred, sources, application.signal)
          if (!current()) throw new Error('歌词选择已取消')
          if (response.status === 'ready') allowUpgrade = false
        }
        if (!order && !response?.result?.main.length) {
          const tracks = [track, usePlayerStore.getState().resolvedTrack]
            .filter((item): item is Track => !!item && (!isProviderId(item.source) || sources.includes(item.source)))
            .filter((item, index, all) => all.findIndex(other => lyricTrackKey(other) === lyricTrackKey(item)) === index)
          for (const candidate of tracks) {
            const result = await fetchLyrics(candidate, sources, application.signal)
            if (!current()) throw new Error('歌词选择已取消')
            if (result.main.length) { response = { status: 'ready', result, match: candidate }; upgradeTrack = candidate; break }
          }
          if (!response?.result?.main.length && tracks[0]) {
            const upgraded = await upgradeLyrics(tracks[0], emptyLyrics, sources, application.signal)
            if (upgraded?.main.length) { response = { status: 'ready', result: upgraded, match: tracks[0] }; allowUpgrade = false }
          }
        }
        if (!current()) throw new Error('歌词选择已取消')
        if (!response?.result?.main.length) throw new Error('暂未找到可用歌词，仍使用原歌词')
        if (Object.hasOwn(useLyricsSourceStore.getState().remembered, key) && !rememberLyricsSource(key, null)) throw new Error('无法清除本首歌词来源选择，请重试')
        onceChoice = undefined
        activePreference = preference
        activeSourceOrder = order
        choiceVersion++
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        const decision = choiceVersion
        const shown = response.result
        const keepOffset = originOf(shown) === useLyricsSourceStore.getState().appliedOrigin && shown.main === useLyricsStore.getState().lines
        const offsetReset = !keepOffset && useLyricsStore.getState().offsetSec !== 0
        useLyricsSourceStore.setState({ requestedOrigin: 'auto', fallbackReason: null, appliedPreference: preference })
        apply(shown, keepOffset, response.match, false)
        if (allowUpgrade) void upgradeLyrics(upgradeTrack, shown, sources, signal).then(upgraded => {
          if (upgraded && !disposed && !signal.aborted && choiceVersion === decision && currentKey === key
            && sameAccounts(accounts) && useLyricsStore.getState().lines === shown.main) apply(upgraded, true, upgradeTrack)
        }).catch(() => {})
        return { saved: true, offsetReset }
      }
      const available = candidateAvailability(track, origin, participatingSources())
      if (!sourceRows(track).includes(origin) || (available.status !== 'idle' && available.status !== 'ready')) throw new Error(available.message ?? '此歌词来源暂不可用')
      const response = results.get(origin) ?? await queryLyricsSource(track, origin, participatingSources(), application.signal, useLyricsSourceStore.getState().remembered[key]?.match)
      await Promise.resolve()
      if (!current()) throw new Error('歌词选择已取消')
      if (response.status !== 'ready' || !response.result?.main.length) throw new Error(response.message ?? '切换失败，仍使用原歌词')
      const entry: RememberedLyricSource = { origin, name: track.name, artist: track.artist, match: response.match }
      const saved = remember ? rememberLyricsSource(key, entry) : true
      const keepOffset = useLyricsSourceStore.getState().appliedOrigin === origin && useLyricsStore.getState().lines === response.result.main
      const offsetReset = !keepOffset && useLyricsStore.getState().offsetSec !== 0
      onceChoice = entry
      choiceVersion++
      controller?.abort()
      useLyricsSourceStore.setState({ requestedOrigin: origin, fallbackReason: null, appliedPreference: activePreference })
      apply(response.result, keepOffset, response.match, false)
      return { saved, offsetReset }
    },
  })
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
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (!useLyricsSourceStore.getState().sourceOrder && (state.lyricsAmllFallback !== previous.lyricsAmllFallback
      || state.lyricsKugouFallback !== previous.lyricsKugouFallback)) sync()
  })
  let wasEnabled = lyricsEnabled()
  const syncEnabled = () => { const enabled = lyricsEnabled(); if (enabled !== wasEnabled) { wasEnabled = enabled; sync() } }
  const stopGame = useGameModeStore.subscribe(syncEnabled)
  const stopVisual = useVisualStore.subscribe((state, previous) => { if (state.fx.desktopLyrics !== previous.fx.desktopLyrics) syncEnabled() })
  sync()
  stopLyricsLoader = () => {
    if (disposed) return
    disposed = true
    controller?.abort()
    cancelDialog()
    unbind()
    sourceProbe.stop()
    stopPlayer()
    stopProviders()
    stopSettings()
    stopGame()
    stopVisual()
    stopLyricsLoader = undefined
  }
  return stopLyricsLoader
}

import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { indexForPosition, useLyricsStore } from '../stores/lyrics'
import { bindLyricsSourceActions, rememberLyricsSource, useLyricsSourceStore } from '../stores/lyrics-source'
import { useProviderStore } from '../stores/providers'
import { lyricServiceSources } from './lyric-service'
import { useSettingsStore } from '../stores/settings'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'
import { providerAccountSession } from './provider-account-session'
import { fetchLyrics, emptyLyrics, upgradeLyrics, type LyricsResult } from './lyrics-fetch'
import { candidateAvailability, queryLyricsSource, type LyricsSourceQueryResult } from './lyrics-source-query'
import { createLyricsSourceProbe } from './lyrics-source-probe'
import { suspendedLyricsSource } from './lyrics-source-health'
import { isReadyLyrics, LYRICS_PROVISIONAL_MS, lyricsOriginOrder, resolveLyricsParallel, resolveLyricsSerial, type OrderedLyricsResult } from './lyrics-ordered-resolve'
import { createLyricsPrefetcher } from './lyrics-prefetch'
import { getQueueStep } from './queue-state'
import { lyricPlaybackPosition } from './lyric-playback-position'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { hasWordTiming } from './word-highlight-timeline'
import { LYRIC_SOURCE_LABELS, type LyricOrigin, type LyricSourceCandidate, type RememberedLyricSource } from '../types/lyrics-source'
import type { Track } from '../types/domain'
import { accompanimentOriginal } from './karaoke-library'

function lyricTrackKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

/** 按歌词依赖字段去重：同曲补详情要重取，canplay 仅换对象或 URL 时不清空歌词。 */
function lyricCandidateSignature(currentTrack: Track | null, resolvedTrack: Track | null): string {
  const candidates = [currentTrack, resolvedTrack].filter((track): track is Track => !!track)
    .map(track => accompanimentOriginal(track) ?? track)
    .filter((track, index, all) => all.findIndex(item => lyricTrackKey(item) === lyricTrackKey(track)) === index)
  return JSON.stringify([currentTrack ? lyricTrackKey(currentTrack) : null, candidates.map(track => [
    lyricTrackKey(track), !!track.pending,
    ...(track.source !== 'local' ? [
      String(track.catalogId ?? ''), track.appleLibrary === true,
      track.name, track.artist, (track.artists ?? []).map(artist => artist.name),
      track.album, track.duration, String(track.isrc ?? track.ISRC ?? ''),
    ] : []),
    ...(track.source === 'qq' ? [qqLyricIdentifiers(track)] : []),
  ])])
}

/** 歌词可用的平台：参与播放的账号平台，以及设置允许游客查询的网易云、QQ；设置中关闭的平台除外。 */
function participatingSources(): ProviderId[] {
  return lyricServiceSources()
}

/** 影响来源落定结果的全部条件；任一变化时跨曲缓存与预取都不能复用。 */
function lyricsContext(track: Track, origins: LyricOrigin[], sources: ProviderId[], chosen?: RememberedLyricSource): string {
  const settings = useSettingsStore.getState()
  return JSON.stringify([lyricCandidateSignature(track, chosen?.match ?? null), origins, sources,
    settings.lyricsAmllFallback, settings.lyricsKugouFallback,
    PROVIDER_IDS.map(source => providerAccountSession(source)), origins.map(origin => suspendedLyricsSource(origin))])
}

/** 按 next 的走序取下一首；随机走序尚未建立时不预取，避免预取方替播放器生成洗牌顺序。 */
function nextQueueTrack(): Track | undefined {
  if (String(usePlayerStore.getState().contextId ?? '').startsWith('shuange:')) return undefined
  const { queue, queueIndex, shuffleOrder } = usePlaylistStore.getState()
  if (queueIndex < 0 || queue.length < 2) return undefined
  const playMode = useSettingsStore.getState().playMode
  if (playMode === 'shuffle' && shuffleOrder.length !== queue.length) return undefined
  const { index } = getQueueStep({ queue, queueIndex, shuffleOrder }, playMode, 1)
  return index === queueIndex ? undefined : queue[index]
}

function sourceRows(track: Track): LyricOrigin[] {
  track = accompanimentOriginal(track) ?? track
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
  const prefetcher = createLyricsPrefetcher()
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined
  // 兜底显示后 loading 已结束，预取改看当前曲是否最终落定。
  let currentLanded = false
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

  /** 跨曲缓存 → 接手同曲预取 → 全部来源并发、按优先级落定；`onProvisional` 仅当前播放首屏使用。 */
  const resolveOrdered = async (
    track: Track, sources: ProviderId[], signal: AbortSignal, order: NonNullable<typeof activeSourceOrder>,
    chosen?: RememberedLyricSource, onProvisional?: (found: OrderedLyricsResult) => void,
  ) => {
    const origins = lyricsOriginOrder(track, order, chosen)
    const key = lyricTrackKey(track)
    const context = lyricsContext(track, origins, sources, chosen)
    const fallback = (origin: LyricOrigin, message?: string) => {
      if (chosen?.origin === origin) useLyricsSourceStore.setState({ fallbackReason: `已记住${LYRIC_SOURCE_LABELS[origin]}，${message ?? '本次暂不可用'}；本次临时使用其他来源` })
    }
    // 本地歌词读文件很快且可能被用户改写，不进跨曲缓存。
    const cacheable = track.source !== 'local'
    const cached = cacheable ? prefetcher.take(key, context) : undefined
    if (cached) {
      results.set(cached.origin, cached.response)
      if (chosen && cached.origin !== chosen.origin) fallback(chosen.origin)
      return cached.response
    }
    const existing = prefetcher.adopt(key, context)
    // 接手不了的预取属于别的歌或旧条件，不能继续与当前曲抢网络。
    prefetcher.cancel()
    const onSettled = (origin: LyricOrigin, response: LyricsSourceQueryResult) => {
      if (isReadyLyrics(response)) results.set(origin, response)
      else fallback(origin, response.message)
    }
    // 本地歌曲逐个查询：本地有歌词就不向在线来源发送标签。
    const found = cacheable
      ? await resolveLyricsParallel({
        track, origins, sources, signal, chosen, existing,
        provisionalMs: onProvisional ? LYRICS_PROVISIONAL_MS : undefined, onProvisional, onSettled,
      })
      : await resolveLyricsSerial({ track, origins, sources, signal, chosen, onSettled })
    if (found && cacheable && !found.degraded) prefetcher.store(key, context, found)
    return found?.response
  }

  /** 当前曲歌词落定 1 秒后串行预取下一首，不与当前曲抢网络；快速切歌或改队列只保留最后一次。 */
  const schedulePrefetch = () => {
    if (prefetchTimer) clearTimeout(prefetchTimer)
    prefetchTimer = setTimeout(() => {
      prefetchTimer = undefined
      const order = useLyricsSourceStore.getState().sourceOrder
      if (disposed || !order || !lyricsEnabled() || !currentLanded) return
      const next = nextQueueTrack()
      if (!next || next.pending || next.source === 'local' || lyricTrackKey(next) === currentKey) return
      const sources = participatingSources()
      if (!sources.includes(next.source)) return
      const chosen = useLyricsSourceStore.getState().remembered[lyricTrackKey(next)]
      const origins = lyricsOriginOrder(next, order, chosen)
      prefetcher.prefetch(lyricTrackKey(next), lyricsContext(next, origins, sources, chosen), { track: next, origins, sources, chosen })
    }, 1000)
  }

  const sync = () => {
    controller?.abort()
    const previousDialog = selection && { key: selection.key, token: selection.token }
    cancelDialog()
    results.clear()
    currentLanded = false
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
    if (!key || !track) { prefetcher.cancel(); return }
    controller = new AbortController()
    const signal = controller.signal
    // 本地歌曲也带上可用平台：本地没有歌词时按文件标签在线匹配。
    const lyricSources = participatingSources()
    const candidates = [track, resolvedTrack]
      .map(item => item ? accompanimentOriginal(item) ?? item : null)
      .filter((item): item is Track => !!item && (!isProviderId(item.source) || lyricSources.includes(item.source)))
      .filter((item, index, all) => all.findIndex(other => lyricTrackKey(other) === lyricTrackKey(item)) === index)
    const sources = new Set<ProviderId>()
    for (const candidate of candidates) {
      if (isProviderId(candidate.source)) sources.add(candidate.source)
      // 本地歌曲的在线兜底由 fetchLyrics 按账号会话丢弃过期结果；无关账号切换不重取本地歌词。
      if (candidate.source !== 'local') lyricSources.forEach(source => sources.add(source))
    }
    // 手选补全与面板查询也受参与账号的会话变化约束。
    if (chosen || preferences.defaultSource !== 'auto' || previousDialog) lyricSources.forEach(source => sources.add(source))
    const accounts = Array.from(sources, source => ({ source, version: providerAccountSession(source) }))
    activeAccounts = accounts
    const current = () => !disposed && request === session && decision === choiceVersion && !signal.aborted
    if (previousDialog?.key === key) void queryCandidates(key, previousDialog.token).catch(() => {})
    let provisional: LyricsResult | undefined
    void (async () => {
      if (preferences.sourceOrder) {
        const response = await resolveOrdered(track, lyricSources, signal, preferences.sourceOrder, chosen, ({ response }) => {
          if (!current() || !sameAccounts(accounts) || useLyricsStore.getState().trackKey !== key) return
          provisional = response.result
          apply(response.result!, false, response.match ?? track)
        })
        if (!current() || !sameAccounts(accounts)) return { result: emptyLyrics, track: null, locked: true }
        return { result: response?.result ?? emptyLyrics, track: response?.match ?? track, locked: true }
      }
      // 本地歌曲优先用自己的歌词：全局偏好不覆盖，只有本首手动记住的来源才优先。
      const globalOrigin = preferences.defaultSource === 'auto' || track.source === 'local' ? null
        : preferences.defaultSource === 'origin' ? track.source : preferences.defaultSource
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
      // 兜底先显示的就是最终来源时不重复提交，避免重置用户刚调的偏移。
      if (!provisional || shown !== provisional) apply(shown, false, fetchedTrack ?? undefined)
      currentLanded = true
      schedulePrefetch()
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
        const preferred = preference === 'auto' || track.source === 'local' ? null : preference === 'origin' ? track.source : preference
        let response: LyricsSourceQueryResult | undefined
        let upgradeTrack = track
        let allowUpgrade = true
        const order = useLyricsSourceStore.getState().sourceOrder
        if (order) {
          response = await resolveOrdered(track, sources, application.signal, order)
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
  const initialPlayer = usePlayerStore.getState()
  let candidateSignature = lyricCandidateSignature(initialPlayer.currentTrack, initialPlayer.resolvedTrack)
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack === previous.currentTrack && state.resolvedTrack === previous.resolvedTrack) return
    // 伴奏只换音频；保留已接受的候选签名，返回原来的跨源音频时也不重置歌词与偏移。
    if ((state.accompaniment || previous.accompaniment)
      && lyricCandidateSignature(state.currentTrack, null) === lyricCandidateSignature(previous.currentTrack, null)) return
    const nextSignature = lyricCandidateSignature(state.currentTrack, state.resolvedTrack)
    if (nextSignature !== candidateSignature) { candidateSignature = nextSignature; sync() }
  })
  const stopProviders = useProviderStore.subscribe((state, previous) => {
    if (state.playbackOrder.length !== previous.playbackOrder.length
      || state.playbackOrder.some((source, index) => source !== previous.playbackOrder[index])
      || PROVIDER_IDS.some(source => state.byId[source].enabled !== previous.byId[source].enabled
        || state.byId[source].auth !== previous.byId[source].auth)
      || activeAccounts.some(({ source, version }) => version !== providerAccountSession(source))) sync()
  })
  const stopQueue = usePlaylistStore.subscribe((state, previous) => {
    if (state.queue !== previous.queue || state.queueIndex !== previous.queueIndex || state.shuffleOrder !== previous.shuffleOrder) schedulePrefetch()
  })
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.playMode !== previous.playMode) schedulePrefetch()
    const guestChanged = state.lyricsGuestSources.netease !== previous.lyricsGuestSources.netease
      || state.lyricsGuestSources.qq !== previous.lyricsGuestSources.qq
      || state.lyricsPlatformSources.netease !== previous.lyricsPlatformSources.netease
      || state.lyricsPlatformSources.qq !== previous.lyricsPlatformSources.qq
    if (guestChanged || (!useLyricsSourceStore.getState().sourceOrder && (state.lyricsAmllFallback !== previous.lyricsAmllFallback
      || state.lyricsKugouFallback !== previous.lyricsKugouFallback))) sync()
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
    if (prefetchTimer) clearTimeout(prefetchTimer)
    prefetcher.clear()
    stopQueue()
    stopPlayer()
    stopProviders()
    stopSettings()
    stopGame()
    stopVisual()
    stopLyricsLoader = undefined
  }
  return stopLyricsLoader
}

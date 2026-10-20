import type { AudioEngine, AudioEngineCallbacks, PlaybackStatus } from './audio-engine'
import type { AppleMusicPlayback, ApplePlaybackState } from './apple-music-playback'
import type { PlaybackResolver, PlaybackAttempt, PlaybackResolution, PlaybackSourcePreferences } from './playback-resolver'
import type { OfflineCacheStatus } from './offline-cache'
import type { PreloadedResolution } from './track-preload'
import {
  canUseOriginPlaybackShortcut,
  mediaFailureReasonFromPlayError,
  playbackStatusForEngineEvent,
  shouldRecoverAfterOutputDeviceChange,
  shouldAutoplayPlaybackReload,
} from './playback-load-policy'
import { SOURCE_BRAND } from './source-brand'
import { ListeningClock } from './listening-clock'
import { isProviderId, type PlaybackCandidate, type ProviderId, type QualityOption } from '../providers/types'
import type { Track, AudioQuality, MusicSource } from '../types/domain'

const FALLBACK_UNPLAYABLE_MESSAGE = '这首歌暂时无法播放，可以换一首试试'
const EMPTY_FREQUENCY = new Uint8Array(0)

// 实际听满 20 秒或播放过歌曲的 60%，避免快速切歌也上报。
const SCROBBLE_MIN_SECONDS = 20

export type PlaybackEngine = Pick<AudioEngine,
  'load' | 'play' | 'pause' | 'seek' | 'setVolume' | 'setPlaybackRate' | 'clearSource'
  | 'getFrequencyData' | 'hasSource' | 'position' | 'destroy'
> & Partial<Pick<AudioEngine, 'preloadAudio' | 'waitForPreload' | 'releasePreloads'>>
type ApplePlayback = Pick<AppleMusicPlayback, 'load' | 'command' | 'stop' | 'lyricPosition'>
type PlaybackResolverPort = Pick<PlaybackResolver,
  'sourceOrder' | 'attempts' | 'failureMessage' | 'next' | 'abort' | 'complete'
  | 'completeExternal' | 'ignoreUrl' | 'recordExternalMediaFailure'
>

export interface PlaybackCoreDependencies {
  getState(): PlaybackPlayer
  setState(state: Partial<PlaybackPlayer>): void
  createEngine(callbacks: AudioEngineCallbacks): PlaybackEngine
  createApplePlayback(onState: (state: ApplePlaybackState) => void): ApplePlayback
  createResolver(track: Track, quality: AudioQuality, preferences: PlaybackSourcePreferences): PlaybackResolverPort
  getQuality(): AudioQuality
  setQuality(quality: AudioQuality): void
  subscribeQuality(listener: (quality: AudioQuality) => void): () => void
  getSourcePreferences(): PlaybackSourcePreferences
  isParticipating(source: ProviderId): boolean
  subscribeProviders(listener: () => void): () => void
  resolvePending(track: Track): Promise<Track>
  localAudioUrl(track: Track): string | null
  fetchOfflineStatus(track: Track): Promise<OfflineCacheStatus>
  offlineFileUrl(status: OfflineCacheStatus, track: Track): string | null
  getPreloadedResolution(track: Track, quality: AudioQuality): PreloadedResolution | undefined
  audioDiskCacheKey(track: Track, quality: string): string
  accountSession(source: 'netease' | 'qq'): number | null
  capturePlaybackAccount(source: 'netease' | 'qq'): Promise<string | null>
  reportPlayback(track: Track, options: { sourceId: unknown; seconds: number; accountToken: string }): Promise<void> | void
  now?(): number
  beginIntent(kind?: 'pause'): void
  notify(message: string): void
  appleSpectrum: {
    requestCapture(): void
    stop(): void
    read(): Uint8Array
  }
}

export interface PlaybackPlayer {
  status: PlaybackStatus
  currentTrack: Track | null
  position: number
  duration: number
  volume: number
  quality: AudioQuality
  /** 实际出声的档位标签(服务端返回,如"超清母带");直链/未知时为 null。 */
  currentQuality: string | null
  source: MusicSource
  /** 当前真正交付音频的平台；候选尚未进入 canplay 时为 null。 */
  actualSource: MusicSource | null
  /** 实际用于解析和听歌上报的曲目；内容元数据仍由 currentTrack 提供。 */
  resolvedTrack: Track | null
  /** 在线音源的完整解析结果；本地音乐为 null。 */
  resolution: PlaybackResolution | null
  /** 当前音频实际来自网络、本地离线缓存或本地音乐。 */
  playbackTransport: 'online' | 'offline' | 'local' | 'musickit' | null
  playbackAttempts: PlaybackAttempt[]
  /** 当前曲目的播放语境(来源歌单/专辑 id),随队列传入,供切歌时的听歌打卡上报使用。 */
  contextId: unknown
  /** 播放速度(保留音高),不持久化,重启回 1。 */
  rate: number
  play(opts?: { preservePlaybackIntent?: boolean }): void
  pause(): void
  stop(): void
  toggle(): void
  seek(seconds: number): void
  setVolume(v: number): void
  setQuality(q: AudioQuality): void
  setRate(r: number): void
  loadTrack(track: Track, opts?: { startAt?: number; contextId?: unknown; preferredSource?: ProviderId; autoplay?: boolean; preservePlaybackIntent?: boolean }): Promise<void>
  /** 当前曲目仅本次重载时软优先指定平台，不改变全局播放顺序。 */
  preferSourceOnce(source: ProviderId): void
  _lyricPosition(): number
  _engine(): PlaybackEngine
  _frequencyData(): Uint8Array
}

/** 会话编排只通过宿主接口读写状态、控制音频；创建时不注册全局订阅。 */
export function createPlaybackCore(deps: PlaybackCoreDependencies) {
  const get = deps.getState
  const set = deps.setState
  let disposed = false
  let subscriptions: Array<() => void> | null = null

  let engine: PlaybackEngine | null = null
  const now = deps.now ?? (() => performance.now())
  const reports = new Set<Promise<void>>()
  let reportingFlushed = false
  let seeking = false
  let listening: {
    track: Track & { source: 'netease' | 'qq' }
    sourceId: unknown
    accountSession: number
    accountToken: Promise<string | null>
    duration: number
    clock: ListeningClock
  } | null = null

  function listeningPosition(): number {
    const position = engine?.position
    return Number.isFinite(position) ? position! : get().position
  }

  function suspendListening(): void {
    listening?.clock.update(false, listeningPosition(), now(), get().rate)
  }

  function finishListening(): void {
    suspendListening()
    const finished = listening
    listening = null
    if (!finished || finished.duration <= 0) return
    const seconds = Math.floor(finished.clock.seconds)
    if (seconds < 1 || (seconds < SCROBBLE_MIN_SECONDS && finished.clock.mediaSeconds < finished.duration * 0.6)) return
    const { track, accountSession, sourceId } = finished
    const report = finished.accountToken.then((accountToken) => {
      if (!accountToken || deps.accountSession(track.source) !== accountSession) return
      return deps.reportPlayback(track, { sourceId, seconds, accountToken })
    }).catch(() => { /* 上报失败不打断播放；不自动重试造成重复记录。 */ }).finally(() => reports.delete(report))
    reports.add(report)
  }

  function resumeListening(): void {
    if (disposed || reportingFlushed || seeking) return
    const state = get()
    const track = state.resolvedTrack
    if (state.playbackTransport !== 'online' || !track || (track.source !== 'netease' && track.source !== 'qq')) return
    const source = track.source
    const accountSession = deps.accountSession(source)
    if (listening && listening.accountSession !== deps.accountSession(listening.track.source)) listening = null
    if (listening && (listening.track.source !== source || String(listening.track.id) !== String(track.id))) finishListening()
    if (accountSession === null || state.status !== 'playing') return
    if (!listening) {
      listening = {
        track: { ...track, source },
        sourceId: state.currentTrack?.source === source ? state.contextId ?? undefined : undefined,
        accountSession,
        accountToken: deps.capturePlaybackAccount(source).catch(() => null),
        duration: state.duration,
        clock: new ListeningClock(),
      }
      listening.clock.rebase(listeningPosition(), now())
    }
    listening.clock.update(true, listeningPosition(), now(), state.rate)
  }

  async function flushListeningReports(): Promise<void> {
    finishListening()
    reportingFlushed = true
    await Promise.allSettled([...reports])
  }

  // 自然播完的后续走序（切下一首/单曲重播）由 playlist store 决定;
  // 用注册回调解耦,避免 player → playlist 反向导入成环。
  let onTrackEnded: (() => void) | null = null
  function registerTrackEndedHandler(cb: () => void): void {
    onTrackEnded = cb
  }

  // 尚未选曲时由队列决定首次播放目标，所有播放入口共用此路径。
  let onPlayFromQueue: (() => void) | null = null
  function registerPlayFromQueueHandler(cb: () => void): void {
    onPlayFromQueue = cb
  }

  // 特殊播放模式可在自然结束时优先接管走序；返回 true 表示已处理，不再落到普通队列。
  let onTrackEndedInterceptor: (() => boolean) | null = null
  function registerTrackEndedInterceptor(cb: () => boolean): () => void {
    onTrackEndedInterceptor = cb
    return () => {
      if (onTrackEndedInterceptor === cb) onTrackEndedInterceptor = null
    }
  }

  // loadTrack 会话计数:兜底搜索/URL 解析都是异步窗口,期间用户切歌要丢弃过期结果
  let loadSession = 0
  interface ActivePlayback {
    session: number
    originTrack: Track
    resolver: PlaybackResolverPort | null
    candidate: PlaybackCandidate | null
    candidateKind: 'external' | 'resolver' | 'offline' | 'local'
    offlineStatus?: OfflineCacheStatus
    engineLoadId: number
    startAt: number
    /** 仅刷歌允许接管暂停预加载元素 */
    usePreparedAudio: boolean
    advancing: boolean
    fallbackNotified: boolean
    autoplay: boolean
    preferredSource?: ProviderId
    offlineFailed?: boolean
    /** 自然结束已处理上报；切歌不重复上报，单曲重播时重置。 */
    scrobbledOnEnd?: boolean
  }

  let activePlayback: ActivePlayback | null = null
  let outputRecoveryTimer: ReturnType<typeof setTimeout> | null = null

  // 睡眠定时器「播完当前曲再停」:置位后自然播完不走 next,改调该回调(由 sleep-timer store 注册)
  let stopAfterCurrentCb: (() => void) | null = null
  function setStopAfterCurrent(cb: (() => void) | null): void {
    stopAfterCurrentCb = cb
  }

  let applePlayback: ApplePlayback | null = null

  function trackEnded(): void {
    if (activePlayback && !activePlayback.scrobbledOnEnd) {
      activePlayback.scrobbledOnEnd = true
      finishListening()
    }
    if (stopAfterCurrentCb) {
      deps.beginIntent('pause')
      set({ status: 'paused', position: 0 })
      const cb = stopAfterCurrentCb
      stopAfterCurrentCb = null
      cb()
      return
    }
    if (onTrackEndedInterceptor?.()) return
    set({ status: 'paused', position: 0 })
    onTrackEnded?.()
  }

  function appleCommand(command: Parameters<AppleMusicPlayback['command']>[0]): void {
    const playback = applePlayback
    if (!playback) return
    void playback.command(command).catch(() => {
      if (applePlayback !== playback) return
      set({ status: 'paused' })
      deps.notify('Apple Music 播放控制失败，请重试')
    })
  }

  function createResolver(active: ActivePlayback): PlaybackResolverPort {
    const providerState = deps.getSourcePreferences()
    return deps.createResolver(
      active.originTrack,
      get().quality,
      {
        playbackOrder: providerState.playbackOrder.filter(deps.isParticipating),
        preferOriginSource: providerState.preferOriginSource,
        multiSourceFallback: providerState.multiSourceFallback,
        preferredSource: active.preferredSource,
      }
    )
  }

  function failPlayback(active: ActivePlayback): void {
    if (activePlayback !== active || active.session !== loadSession) return
    finishListening()
    active.resolver?.abort()
    activePlayback = null
    const eng = ensureEngine()
    eng.clearSource()
    set({
      status: 'idle',
      actualSource: null,
      resolvedTrack: null,
      resolution: null,
      playbackTransport: null,
      playbackAttempts: [...(active.resolver?.attempts ?? [])],
    })
    deps.notify(active.resolver?.failureMessage || FALLBACK_UNPLAYABLE_MESSAGE)
  }

  function loadCandidate(
    active: ActivePlayback,
    candidate: PlaybackCandidate,
    kind: 'external' | 'resolver',
    cacheable = true
  ): void {
    if (activePlayback !== active || active.session !== loadSession) return
    suspendListening()
    active.candidate = candidate
    active.candidateKind = kind
    if (candidate.source === 'apple') {
      finishListening()
      ensureEngine().clearSource()
      ensureEngine().setPlaybackRate(1)
      const library = candidate.url.startsWith('apple-music:library:')
      const id = decodeURIComponent(candidate.url.slice(library ? 'apple-music:library:'.length : 'apple-music:'.length))
      let committed = false
      const playback = deps.createApplePlayback((state) => {
        if (applePlayback !== playback || activePlayback !== active || active.session !== loadSession) return
        if (state.status === 'error') {
          deps.appleSpectrum.stop()
          playback.stop()
          applePlayback = null
          activePlayback = null
          set({ status: 'paused', actualSource: null, resolvedTrack: null, resolution: null, playbackTransport: null, currentQuality: null })
          deps.notify(state.error || 'Apple Music 播放失败，请检查网络与订阅状态')
          return
        }
        if (!committed && (state.status === 'playing' || state.status === 'paused')) {
          committed = true
          const resolution = active.resolver?.complete(candidate) ?? null
          set({ actualSource: 'apple', resolvedTrack: candidate.track, resolution, playbackAttempts: [...(resolution?.attempts ?? [])], playbackTransport: 'musickit', currentQuality: 'Apple Music', rate: 1 })
          deps.appleSpectrum.requestCapture()
        } else if (state.status === 'playing' && get().status !== 'playing') {
          deps.appleSpectrum.requestCapture()
        }
        set({
          status: state.status === 'ended' ? 'paused' : state.status,
          position: state.position,
          ...(state.duration > 0 ? { duration: state.duration } : {}),
        })
        if (state.status === 'ended') {
          playback.stop()
          applePlayback = null
          const endedSession = loadSession
          trackEnded()
          // 同步开始下一首 Apple 曲目时保留捕获；队列结束则释放音轨。
          queueMicrotask(() => {
            if (loadSession === endedSession && !applePlayback) deps.appleSpectrum.stop()
          })
        }
      })
      applePlayback = playback
      set({ status: active.autoplay ? 'loading' : 'paused', currentQuality: 'Apple Music', rate: 1 })
      void playback.load(id, library, active.startAt, active.autoplay, get().volume, (candidate.track.duration ?? 0) / 1000).catch((error) => {
        if (applePlayback !== playback || activePlayback !== active) return
        deps.appleSpectrum.stop()
        playback.stop()
        applePlayback = null
        activePlayback = null
        set({ status: 'paused', actualSource: null, resolvedTrack: null, resolution: null, playbackTransport: null, currentQuality: null })
        deps.notify(error instanceof Error ? error.message : '请在设置中登录 Apple Music 后重试')
      })
      return
    }
    const cacheKey = candidate.trial || !cacheable || active.offlineFailed
      ? undefined
      : deps.audioDiskCacheKey(candidate.track, candidate.quality.id)
    set({
      status: active.autoplay ? 'loading' : 'paused',
      currentQuality: candidate.quality.label,
      actualSource: null,
      resolvedTrack: null,
      resolution: null,
      playbackAttempts: [...(active.resolver?.attempts ?? [])],
    })
    const eng = ensureEngine()
    const originSource = active.originTrack.source
    const cacheContext = cacheKey && (originSource === 'netease' || originSource === 'qq')
      ? {
          originSource,
          originId: String(active.originTrack.id),
          resolvedSource: candidate.source,
          resolvedId: String(candidate.track.mid ?? candidate.track.id),
          quality: String(candidate.quality.id),
        }
      : undefined
    const loadId = active.usePreparedAudio
      ? eng.load(candidate.url, active.startAt, cacheKey, cacheContext, true)
      : eng.load(candidate.url, active.startAt, cacheKey, cacheContext)
    active.engineLoadId = loadId
    eng.setVolume(get().volume)
    if (active.autoplay) {
      void eng.play().catch((error) => {
        const reason = mediaFailureReasonFromPlayError(error)
        if (!reason || activePlayback !== active || active.engineLoadId !== loadId) return
        void advancePlayback(reason)
      })
    }
  }

  async function advancePlayback(reason?: string): Promise<void> {
    const active = activePlayback
    if (!active || active.advancing) return
    if (!active.resolver && active.candidateKind === 'offline') {
      // 本次在线回退不得经代理重新读到同一个坏缓存，也不删除用户固定的文件。
      active.offlineFailed = true
      active.resolver = createResolver(active)
    }
    if (!active.resolver) {
      failPlayback(active)
      return
    }
    active.advancing = true
    if (reason) {
      suspendListening()
      active.startAt = Math.max(active.startAt, get().position)
      active.engineLoadId = 0
      ensureEngine().clearSource()
    }
    try {
      let candidate: PlaybackCandidate | null
      if (reason && active.candidateKind === 'external' && active.candidate) {
        active.resolver.recordExternalMediaFailure(active.candidate, reason)
        active.candidate = null
        candidate = await active.resolver.next()
      } else {
        candidate = await active.resolver.next(reason)
      }
      if (activePlayback !== active || active.session !== loadSession) return
      if (!candidate) {
        failPlayback(active)
        return
      }
      loadCandidate(active, candidate, 'resolver')
    } finally {
      if (activePlayback === active) active.advancing = false
    }
  }

  function commitPlayableCandidate(loadId: number): void {
    const active = activePlayback
    if (!active || active.session !== loadSession || active.engineLoadId !== loadId) return
    if (active.candidateKind === 'local') {
      finishListening()
      set({
        actualSource: 'local',
        resolvedTrack: active.originTrack,
        resolution: null,
        currentQuality: null,
        playbackTransport: 'local',
      })
      return
    }
    if (active.candidateKind === 'offline') {
      finishListening()
      const status = active.offlineStatus
      const resolved = status?.resolved
      const origin = active.originTrack
      set({
        actualSource: resolved?.source ?? origin.source,
        resolvedTrack: resolved ? {
          provider: resolved.source,
          source: resolved.source,
          type: origin.type,
          id: resolved.id,
          mid: resolved.source === 'qq' ? resolved.id : undefined,
          name: resolved.name ?? origin.name,
          artist: resolved.artist ?? origin.artist,
          artists: [],
          duration: origin.duration,
        } : origin,
        resolution: null,
        currentQuality: status?.quality ?? null,
        playbackTransport: 'offline',
      })
      return
    }
    const candidate = active.candidate
    if (!candidate || !deps.isParticipating(candidate.source)) {
      void advancePlayback('PROVIDER_INACTIVE')
      return
    }
    const resolution = active.candidateKind === 'external'
      ? active.resolver?.completeExternal(candidate) ?? null
      : active.resolver?.complete(candidate) ?? null
    if (!resolution) return
    set({
      actualSource: resolution.actualSource,
      resolvedTrack: resolution.resolvedTrack,
      resolution,
      currentQuality: resolution.quality.label,
      playbackAttempts: [...resolution.attempts],
      playbackTransport: 'online',
    })
    resumeListening()
    if (resolution.actualSource !== active.originTrack.source && !active.fallbackNotified) {
      active.fallbackNotified = true
      deps.notify(`已从${SOURCE_BRAND[resolution.actualSource].label}换源播放`)
    }
  }

  function ensureEngine(): PlaybackEngine {
    if (disposed) throw new Error('播放核心已释放')
    if (engine) return engine
    engine = deps.createEngine({
      onPosition: (s) => {
        if (!activePlayback?.engineLoadId || get().currentTrack?.source === 'apple') return
        listening?.clock.sample(s, now())
        set({ position: s })
        resumeListening()
      },
      onDuration: (d) => {
        if (!activePlayback?.engineLoadId || get().currentTrack?.source === 'apple') return
        set({ duration: d })
        if (listening) listening.duration = d
      },
      onStatus: (status) => {
        if (!activePlayback?.engineLoadId || get().currentTrack?.source === 'apple') return
        suspendListening()
        set({ status: playbackStatusForEngineEvent(status, activePlayback.autoplay) })
        resumeListening()
      },
      onSeeking: () => {
        seeking = true
        listening?.clock.rebase(listeningPosition(), now())
        suspendListening()
      },
      onSeeked: () => {
        seeking = false
        listening?.clock.rebase(listeningPosition(), now())
        resumeListening()
      },
      onCanPlay: commitPlayableCandidate,
      onError: (reason, loadId) => {
        if (activePlayback?.engineLoadId !== loadId) return
        void advancePlayback(reason)
      },
      onOutputDeviceChange: (wasPlaying) => {
        if (disposed || get().currentTrack?.source === 'apple') return
        const state = get()
        if (!state.currentTrack || !shouldRecoverAfterOutputDeviceChange(state.status, wasPlaying)) return
        const session = loadSession
        if (outputRecoveryTimer) clearTimeout(outputRecoveryTimer)
        outputRecoveryTimer = setTimeout(() => {
          outputRecoveryTimer = null
          const latest = get()
          if (session !== loadSession || !latest.currentTrack || !shouldAutoplayPlaybackReload(latest.status)) return
          void latest.loadTrack(latest.currentTrack, {
            startAt: latest.position,
            contextId: latest.contextId,
            autoplay: true,
            preservePlaybackIntent: true,
          })
        }, 200)
      },
      onEnded: () => {
        if (activePlayback?.engineLoadId && get().currentTrack?.source !== 'apple') trackEnded()
      }
    })
    return engine
  }

  const player: PlaybackPlayer = {
    status: 'idle',
    currentTrack: null,
    position: 0,
    duration: 0,
    volume: 0.8,
    quality: deps.getQuality(),
    currentQuality: null,
    source: 'netease',
    actualSource: null,
    resolvedTrack: null,
    resolution: null,
    playbackTransport: null,
    playbackAttempts: [],
    contextId: null,
    rate: 1,

    play(opts) {
      if (disposed) return
      reportingFlushed = false
      if (!opts?.preservePlaybackIntent) deps.beginIntent()
      if (!get().currentTrack) { onPlayFromQueue?.(); return }
      if (applePlayback) { appleCommand({ type: 'play' }); set({ status: 'loading' }); return }
      if (activePlayback) {
        activePlayback.autoplay = true
        activePlayback.scrobbledOnEnd = false
      }
      if (activePlayback && !activePlayback.engineLoadId && (!activePlayback.candidate || activePlayback.advancing)) {
        set({ status: 'loading' })
        return
      }
      const eng = ensureEngine()
      // 重启恢复态:有曲目但引擎还没加载过源,先按断点位置重新解析加载
      const { currentTrack, position, contextId } = get()
      if (!eng.hasSource && currentTrack) {
        void get().loadTrack(currentTrack, { startAt: position, contextId, preservePlaybackIntent: opts?.preservePlaybackIntent })
        return
      }
      void eng.play()
    },
    pause() {
      if (disposed) return
      suspendListening()
      deps.beginIntent('pause')
      if (activePlayback) activePlayback.autoplay = false
      if (applePlayback) { appleCommand({ type: 'pause' }); set({ status: 'paused' }); return }
      ensureEngine().pause()
      set({ status: 'paused' })
    },
    stop() {
      if (disposed) return
      finishListening()
      deps.beginIntent()
      ++loadSession
      activePlayback?.resolver?.abort()
      activePlayback = null
      if (outputRecoveryTimer) clearTimeout(outputRecoveryTimer)
      outputRecoveryTimer = null
      const playback = applePlayback
      applePlayback = null
      playback?.stop()
      deps.appleSpectrum.stop()
      engine?.clearSource()
      if (String(get().contextId).startsWith('shuange:')) engine?.releasePreloads?.()
      set({
        currentTrack: null, status: 'idle', position: 0, duration: 0,
        actualSource: null, resolvedTrack: null, resolution: null,
        playbackTransport: null, playbackAttempts: [], currentQuality: null, contextId: null,
      })
      // 当前曲已主动停止，结束“播完当前曲再停”的一次性等待。
      const afterStop = stopAfterCurrentCb
      stopAfterCurrentCb = null
      afterStop?.()
    },
    toggle() {
      if (disposed) return
      const s = get().status
      if (s === 'playing' || s === 'loading') get().pause()
      else get().play()
    },
    seek(seconds) {
      if (disposed) return
      suspendListening()
      listening?.clock.rebase(seconds, now())
      if (activePlayback) activePlayback.startAt = seconds
      if (applePlayback) { appleCommand({ type: 'seek', seconds }); set({ position: seconds }); return }
      if (activePlayback?.originTrack.source === 'apple' && !activePlayback.candidate) {
        set({ position: seconds })
        return
      }
      ensureEngine().seek(seconds)
      set({ position: seconds })
    },
    setVolume(v) {
      if (disposed) return
      if (applePlayback) appleCommand({ type: 'volume', volume: v })
      ensureEngine().setVolume(v)
      set({ volume: v })
    },
    setQuality(q) {
      if (disposed) return
      // 音质以 settings 为单一来源（含持久化），经下方订阅回流到本 store
      deps.setQuality(q)
    },
    setRate(r) {
      if (disposed) return
      suspendListening()
      if (applePlayback) {
        deps.notify('当前音源暂不支持倍速')
        return
      }
      ensureEngine().setPlaybackRate(r)
      set({ rate: r })
      resumeListening()
    },

    async loadTrack(track, opts) {
      if (disposed) return
      reportingFlushed = false
      seeking = false
      suspendListening()
      const previous = get().currentTrack
      if (!previous || previous.source !== track.source || String(previous.id) !== String(track.id)
        || opts?.startAt === undefined) finishListening()
      if (!opts?.preservePlaybackIntent) deps.beginIntent()
      if (track.source !== 'apple') deps.appleSpectrum.stop()
      applePlayback?.stop()
      applePlayback = null
      const eng = ensureEngine()
      // 切歌/重载统一终止旧解析会话，晚到的搜索、URL 和媒体回调都不得写回。
      activePlayback?.resolver?.abort()
      activePlayback = null
      if (String(opts?.contextId ?? '').startsWith('shuange:') && String(get().contextId ?? '').startsWith('shuange:')) eng.clearSource(true)
      else eng.clearSource()
      const session = ++loadSession
      const startAt = opts?.startAt ?? 0
      const autoplay = opts?.autoplay ?? true
      const nextContextId = opts?.contextId ?? null
      // Track.duration 约定为毫秒,store.duration 是秒(引擎元数据就绪后会覆盖)
      set({
        currentTrack: track,
        source: track.source,
        actualSource: null,
        resolvedTrack: null,
        resolution: null,
        playbackTransport: null,
        playbackAttempts: [],
        contextId: nextContextId,
        status: autoplay ? 'loading' : 'paused',
        position: startAt,
        duration: (track.duration ?? 0) / 1000,
        currentQuality: null,
      })

      const active: ActivePlayback = {
        session,
        originTrack: track,
        resolver: null,
        candidate: null,
        candidateKind: track.source === 'local' ? 'local' : 'resolver',
        engineLoadId: 0,
        startAt,
        usePreparedAudio: String(nextContextId).startsWith('shuange:'),
        advancing: false,
        fallbackNotified: false,
        autoplay,
        preferredSource: opts?.preferredSource,
      }
      activePlayback = active

      // 补详情也属于当前播放会话；等待期间暂停、恢复和定位沿用同一份意图。
      if (track.pending) {
        track = await deps.resolvePending(track)
        if (activePlayback !== active || active.session !== loadSession) return
        active.originTrack = track
        set({ currentTrack: track, duration: (track.duration ?? 0) / 1000 })
      }

      if (track.source === 'local') {
        // 本地音乐不依赖 track.url:最近播放等场景落盘会剥掉 url、或存的 url 绑定的是
        // 上一会话端口(端口每次随机注入),直接用 track.id 经本地 api 重建当前可用地址。
        // 重建出的就是 127.0.0.1:<port>/api/local/audio,load 侧 isLocalApiUrl 判定成立,
        // 不会套 /api/audio 代理被 SSRF 防护拦掉。
        const localUrl = deps.localAudioUrl(track)
        if (!localUrl) {
          eng.clearSource()
          set({ status: 'idle' })
          deps.notify(FALLBACK_UNPLAYABLE_MESSAGE)
          return
        }
        active.engineLoadId = eng.load(localUrl, active.startAt)
        eng.setVolume(get().volume)
        if (active.autoplay) void eng.play().catch(() => {})
        return
      }

      // 在线曲目先查本地离线索引；命中时不依赖平台登录或网络，媒体文件失效则回到解析器降级链。
      const offlineStatus = await deps.fetchOfflineStatus(track).catch(() => null)
      if (activePlayback !== active || active.session !== loadSession) return
      const offlineUrl = offlineStatus ? deps.offlineFileUrl(offlineStatus, track) : null
      // 手动优先的平台与缓存实际音源不一致时，交给解析器按本次选择起播。
      const canUseOfflineCache = !active.preferredSource
        || active.preferredSource === (offlineStatus?.resolved?.source ?? track.source)
      if (offlineStatus && offlineUrl && canUseOfflineCache) {
        deps.appleSpectrum.stop()
        active.candidateKind = 'offline'
        active.offlineStatus = offlineStatus
        set({ status: active.autoplay ? 'loading' : 'paused' })
        const loadId = active.usePreparedAudio
          ? eng.load(offlineUrl, active.startAt, undefined, undefined, true)
          : eng.load(offlineUrl, active.startAt)
        active.engineLoadId = loadId
        eng.setVolume(get().volume)
        if (active.autoplay) {
          void eng.play().catch((error) => {
            const reason = mediaFailureReasonFromPlayError(error)
            if (!reason || activePlayback !== active || active.engineLoadId !== loadId) return
            void advancePlayback(reason)
          })
        }
        return
      }

      const resolver = createResolver(active)
      active.resolver = resolver
      // 自带直链或相邻曲目预解析命中时先起播；媒体失败仍会回到同一 resolver 会话继续降级。
      const originAvailable = deps.isParticipating(track.source)
      const canUseOriginShortcut = canUseOriginPlaybackShortcut(track.source, resolver.sourceOrder[0])
      const preloaded = track.source !== 'apple' && originAvailable && canUseOriginShortcut && !track.url
        ? deps.getPreloadedResolution(track, get().quality)
        : undefined
      const externalUrl = track.source !== 'apple' && originAvailable && canUseOriginShortcut ? track.url ?? preloaded?.url : undefined
      if (externalUrl) {
        resolver.ignoreUrl(track.source, externalUrl)
        const level = preloaded?.level ?? track.quality ?? get().quality
        const quality: QualityOption = {
          id: level,
          label: preloaded?.quality ?? (track.url ? '直链' : String(level)),
          rank: 0,
        }
        loadCandidate(active, {
          source: track.source,
          track,
          quality,
          url: externalUrl,
          trial: !!preloaded?.trial,
        }, 'external', !track.url)
        return
      }
      await advancePlayback()
    },

    preferSourceOnce(source) {
      if (disposed) return
      const state = get()
      if (!state.currentTrack || !deps.isParticipating(source)) return
      void state.loadTrack(state.currentTrack, {
        startAt: state.position,
        contextId: state.contextId,
        preferredSource: source,
        autoplay: shouldAutoplayPlaybackReload(state.status),
      })
    },

    _lyricPosition: () => applePlayback?.lyricPosition ?? get().position,
    _engine: ensureEngine,
    _frequencyData: () => disposed ? EMPTY_FREQUENCY : get().playbackTransport === 'musickit' && get().status === 'playing'
      ? deps.appleSpectrum.read()
      : get().playbackTransport === 'musickit' ? EMPTY_FREQUENCY : ensureEngine().getFrequencyData()
  }

  // 音质/平台同步属于核心宿主生命周期，不能由页面挂载和卸载决定。
  function syncQuality(quality: AudioQuality): void {
    if (disposed || quality === get().quality) return
    set({ quality })
    const state = get()
    if (state.currentTrack && state.currentTrack.source !== 'apple' && !state.currentTrack.url
      && shouldAutoplayPlaybackReload(state.status)) {
      void state.loadTrack(state.currentTrack, {
        startAt: state.position,
        contextId: state.contextId,
        preservePlaybackIntent: true,
      })
    }
  }

  function syncProviders(): void {
    if (listening && listening.accountSession !== deps.accountSession(listening.track.source)) listening = null
    const active = activePlayback
    const candidateSource = active?.candidate?.source
    if (disposed || !active || !candidateSource || deps.isParticipating(candidateSource)) return
    const state = get()
    if (!state.currentTrack) return
    active.resolver?.abort()
    void state.loadTrack(state.currentTrack, {
      startAt: state.position,
      contextId: state.contextId,
      autoplay: shouldAutoplayPlaybackReload(state.status),
      preservePlaybackIntent: true,
    })
  }

  function start(): void {
    if (disposed || subscriptions) return
    subscriptions = [deps.subscribeQuality(syncQuality), deps.subscribeProviders(syncProviders)]
    syncQuality(deps.getQuality())
    syncProviders()
  }

  /** 终止本实例；不触发睡眠回调或改写最后快照，宿主可先持久化再释放。 */
  function dispose(): void {
    if (disposed) return
    finishListening()
    disposed = true
    ++loadSession
    for (const unsubscribe of subscriptions ?? []) unsubscribe()
    subscriptions = null
    activePlayback?.resolver?.abort()
    activePlayback = null
    if (outputRecoveryTimer) clearTimeout(outputRecoveryTimer)
    outputRecoveryTimer = null
    const playback = applePlayback
    applePlayback = null
    playback?.stop()
    deps.appleSpectrum.stop()
    const previousEngine = engine
    engine = null
    previousEngine?.destroy()
    onTrackEnded = null
    onPlayFromQueue = null
    onTrackEndedInterceptor = null
    stopAfterCurrentCb = null
  }

  return {
    player,
    start,
    dispose,
    flushListeningReports,
    registerTrackEndedHandler,
    registerPlayFromQueueHandler,
    registerTrackEndedInterceptor,
    setStopAfterCurrent,
  }
}

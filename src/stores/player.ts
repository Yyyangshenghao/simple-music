import { create } from 'zustand'
import { AudioEngine, type PlaybackStatus } from '../lib/audio-engine'
import { api } from '../lib/api'
import { AppleMusicPlayback } from '../lib/apple-music-playback'
import { appleAudioSpectrum } from '../lib/apple-audio-spectrum'
import { getPreloadedResolution, audioDiskCacheKey } from '../lib/track-preload'
import { PlaybackResolver, type PlaybackAttempt, type PlaybackResolution } from '../lib/playback-resolver'
import { fetchOfflineStatus, offlineFileUrl, type OfflineCacheStatus } from '../lib/offline-cache'
import {
  canUseOriginPlaybackShortcut,
  mediaFailureReasonFromPlayError,
  playbackStatusForEngineEvent,
  shouldRecoverAfterOutputDeviceChange,
  shouldAutoplayPlaybackReload,
} from '../lib/playback-load-policy'
import { SOURCE_BRAND } from '../lib/source-brand'
import { serviceFor } from '../lib/service-registry'
import { resolvePending } from '../lib/queue-details'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import { isProviderParticipating, useProviderStore } from './providers'
import { expireProviderAccount } from './provider-auth'
import { isProviderId, type PlaybackCandidate, type ProviderId, type QualityOption } from '../providers/types'
import type { Track, AudioQuality, MusicSource } from '../types/domain'

const FALLBACK_UNPLAYABLE_MESSAGE = '这首歌暂时无法播放，可以换一首试试'
const EMPTY_FREQUENCY = new Uint8Array(0)

// 听歌打卡门槛:播满 20 秒或过半(取更短者)才算"真的听了",避免快速切歌也上报打卡
const SCROBBLE_MIN_SECONDS = 20

/** 切歌前把上一首上报听歌打卡(可选实现,如 QQ/本地无对应接口时静默跳过)。 */
function maybeScrobble(
  track: Track | null,
  originSource: MusicSource | undefined,
  contextId: unknown,
  elapsedSeconds: number,
  durationSeconds: number
): void {
  if (!track || durationSeconds <= 0) return
  if (isProviderId(track.source) && !isProviderParticipating(track.source)) return
  if (elapsedSeconds < Math.min(SCROBBLE_MIN_SECONDS, durationSeconds * 0.6)) return
  const sourceId = originSource === track.source ? contextId ?? undefined : undefined
  const reportPlayback = serviceFor(track.source).reportPlayback
  if (!reportPlayback) return
  void reportPlayback(track.id, { sourceId, seconds: elapsedSeconds })
    .catch((error) => {
      if (isProviderId(track.source)) expireProviderAccount(track.source, error)
    })
}

interface PlayerStore {
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
  play(): void
  pause(): void
  toggle(): void
  seek(seconds: number): void
  setVolume(v: number): void
  setQuality(q: AudioQuality): void
  setRate(r: number): void
  loadTrack(track: Track, opts?: { startAt?: number; contextId?: unknown; preferredSource?: ProviderId; autoplay?: boolean }): Promise<void>
  /** 当前曲目仅本次重载时软优先指定平台，不改变全局播放顺序。 */
  preferSourceOnce(source: ProviderId): void
  _lyricPosition(): number
  _engine(): AudioEngine
  _frequencyData(): Uint8Array
}

let engine: AudioEngine | null = null

// 自然播完的后续走序（切下一首/单曲重播）由 playlist store 决定;
// 用注册回调解耦,避免 player → playlist 反向导入成环。
let onTrackEnded: (() => void) | null = null
export function registerTrackEndedHandler(cb: () => void): void {
  onTrackEnded = cb
}

// 特殊播放模式可在自然结束时优先接管走序；返回 true 表示已处理，不再落到普通队列。
let onTrackEndedInterceptor: (() => boolean) | null = null
export function registerTrackEndedInterceptor(cb: () => boolean): () => void {
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
  resolver: PlaybackResolver | null
  candidate: PlaybackCandidate | null
  candidateKind: 'external' | 'resolver' | 'offline' | 'local'
  offlineStatus?: OfflineCacheStatus
  engineLoadId: number
  startAt: number
  advancing: boolean
  fallbackNotified: boolean
  autoplay: boolean
  preferredSource?: ProviderId
  offlineFailed?: boolean
}

let activePlayback: ActivePlayback | null = null
let outputRecoveryTimer: ReturnType<typeof setTimeout> | null = null

// 睡眠定时器「播完当前曲再停」:置位后自然播完不走 next,改调该回调(由 sleep-timer store 注册)
let stopAfterCurrentCb: (() => void) | null = null
export function setStopAfterCurrent(cb: (() => void) | null): void {
  stopAfterCurrentCb = cb
}

export const usePlayerStore = create<PlayerStore>((set, get) => {
  let applePlayback: AppleMusicPlayback | null = null

  function trackEnded(): void {
    if (stopAfterCurrentCb) {
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
      useToastStore.getState().show('Apple Music 播放控制失败，请重试')
    })
  }

  function createResolver(active: ActivePlayback): PlaybackResolver {
    const providerState = useProviderStore.getState()
    return new PlaybackResolver(
      active.originTrack,
      get().quality,
      {
        playbackOrder: providerState.playbackOrder.filter(isProviderParticipating),
        preferOriginSource: providerState.preferOriginSource,
        multiSourceFallback: providerState.multiSourceFallback,
        preferredSource: active.preferredSource,
      },
      { isParticipating: isProviderParticipating }
    )
  }

  function failPlayback(active: ActivePlayback): void {
    if (activePlayback !== active || active.session !== loadSession) return
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
    useToastStore.getState().show(active.resolver?.failureMessage || FALLBACK_UNPLAYABLE_MESSAGE)
  }

  function loadCandidate(
    active: ActivePlayback,
    candidate: PlaybackCandidate,
    kind: 'external' | 'resolver',
    cacheable = true
  ): void {
    if (activePlayback !== active || active.session !== loadSession) return
    active.candidate = candidate
    active.candidateKind = kind
    if (candidate.source === 'apple') {
      ensureEngine().clearSource()
      ensureEngine().setPlaybackRate(1)
      const library = candidate.url.startsWith('apple-music:library:')
      const id = decodeURIComponent(candidate.url.slice(library ? 'apple-music:library:'.length : 'apple-music:'.length))
      let committed = false
      const playback = new AppleMusicPlayback((state) => {
        if (applePlayback !== playback || activePlayback !== active || active.session !== loadSession) return
        if (state.status === 'error') {
          appleAudioSpectrum.stop()
          playback.stop()
          applePlayback = null
          activePlayback = null
          set({ status: 'paused', actualSource: null, resolvedTrack: null, resolution: null, playbackTransport: null, currentQuality: null })
          useToastStore.getState().show(state.error || 'Apple Music 播放失败，请检查网络与订阅状态')
          return
        }
        if (!committed && (state.status === 'playing' || state.status === 'paused')) {
          committed = true
          const resolution = active.resolver?.complete(candidate) ?? null
          set({ actualSource: 'apple', resolvedTrack: candidate.track, resolution, playbackAttempts: [...(resolution?.attempts ?? [])], playbackTransport: 'musickit', currentQuality: 'Apple Music', rate: 1 })
          void window.desktop?.startAppleAudioCapture?.().catch(() => {})
        } else if (state.status === 'playing' && get().status !== 'playing') {
          void window.desktop?.startAppleAudioCapture?.().catch(() => {})
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
            if (loadSession === endedSession && !applePlayback) appleAudioSpectrum.stop()
          })
        }
      })
      applePlayback = playback
      set({ status: active.autoplay ? 'loading' : 'paused', currentQuality: 'Apple Music', rate: 1 })
      void playback.load(id, library, active.startAt, active.autoplay, get().volume, (candidate.track.duration ?? 0) / 1000).catch((error) => {
        if (applePlayback !== playback || activePlayback !== active) return
        appleAudioSpectrum.stop()
        playback.stop()
        applePlayback = null
        activePlayback = null
        set({ status: 'paused', actualSource: null, resolvedTrack: null, resolution: null, playbackTransport: null, currentQuality: null })
        useToastStore.getState().show(error instanceof Error ? error.message : '请在设置中登录 Apple Music 后重试')
      })
      return
    }
    const cacheKey = candidate.trial || !cacheable || active.offlineFailed
      ? undefined
      : audioDiskCacheKey(candidate.track, candidate.quality.id)
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
    const loadId = eng.load(candidate.url, active.startAt, cacheKey, cacheContext)
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
    if (!candidate || !isProviderParticipating(candidate.source)) {
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
    if (resolution.actualSource !== active.originTrack.source && !active.fallbackNotified) {
      active.fallbackNotified = true
      useToastStore.getState().show(`已从${SOURCE_BRAND[resolution.actualSource].label}换源播放`)
    }
  }

  function ensureEngine(): AudioEngine {
    if (engine) return engine
    engine = new AudioEngine({
      onPosition: (s) => { if (activePlayback?.engineLoadId && get().currentTrack?.source !== 'apple') set({ position: s }) },
      onDuration: (d) => { if (activePlayback?.engineLoadId && get().currentTrack?.source !== 'apple') set({ duration: d }) },
      onStatus: (status) => { if (activePlayback?.engineLoadId && get().currentTrack?.source !== 'apple') set({
        status: playbackStatusForEngineEvent(status, activePlayback?.autoplay ?? true),
      }) },
      onCanPlay: commitPlayableCandidate,
      onError: (reason, loadId) => {
        if (activePlayback?.engineLoadId !== loadId) return
        void advancePlayback(reason)
      },
      onOutputDeviceChange: (wasPlaying) => {
        if (get().currentTrack?.source === 'apple') return
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
          })
        }, 200)
      },
      onEnded: () => {
        if (activePlayback?.engineLoadId && get().currentTrack?.source !== 'apple') trackEnded()
      }
    })
    return engine
  }

  return {
    status: 'idle',
    currentTrack: null,
    position: 0,
    duration: 0,
    volume: 0.8,
    quality: useSettingsStore.getState().audioQuality,
    currentQuality: null,
    source: 'netease',
    actualSource: null,
    resolvedTrack: null,
    resolution: null,
    playbackTransport: null,
    playbackAttempts: [],
    contextId: null,
    rate: 1,

    play() {
      if (applePlayback) { appleCommand({ type: 'play' }); set({ status: 'loading' }); return }
      if (activePlayback) activePlayback.autoplay = true
      if (activePlayback && !activePlayback.engineLoadId && (!activePlayback.candidate || activePlayback.advancing)) {
        set({ status: 'loading' })
        return
      }
      const eng = ensureEngine()
      // 重启恢复态:有曲目但引擎还没加载过源,先按断点位置重新解析加载
      const { currentTrack, position, contextId } = get()
      if (!eng.hasSource && currentTrack) {
        void get().loadTrack(currentTrack, { startAt: position, contextId })
        return
      }
      void eng.play()
    },
    pause() {
      if (activePlayback) activePlayback.autoplay = false
      if (applePlayback) { appleCommand({ type: 'pause' }); set({ status: 'paused' }); return }
      ensureEngine().pause()
      set({ status: 'paused' })
    },
    toggle() {
      const s = get().status
      if (s === 'playing' || s === 'loading') get().pause()
      else get().play()
    },
    seek(seconds) {
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
      if (applePlayback) appleCommand({ type: 'volume', volume: v })
      ensureEngine().setVolume(v)
      set({ volume: v })
    },
    setQuality(q) {
      // 音质以 settings 为单一来源（含持久化），经下方订阅回流到本 store
      useSettingsStore.getState().setAudioQuality(q)
    },
    setRate(r) {
      if (applePlayback) {
        useToastStore.getState().show('当前音源暂不支持倍速')
        return
      }
      ensureEngine().setPlaybackRate(r)
      set({ rate: r })
    },

    async loadTrack(track, opts) {
      if (track.source !== 'apple') appleAudioSpectrum.stop()
      applePlayback?.stop()
      applePlayback = null
      const eng = ensureEngine()
      // 切歌/重载统一终止旧解析会话，晚到的搜索、URL 和媒体回调都不得写回。
      activePlayback?.resolver?.abort()
      activePlayback = null
      eng.clearSource()
      const session = ++loadSession
      const startAt = opts?.startAt ?? 0
      const autoplay = opts?.autoplay ?? true
      const nextContextId = opts?.contextId ?? null
      const prev = get()
      // 真正切歌(而非同曲重载:音质切换/断线恢复)才上报上一首的听歌打卡
      if (
        prev.currentTrack &&
        `${prev.currentTrack.source}:${String(prev.currentTrack.id)}` !== `${track.source}:${String(track.id)}`
      ) {
        if (prev.playbackTransport === 'online') {
          maybeScrobble(
            prev.resolvedTrack ?? prev.currentTrack,
            prev.currentTrack.source,
            prev.contextId,
            prev.position,
            prev.duration
          )
        }
      }
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
        advancing: false,
        fallbackNotified: false,
        autoplay,
        preferredSource: opts?.preferredSource,
      }
      activePlayback = active

      // 补详情也属于当前播放会话；等待期间暂停、恢复和定位沿用同一份意图。
      if (track.pending) {
        track = await resolvePending(track)
        if (activePlayback !== active || active.session !== loadSession) return
        active.originTrack = track
        set({ currentTrack: track, duration: (track.duration ?? 0) / 1000 })
      }

      if (track.source === 'local') {
        // 本地音乐不依赖 track.url:最近播放等场景落盘会剥掉 url、或存的 url 绑定的是
        // 上一会话端口(端口每次随机注入),直接用 track.id 经本地 api 重建当前可用地址。
        // 重建出的就是 127.0.0.1:<port>/api/local/audio,load 侧 isLocalApiUrl 判定成立,
        // 不会套 /api/audio 代理被 SSRF 防护拦掉。
        const localUrl = api.url('/api/local/audio', { id: String(track.id) })
        if (!localUrl) {
          eng.clearSource()
          set({ status: 'idle' })
          useToastStore.getState().show(FALLBACK_UNPLAYABLE_MESSAGE)
          return
        }
        active.engineLoadId = eng.load(localUrl, active.startAt)
        eng.setVolume(get().volume)
        if (active.autoplay) void eng.play().catch(() => {})
        return
      }

      // 在线曲目先查本地离线索引；命中时不依赖平台登录或网络，媒体文件失效则回到解析器降级链。
      const offlineStatus = await fetchOfflineStatus(track).catch(() => null)
      if (activePlayback !== active || active.session !== loadSession) return
      const offlineUrl = offlineStatus ? offlineFileUrl(offlineStatus, track) : null
      // 手动优先的平台与缓存实际音源不一致时，交给解析器按本次选择起播。
      const canUseOfflineCache = !active.preferredSource
        || active.preferredSource === (offlineStatus?.resolved?.source ?? track.source)
      if (offlineStatus && offlineUrl && canUseOfflineCache) {
        appleAudioSpectrum.stop()
        active.candidateKind = 'offline'
        active.offlineStatus = offlineStatus
        set({ status: active.autoplay ? 'loading' : 'paused' })
        const loadId = eng.load(offlineUrl, active.startAt)
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
      const originAvailable = isProviderParticipating(track.source)
      const canUseOriginShortcut = canUseOriginPlaybackShortcut(track.source, resolver.sourceOrder[0])
      const preloaded = track.source !== 'apple' && originAvailable && canUseOriginShortcut && !track.url
        ? getPreloadedResolution(track, get().quality)
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
      const state = get()
      if (!state.currentTrack || !isProviderParticipating(source)) return
      void state.loadTrack(state.currentTrack, {
        startAt: state.position,
        contextId: state.contextId,
        preferredSource: source,
        autoplay: shouldAutoplayPlaybackReload(state.status),
      })
    },

    _lyricPosition: () => applePlayback?.lyricPosition ?? get().position,
    _engine: ensureEngine,
    _frequencyData: () => get().playbackTransport === 'musickit' && get().status === 'playing'
      ? appleAudioSpectrum.read()
      : get().playbackTransport === 'musickit' ? EMPTY_FREQUENCY : ensureEngine().getFrequencyData()
  }
})

// settings.audioQuality 变化时（含启动后 loadFromLocal 回填）同步到播放器;
// 若此刻有流媒体曲目正在出声,以新档位就地重载替换当前流(保住进度)。
// 仅限 playing/loading:idle(含启动回填时的恢复态)与 paused 不能被动开播。
useSettingsStore.subscribe((s) => {
  if (s.audioQuality !== usePlayerStore.getState().quality) {
    usePlayerStore.setState({ quality: s.audioQuality })
    const st = usePlayerStore.getState()
    if (st.currentTrack && st.currentTrack.source !== 'apple' && !st.currentTrack.url && (st.status === 'playing' || st.status === 'loading')) {
      void st.loadTrack(st.currentTrack, { startAt: st.position, contextId: st.contextId })
    }
  }
})

// 当前候选的平台被停用或登录失效时，终止旧会话并以剩余参与平台重建候选链。
useProviderStore.subscribe(() => {
  const active = activePlayback
  const candidateSource = active?.candidate?.source
  if (!active || !candidateSource || isProviderParticipating(candidateSource)) return
  const state = usePlayerStore.getState()
  if (!state.currentTrack) return
  active.resolver?.abort()
  void state.loadTrack(state.currentTrack, {
    startAt: state.position,
    contextId: state.contextId,
    autoplay: shouldAutoplayPlaybackReload(state.status),
  })
})

import { create } from 'zustand'
import { AudioEngine, type PlaybackStatus } from '../lib/audio-engine'
import { getPreloadedUrl, getPreloadedQuality, resolveSongUrl, trackCacheKey } from '../lib/track-preload'
import { findFallbackTrack } from '../lib/track-fallback'
import { SOURCE_BRAND } from '../lib/source-brand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import type { Track, AudioQuality, MusicSource } from '../types/domain'

const FALLBACK_UNPLAYABLE_MESSAGE = '这首歌暂时无法播放，可以换一首试试'

// 听歌打卡门槛:播满 20 秒或过半(取更短者)才算"真的听了",避免快速切歌也上报打卡
const SCROBBLE_MIN_SECONDS = 20

/** 切歌前把上一首上报听歌打卡(可选实现,如 QQ/本地无对应接口时静默跳过)。 */
function maybeScrobble(track: Track | null, contextId: unknown, elapsedSeconds: number, durationSeconds: number): void {
  if (!track || durationSeconds <= 0) return
  if (elapsedSeconds < Math.min(SCROBBLE_MIN_SECONDS, durationSeconds * 0.6)) return
  void serviceFor(track.source).reportPlayback?.(track.id, { sourceId: contextId ?? undefined, seconds: elapsedSeconds })
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
  /** 跨音源兜底生效时,实际出声的音源(与 currentTrack.source 不同);正常播放为 null。 */
  fallbackSource: MusicSource | null
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
  loadTrack(track: Track, opts?: { startAt?: number; contextId?: unknown }): Promise<void>
  _engine(): AudioEngine
}

let engine: AudioEngine | null = null

// 自然播完的后续走序（切下一首/单曲重播）由 playlist store 决定;
// 用注册回调解耦,避免 player → playlist 反向导入成环。
let onTrackEnded: (() => void) | null = null
export function registerTrackEndedHandler(cb: () => void): void {
  onTrackEnded = cb
}

// loadTrack 会话计数:兜底搜索/URL 解析都是异步窗口,期间用户切歌要丢弃过期结果
let loadSession = 0

// 睡眠定时器「播完当前曲再停」:置位后自然播完不走 next,改调该回调(由 sleep-timer store 注册)
let stopAfterCurrentCb: (() => void) | null = null
export function setStopAfterCurrent(cb: (() => void) | null): void {
  stopAfterCurrentCb = cb
}

export const usePlayerStore = create<PlayerStore>((set, get) => {
  function ensureEngine(): AudioEngine {
    if (engine) return engine
    engine = new AudioEngine({
      onPosition: (s) => set({ position: s }),
      onDuration: (d) => set({ duration: d }),
      onStatus: (status) => set({ status }),
      onEnded: () => {
        set({ status: 'paused', position: 0 })
        if (stopAfterCurrentCb) {
          const cb = stopAfterCurrentCb
          stopAfterCurrentCb = null
          cb()
        } else {
          onTrackEnded?.()
        }
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
    fallbackSource: null,
    contextId: null,
    rate: 1,

    play() {
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
      ensureEngine().pause()
    },
    toggle() {
      const s = get().status
      if (s === 'playing') get().pause()
      else get().play()
    },
    seek(seconds) {
      ensureEngine().seek(seconds)
      set({ position: seconds })
    },
    setVolume(v) {
      ensureEngine().setVolume(v)
      set({ volume: v })
    },
    setQuality(q) {
      // 音质以 settings 为单一来源（含持久化），经下方订阅回流到本 store
      useSettingsStore.getState().setAudioQuality(q)
    },
    setRate(r) {
      ensureEngine().setPlaybackRate(r)
      set({ rate: r })
    },

    async loadTrack(track, opts) {
      const eng = ensureEngine()
      const session = ++loadSession
      const startAt = opts?.startAt ?? 0
      const nextContextId = opts?.contextId ?? null
      const prev = get()
      // 真正切歌(而非同曲重载:音质切换/断线恢复)才上报上一首的听歌打卡
      if (prev.currentTrack && String(prev.currentTrack.id) !== String(track.id)) {
        maybeScrobble(prev.currentTrack, prev.contextId, prev.position, prev.duration)
      }
      // Track.duration 约定为毫秒,store.duration 是秒(引擎元数据就绪后会覆盖)
      set({ currentTrack: track, source: track.source, fallbackSource: null, contextId: nextContextId, status: 'loading', position: startAt, duration: (track.duration ?? 0) / 1000, currentQuality: null })
      // 优先级:曲目自带直链 → 预加载缓存(相邻曲目已提前解析) → 现场解析
      let url = track.url ?? getPreloadedUrl(track, get().quality)
      let qualityLabel: string | null = track.url ? null : (getPreloadedQuality(track, get().quality) ?? null)
      // 磁盘缓存 key 跟着"实际出声的曲目"走(兜底时是对侧曲目);自带直链的音质未知,不缓存
      let cacheTrack: Track | null = track.url ? null : track
      let unplayableMessage = FALLBACK_UNPLAYABLE_MESSAGE
      if (!url) {
        try {
          const res = await resolveSongUrl(track, get().quality)
          if (session !== loadSession) return
          url = res.url
          qualityLabel = res.quality ?? null
          if (!url) unplayableMessage = res.restriction?.message || res.message || FALLBACK_UNPLAYABLE_MESSAGE
        } catch {
          if (session !== loadSession) return
        }
      }
      // 当前音源放不了(VIP 付费墙/灰色下架):尝试对侧音源同曲兜底
      if (!url && useSettingsStore.getState().crossSourceFallback) {
        const fallback = await findFallbackTrack(track)
        if (session !== loadSession) return
        if (fallback) {
          try {
            const res = await resolveSongUrl(fallback, get().quality)
            if (session !== loadSession) return
            if (res.url) {
              url = res.url
              qualityLabel = res.quality ?? null
              cacheTrack = fallback
              set({ fallbackSource: fallback.source })
              useToastStore.getState().show(`已从${SOURCE_BRAND[fallback.source].label}换源播放`)
            }
          } catch {
            if (session !== loadSession) return
          }
        }
      }
      if (!url) {
        set({ status: 'idle' })
        useToastStore.getState().show(unplayableMessage)
        return
      }
      set({ currentQuality: qualityLabel })
      eng.load(url, startAt, cacheTrack ? trackCacheKey(cacheTrack, get().quality) : undefined)
      eng.setVolume(get().volume)
      void eng.play()
    },

    _engine: ensureEngine
  }
})

// settings.audioQuality 变化时（含启动后 loadFromLocal 回填）同步到播放器;
// 若此刻有流媒体曲目正在出声,以新档位就地重载替换当前流(保住进度)。
// 仅限 playing/loading:idle(含启动回填时的恢复态)与 paused 不能被动开播。
useSettingsStore.subscribe((s) => {
  if (s.audioQuality !== usePlayerStore.getState().quality) {
    usePlayerStore.setState({ quality: s.audioQuality })
    const st = usePlayerStore.getState()
    if (st.currentTrack && !st.currentTrack.url && (st.status === 'playing' || st.status === 'loading')) {
      void st.loadTrack(st.currentTrack, { startAt: st.position, contextId: st.contextId })
    }
  }
})

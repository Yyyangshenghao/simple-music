import { create } from 'zustand'
import { AudioEngine, type PlaybackStatus } from '../lib/audio-engine'
import { getPreloadedUrl, resolveSongUrl } from '../lib/track-preload'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import type { Track, AudioQuality, MusicSource } from '../types/domain'

const FALLBACK_UNPLAYABLE_MESSAGE = '这首歌暂时无法播放，可以换一首试试'

interface PlayerStore {
  status: PlaybackStatus
  currentTrack: Track | null
  position: number
  duration: number
  volume: number
  quality: AudioQuality
  source: MusicSource
  play(): void
  pause(): void
  toggle(): void
  seek(seconds: number): void
  setVolume(v: number): void
  setQuality(q: AudioQuality): void
  loadTrack(track: Track, opts?: { startAt?: number }): Promise<void>
  _engine(): AudioEngine
}

let engine: AudioEngine | null = null

// 自然播完的后续走序（切下一首/单曲重播）由 playlist store 决定;
// 用注册回调解耦,避免 player → playlist 反向导入成环。
let onTrackEnded: (() => void) | null = null
export function registerTrackEndedHandler(cb: () => void): void {
  onTrackEnded = cb
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
        onTrackEnded?.()
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
    source: 'netease',

    play() {
      const eng = ensureEngine()
      // 重启恢复态:有曲目但引擎还没加载过源,先按断点位置重新解析加载
      const { currentTrack, position } = get()
      if (!eng.hasSource && currentTrack) {
        void get().loadTrack(currentTrack, { startAt: position })
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

    async loadTrack(track, opts) {
      const eng = ensureEngine()
      const startAt = opts?.startAt ?? 0
      // Track.duration 约定为毫秒,store.duration 是秒(引擎元数据就绪后会覆盖)
      set({ currentTrack: track, source: track.source, status: 'loading', position: startAt, duration: (track.duration ?? 0) / 1000 })
      // 优先级:曲目自带直链 → 预加载缓存(相邻曲目已提前解析) → 现场解析
      let url = track.url ?? getPreloadedUrl(track, get().quality)
      if (!url) {
        try {
          const res = await resolveSongUrl(track, get().quality)
          url = res.url
          if (!url) {
            useToastStore.getState().show(res.restriction?.message || res.message || FALLBACK_UNPLAYABLE_MESSAGE)
          }
        } catch {
          set({ status: 'idle' })
          useToastStore.getState().show(FALLBACK_UNPLAYABLE_MESSAGE)
          return
        }
      }
      if (!url) {
        set({ status: 'idle' })
        return
      }
      eng.load(url, startAt)
      eng.setVolume(get().volume)
      void eng.play()
    },

    _engine: ensureEngine
  }
})

// settings.audioQuality 变化时（含启动后 loadFromLocal 回填）同步到播放器
useSettingsStore.subscribe((s) => {
  if (s.audioQuality !== usePlayerStore.getState().quality) {
    usePlayerStore.setState({ quality: s.audioQuality })
  }
})

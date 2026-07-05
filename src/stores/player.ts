import { create } from 'zustand'
import { AudioEngine, type PlaybackStatus } from '../lib/audio-engine'
import { api } from '../lib/api'
import { useSettingsStore } from './settings'
import type { Track, AudioQuality, MusicSource } from '../types/domain'

interface SongUrlResponse {
  url?: string
}

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
  loadTrack(track: Track): Promise<void>
  _engine(): AudioEngine
}

let engine: AudioEngine | null = null

export const usePlayerStore = create<PlayerStore>((set, get) => {
  function ensureEngine(): AudioEngine {
    if (engine) return engine
    engine = new AudioEngine({
      onPosition: (s) => set({ position: s }),
      onDuration: (d) => set({ duration: d }),
      onStatus: (status) => set({ status }),
      onEnded: () => set({ status: 'paused', position: 0 })
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
      void ensureEngine().play()
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

    async loadTrack(track) {
      const eng = ensureEngine()
      set({ currentTrack: track, source: track.source, status: 'loading', position: 0, duration: track.duration ?? 0 })
      let url = track.url
      if (!url) {
        const path = track.source === 'qq' ? '/api/qq/song/url' : '/api/song/url'
        const params =
          track.source === 'qq'
            ? { mid: String(track.mid ?? track.id ?? ''), quality: get().quality }
            : { id: String(track.id ?? ''), quality: get().quality }
        try {
          const res = await api.get<SongUrlResponse>(path, params)
          url = res.url
        } catch {
          set({ status: 'idle' })
          return
        }
      }
      if (!url) {
        set({ status: 'idle' })
        return
      }
      eng.load(url)
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

import { create } from 'zustand'
import type { Track } from '../types/domain'
import { AudioEngine } from '../lib/audio-engine'
import { api } from '../lib/api'
import { AppleMusicPlayback } from '../lib/apple-music-playback'
import { appleAudioSpectrum } from '../lib/apple-audio-spectrum'
import { getPreloadedResolution, audioDiskCacheKey } from '../lib/track-preload'
import { PlaybackResolver } from '../lib/playback-resolver'
import { createPlaybackCore, type PlaybackPlayer } from '../lib/playback-core'
import { fetchOfflineStatus, offlineFileUrl } from '../lib/offline-cache'
import { serviceFor } from '../lib/service-registry'
import { resolvePending } from '../lib/queue-details'
import { beginPlaybackIntent } from '../lib/playback-intent'
import { isProviderId } from '../providers/types'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import { isProviderParticipating, useProviderStore } from './providers'
import { expireProviderAccount } from './provider-auth'
import { providerAccountSession } from '../lib/provider-account-session'
import { isPlaybackSpectrumRequested } from '../lib/playback-host-observation'
import { accompanimentTrack, accompanimentsForTrack, findAccompaniment } from '../lib/karaoke-library'
import { useKaraokeStore } from './karaoke'

let core: ReturnType<typeof createPlaybackCore>

// store 仍是当前唯一状态容器；宿主适配只提供能力，不维护第二份播放状态。
export const usePlayerStore = create<PlaybackPlayer>((set, get) => {
  core = createPlaybackCore({
    getState: get,
    setState: set,
    createEngine: (callbacks) => new AudioEngine(callbacks),
    createApplePlayback: (onState) => new AppleMusicPlayback(onState),
    createResolver: (track, quality, preferences) => new PlaybackResolver(
      track, quality, preferences, { isParticipating: isProviderParticipating }
    ),
    getQuality: () => useSettingsStore.getState().audioQuality,
    setQuality: (quality) => useSettingsStore.getState().setAudioQuality(quality),
    subscribeQuality: (listener) => useSettingsStore.subscribe((state) => listener(state.audioQuality)),
    getSourcePreferences: () => useProviderStore.getState(),
    isParticipating: (source) => isProviderParticipating(source),
    subscribeProviders: (listener) => useProviderStore.subscribe(listener),
    subscribeAccompaniments: (listener) => useKaraokeStore.subscribe((state, previous) => {
      if (state.items !== previous.items) listener()
    }),
    resolvePending,
    localAudioUrl: (track) => api.url('/api/local/audio', { id: String(track.id) }),
    findAccompaniment: (track, id) => {
      const { items, played } = useKaraokeStore.getState()
      const item = id === undefined ? findAccompaniment(track, items, useSettingsStore.getState().karaokeModel, played)
        : accompanimentsForTrack(track, items).find(item => item.id === id && item.available)
      return item ? accompanimentTrack(item) : null
    },
    fetchOfflineStatus,
    offlineFileUrl,
    getPreloadedResolution: (track, quality) => getPreloadedResolution(track, quality),
    audioDiskCacheKey: (track, quality) => audioDiskCacheKey(track, quality),
    accountSession: (source) => isProviderParticipating(source) ? providerAccountSession(source) : null,
    capturePlaybackAccount: async (source) => serviceFor(source).getPlaybackAccountToken?.() ?? null,
    reportPlayback: async (track, options) => {
      const service = serviceFor(track.source)
      if (!service.reportPlayback) return
      await service.reportPlayback(track.id, track.source === 'qq' ? { ...options, songId: track.qqId } : options).catch((error) => {
        if (isProviderId(track.source)) expireProviderAccount(track.source, error)
      })
    },
    beginIntent: (kind) => { beginPlaybackIntent(kind) },
    notify: (message) => useToastStore.getState().show(message),
    appleSpectrum: {
      requestCapture: () => {
        if (window.desktop?.playbackRole === 'host' && !isPlaybackSpectrumRequested()) return
        void window.desktop?.startAppleAudioCapture?.().catch(() => {})
      },
      stop: () => appleAudioSpectrum.stop(),
      read: () => appleAudioSpectrum.read(),
    },
  })
  return core.player
})

/** 由渲染宿主启动一次；可视层卸载不停止核心，窗口最终退出后才释放。 */
export function startPlaybackCore(): () => void {
  core.start()
  return core.dispose
}

/** 主进程关闭 API 前等待当前收听与已发出的上报完成。 */
export function flushListeningReports(): Promise<void> {
  return core.flushListeningReports()
}

export function registerTrackEndedHandler(cb: () => void): void {
  core.registerTrackEndedHandler(cb)
}

export function registerPlayFromQueueHandler(cb: () => void): void {
  core.registerPlayFromQueueHandler(cb)
}

export function registerTrackEndedInterceptor(cb: () => boolean): () => void {
  return core.registerTrackEndedInterceptor(cb)
}

export function setStopAfterCurrent(cb: (() => void) | null): void {
  core.setStopAfterCurrent(cb)
}

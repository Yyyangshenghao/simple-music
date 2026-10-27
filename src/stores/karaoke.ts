import { api } from '../lib/api'
import { createKaraokeQueue } from '../lib/karaoke/queue'
import { createRemoteSeparator } from '../lib/karaoke/remote-separator'
import { PlaybackResolver } from '../lib/playback-resolver'
import { fetchOfflineStatus, offlineFileUrl } from '../lib/offline-cache'
import { resolvePending } from '../lib/queue-details'
import { useProviderStore, isProviderParticipating } from './providers'
import { useSettingsStore } from './settings'
import type { KaraokeLibrary, KaraokeResources, Accompaniment } from '../types/karaoke'

const queue = createKaraokeQueue({
  port: createRemoteSeparator(),
  library: () => api.get<KaraokeLibrary>('/api/karaoke/library'),
  resources: (model, duration, signal) => api.get<KaraokeResources>('/api/karaoke/resources', { model, duration }, { signal }),
  storage: () => localStorage,
  directory: directory => api.post('/api/karaoke/library/directory', { directory }),
  remove: item => api.post('/api/karaoke/library/delete', { id: item.id, generatedAt: item.generatedAt }),
  save: (job, key) => api.post<Accompaniment>('/api/karaoke/library/save', { model: job.model, key, track: job.track, directory: job.directory }, undefined, { timeoutMs: 120_000 }),
  async resolve(original, signal) {
    const track = await resolvePending(original)
    signal.throwIfAborted()
    if (track.source === 'local') return { key: `local:${String(track.id)}`, src: api.url('/api/local/audio', { id: String(track.id) }) }
    if (track.source === 'apple') throw new Error('Apple Music 受版权保护，无法生成伴奏')
    const offline = await fetchOfflineStatus(track)
    signal.throwIfAborted()
    const cached = offlineFileUrl(offline, track)
    if (cached) return { key: `${offline.resolved?.source ?? track.source}:${String(offline.resolved?.id ?? track.mid ?? track.id)}`, src: cached }
    const resolver = new PlaybackResolver(track, useSettingsStore.getState().audioQuality, useProviderStore.getState(), { isParticipating: isProviderParticipating })
    const abort = () => resolver.abort()
    signal.addEventListener('abort', abort, { once: true })
    try {
      const candidate = await resolver.next()
      signal.throwIfAborted()
      if (!candidate) throw new Error(resolver.failureMessage ?? '歌曲音频不可用，请登录对应平台后重试')
      if (candidate.trial) throw new Error('试听片段无法生成完整伴奏')
      return { key: `${candidate.source}:${String(candidate.track.mid ?? candidate.track.id)}`, src: candidate.url }
    } finally { signal.removeEventListener('abort', abort); resolver.abort() }
  },
})

export const useKaraokeStore = queue.store
export const initKaraokeQueueRuntime = queue.start

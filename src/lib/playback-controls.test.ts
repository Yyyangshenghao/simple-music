import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

vi.mock('../stores/player', async () => {
  const { create } = await import('zustand')
  const usePlayerStore = create((set) => ({
    currentTrack: null, position: 0, volume: 0.8, quality: 'lossless', status: 'paused', contextId: null,
    pause: () => set({ status: 'paused' }),
    setVolume: (volume: number) => set({ volume }),
    loadTrack: async (track: Track, opts?: { startAt?: number; contextId?: unknown; autoplay?: boolean }) => {
      set({ currentTrack: track, position: opts?.startAt ?? 0, contextId: opts?.contextId ?? null, status: opts?.autoplay === false ? 'paused' : 'playing' })
    },
  }))
  return { usePlayerStore, registerTrackEndedHandler: vi.fn(), registerPlayFromQueueHandler: vi.fn() }
})
vi.mock('./track-preload', () => ({ preloadTracks: vi.fn() }))
vi.mock('./service-registry', () => ({ serviceFor: () => ({
  getDailySongs: async () => ['feed-1', 'feed-2'].map(id => ({ provider: 'netease', source: 'netease', type: 'song', id, name: id, artist: '歌手', artists: [], duration: 180_000 })),
  getLyrics: async () => [],
  getRecommendPlaylists: async () => [],
}) }))

import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useProviderStore } from '../stores/providers'
import { useShuangeStore } from '../stores/shuange'
import { __resetShuangeRecommendationProfile } from './shuange-recommendation'
import { stepPlayback } from './playback-controls'

afterEach(() => {
  if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
  vi.restoreAllMocks()
})

it('外部上下首切换真实刷歌会话，保持原队列及退出恢复的断点', async () => {
  __resetShuangeRecommendationProfile()
  useProviderStore.setState({
    playbackOrder: ['netease'],
    byId: { netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' } },
  })
  const queue: Track[] = [1, 2].map(id => ({ provider: 'netease', source: 'netease', type: 'song', id, name: String(id), artist: '歌手', artists: [], duration: 180_000 }))
  usePlaylistStore.getState().setQueue(queue, 1, 'original-playlist')
  usePlayerStore.setState({ position: 42, status: 'playing' })
  const originalOrder = usePlaylistStore.getState().shuffleOrder
  await useShuangeStore.getState().enter()
  const feed = useShuangeStore.getState().feed
  stepPlayback(1)
  await vi.waitFor(() => expect(usePlayerStore.getState().currentTrack).toBe(feed[1]))
  stepPlayback(-1)
  await vi.waitFor(() => expect(usePlayerStore.getState().currentTrack).toBe(feed[0]))
  expect(usePlaylistStore.getState()).toMatchObject({ queue, queueIndex: 1, queueContextId: 'original-playlist' })
  expect(usePlaylistStore.getState().shuffleOrder).toBe(originalOrder)
  useShuangeStore.getState().leave()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: queue[1], position: 42, status: 'playing' })
  expect(usePlaylistStore.getState()).toMatchObject({ queue, queueIndex: 1, queueContextId: 'original-playlist' })
})

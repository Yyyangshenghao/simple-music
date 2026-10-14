import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore, registerTrackEndedHandler, registerPlayFromQueueHandler } from './player'
import { useSettingsStore } from './settings'
import { isProviderParticipating, useProviderStore } from './providers'
import { serviceFor } from '../lib/service-registry'
import { preloadTracks } from '../lib/track-preload'
import { fetchQueueDetails, resolvePending } from '../lib/queue-details'
import {
  appendQueueTrack,
  appendQueueTracks,
  createQueueState,
  getQueueStep,
  moveQueueTrack,
  moveQueueTrackNext,
  removeQueueTrack,
  type QueueState,
} from '../lib/queue-state'
import { isProviderId } from '../providers/types'
import { beginPlaybackIntent } from '../lib/playback-intent'
import type { ProviderId } from '../providers/types'
import type { Playlist, Track, ShelfMode } from '../types/domain'

interface PlaylistStore extends QueueState {
  playlists: Playlist[]
  /** 这批用户歌单属于哪个平台；平台入口切换后 UI 需显式重拉。 */
  playlistsSource: ProviderId | null
  currentPlaylist: Playlist | null
  shelfVisible: boolean
  shelfMode: ShelfMode
  loadUserPlaylists(source: ProviderId): Promise<void>
  setCurrentPlaylist(p: Playlist | null): void
  setQueue(tracks: Track[], startIndex?: number, contextId?: unknown): void
  clearQueue(): void
  addToQueue(track: Track): void
  addManyToQueue(tracks: Track[], offline?: boolean): number | Promise<number>
  /** 按面板显示位置移动曲目；随机模式下移动实际洗牌顺序。 */
  moveQueueItem(fromDisplayIndex: number, toDisplayIndex: number): void
  playNextInQueue(index: number): void
  removeQueueItem(index: number): void
  /** 补全可见范围的占位曲目，不改变播放位置。 */
  ensureQueueDetails(indices: number[]): Promise<void>
  playAt(index: number, opts?: { preservePlaybackIntent?: boolean }): void
  next(): void
  prev(): void
  /** 自然播完的走序:单曲循环原地重播,其余同 next()。 */
  handleTrackEnded(): void
  toggleShelf(): void
  setShelfMode(mode: ShelfMode): void
}

/** 计算目标时只回写懒重建的随机顺序，预加载不改变当前播放下标。 */
function stepIndex(
  s: Pick<PlaylistStore, 'queue' | 'queueIndex' | 'shuffleOrder'>,
  set: (partial: Partial<PlaylistStore>) => void,
  dir: 1 | -1
): number {
  const step = getQueueStep(s, useSettingsStore.getState().playMode, dir)
  if (step.shuffleOrder !== s.shuffleOrder) set({ shuffleOrder: step.shuffleOrder })
  return step.index
}

// 切歌落定 1 秒后预载前/后曲目(URL 预解析 + 封面预热),不与当前曲目起播抢网络;
// 快速连点只保留最后一次。走序与 next/prev 一致(含随机模式的洗牌排列)。
let preloadTimer: ReturnType<typeof setTimeout> | null = null
let userPlaylistsSession = 0
let playAtSession = 0

function schedulePreloadNeighbors() {
  if (preloadTimer) clearTimeout(preloadTimer)
  preloadTimer = setTimeout(() => {
    preloadTimer = null
    const s = usePlaylistStore.getState()
    if (s.queueIndex < 0 || s.queue.length < 2) return
    const applyPartial = (p: Partial<PlaylistStore>) => usePlaylistStore.setState(p)
    const targets: Track[] = []
    for (const dir of [+1, -1] as const) {
      const idx = stepIndex(usePlaylistStore.getState(), applyPartial, dir)
      const t = usePlaylistStore.getState().queue[idx]
      if (
        idx !== s.queueIndex
        && t
        && (!isProviderId(t.source) || isProviderParticipating(t.source))
        && !targets.includes(t)
      ) targets.push(t)
    }
    if (!targets.length) return
    const player = usePlayerStore.getState()
    // 离开普通队列进入刷歌后，旧的延时任务不能覆盖刷歌刚建立的相邻预加载窗口。
    if (String(player.contextId ?? '').startsWith('shuange:')) return
    preloadTracks(targets, player.quality, player.currentTrack)
  }, 1000)
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  playlistsSource: null,
  currentPlaylist: null,
  ...createQueueState([]),
  shelfVisible: false,
  shelfMode: 'dynamic',

  async loadUserPlaylists(source) {
    const session = ++userPlaylistsSession
    const providerState = useProviderStore.getState().byId[source]
    if (!providerState.enabled || providerState.auth !== 'authenticated') {
      set({ playlists: [], playlistsSource: source })
      return
    }
    const service = serviceFor(source)
    if (!service.getUserPlaylists) {
      set({ playlists: [], playlistsSource: source })
      return
    }
    try {
      const playlists = await service.getUserPlaylists()
      if (session !== userPlaylistsSession || !isProviderParticipating(source)) return
      set({ playlists, playlistsSource: source })
    } catch {
      if (session !== userPlaylistsSession) return
      set({ playlists: [], playlistsSource: source })
    }
  },

  setCurrentPlaylist(p) {
    set({ currentPlaylist: p })
  },

  setQueue(tracks, startIndex = 0, contextId = null) {
    beginPlaybackIntent()
    set(createQueueState(tracks, contextId))
    if (tracks.length) get().playAt(startIndex)
  },

  clearQueue() {
    ++playAtSession
    if (preloadTimer) clearTimeout(preloadTimer)
    preloadTimer = null
    set(createQueueState([]))
    usePlayerStore.getState().stop()
  },

  addToQueue(track) {
    set((state) => appendQueueTrack(state, track))
  },

  addManyToQueue(tracks, offline = false) {
    const state = get()
    const incoming = tracks.filter((track) => {
      // 离线列表已确认网易/QQ 文件可用，不要求账号参与；Apple 仍依赖官网会话。
      return (offline && track.source !== 'apple') || !isProviderId(track.source) || isProviderParticipating(track.source)
    })
    const update = appendQueueTracks(state, incoming)
    if (!update) return 0
    set(update)
    return update.queue.length - state.queue.length
  },

  moveQueueItem(fromDisplayIndex, toDisplayIndex) {
    const update = moveQueueTrack(get(), fromDisplayIndex, toDisplayIndex, useSettingsStore.getState().playMode)
    if (!update) return
    set(update)
    schedulePreloadNeighbors()
  },

  playNextInQueue(index) {
    const update = moveQueueTrackNext(get(), index, useSettingsStore.getState().playMode)
    if (!update) return
    set(update)
    schedulePreloadNeighbors()
  },

  removeQueueItem(index) {
    const update = removeQueueTrack(get(), index)
    if (!update) return
    set(update)
    schedulePreloadNeighbors()
  },

  async ensureQueueDetails(indices) {
    const queue = get().queue
    const tracks = [...new Set(indices.map((index) => queue[index]).filter((track) => track?.pending))]
    if (!tracks.length) return
    const details = await fetchQueueDetails(tracks)
    if (!details.size) return
    // 用原曲目对象定位，重排后仍可补全；换队列或移除后的旧响应不会写错位置。
    set((state) => {
      const nextQueue = state.queue.map((track) => details.get(track) ?? track)
      return nextQueue.some((track, index) => track !== state.queue[index]) ? { queue: nextQueue } : state
    })
  },

  playAt(index, opts) {
    const track = get().queue[index]
    if (!track) return
    // 网易/QQ 交给播放器先查离线文件；Apple 仍要求可用的官网会话。
    if (track.source === 'apple' && !isProviderParticipating(track.source)) return
    const session = ++playAtSession
    set({ queueIndex: index })
    schedulePreloadNeighbors()
    const contextId = get().queueContextId
    void usePlayerStore.getState().loadTrack(track, { contextId, ...opts })
    if (!track.pending) return
    void resolvePending(track).then((resolved) => {
      const { queue, queueIndex } = get()
      // 等待补详情期间允许队列重排；若当前播放目标已变则丢弃。
      if (session !== playAtSession || (queue[queueIndex] !== track && queue[queueIndex] !== resolved)) return
      const nextQueue = [...queue]
      nextQueue[queueIndex] = resolved
      set({ queue: nextQueue })
    })
  },

  next() {
    get().playAt(stepIndex(get(), set, +1))
  },

  prev() {
    get().playAt(stepIndex(get(), set, -1))
  },

  handleTrackEnded() {
    if (useSettingsStore.getState().playMode === 'one') {
      const player = usePlayerStore.getState()
      if (!player.currentTrack) return
      player.seek(0)
      player.play({ preservePlaybackIntent: true })
      return
    }
    get().playAt(stepIndex(get(), set, +1), { preservePlaybackIntent: true })
  },

  toggleShelf() {
    set((s) => ({ shelfVisible: !s.shelfVisible }))
  },

  setShelfMode(mode) {
    set({ shelfMode: mode })
  }
}))

// 自然播完后的走序(列表循环/随机切下一首,单曲循环原地重播)
registerTrackEndedHandler(() => usePlaylistStore.getState().handleTrackEnded())
registerPlayFromQueueHandler(() => usePlaylistStore.getState().next())

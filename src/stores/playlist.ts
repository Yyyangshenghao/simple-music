import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore, registerTrackEndedHandler } from './player'
import { useSettingsStore } from './settings'
import { isProviderParticipating, useProviderStore } from './providers'
import { serviceFor } from '../lib/service-registry'
import { preloadTracks } from '../lib/track-preload'
import { isProviderId } from '../providers/types'
import type { ProviderId } from '../providers/types'
import type { Playlist, Track, ShelfMode } from '../types/domain'

/** pending 占位曲目:先按 id 补详情;失败则去掉 pending 标记凭 id 兜底直接播(网易播放 URL 只需 id)。 */
async function resolvePending(track: Track): Promise<Track> {
  if (isProviderId(track.source) && !isProviderParticipating(track.source)) {
    return { ...track, pending: false, name: track.name || '未知曲目' }
  }
  try {
    const [full] = await serviceFor(track.source).getTracksByIds([track.id])
    if (full) return full
  } catch {
    /* 详情失败走兜底 */
  }
  return { ...track, pending: false, name: track.name || '未知曲目' }
}

/** Fisher-Yates 洗牌出 [0, n) 的随机排列。 */
function shuffledIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

interface PlaylistStore {
  playlists: Playlist[]
  /** 这批用户歌单属于哪个平台；平台入口切换后 UI 需显式重拉。 */
  playlistsSource: ProviderId | null
  currentPlaylist: Playlist | null
  queue: Track[]
  queueIndex: number
  /** 当前队列的播放语境(来源歌单/专辑 id);供听歌打卡上报用,没有语境(搜索/歌手页)则为 null。 */
  queueContextId: unknown
  /** 随机模式的洗牌排列(队列下标序列);长度与 queue 不一致时懒重建。 */
  shuffleOrder: number[]
  shelfVisible: boolean
  shelfMode: ShelfMode
  loadUserPlaylists(source: ProviderId): Promise<void>
  setCurrentPlaylist(p: Playlist | null): void
  setQueue(tracks: Track[], startIndex?: number, contextId?: unknown): void
  addToQueue(track: Track): void
  playAt(index: number): void
  next(): void
  prev(): void
  /** 自然播完的走序:单曲循环原地重播,其余同 next()。 */
  handleTrackEnded(): void
  toggleShelf(): void
  setShelfMode(mode: ShelfMode): void
}

/** 按播放模式算 next/prev 的目标下标;随机模式沿洗牌排列循环走,长度失配时懒重建。 */
function stepIndex(
  s: Pick<PlaylistStore, 'queue' | 'queueIndex' | 'shuffleOrder'>,
  set: (partial: Partial<PlaylistStore>) => void,
  dir: 1 | -1
): number {
  const len = s.queue.length
  if (!len) return -1
  if (useSettingsStore.getState().playMode !== 'shuffle') {
    return (s.queueIndex + dir + len) % len
  }
  let order = s.shuffleOrder
  if (order.length !== len) {
    order = shuffledIndices(len)
    set({ shuffleOrder: order })
  }
  const pos = order.indexOf(s.queueIndex)
  return order[(pos + dir + len) % len]
}

// 切歌落定 1 秒后预载前/后曲目(URL 预解析 + 封面预热),不与当前曲目起播抢网络;
// 快速连点只保留最后一次。走序与 next/prev 一致(含随机模式的洗牌排列)。
let preloadTimer: ReturnType<typeof setTimeout> | null = null
let userPlaylistsSession = 0

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
  queue: [],
  queueIndex: -1,
  queueContextId: null,
  shuffleOrder: [],
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
    set({ queue: tracks, queueIndex: -1, queueContextId: contextId, shuffleOrder: shuffledIndices(tracks.length) })
    if (tracks.length) get().playAt(startIndex)
  },

  addToQueue(track) {
    set((s) => ({ queue: [...s.queue, track] }))
  },

  playAt(index) {
    const track = get().queue[index]
    if (!track) return
    if (isProviderId(track.source) && !isProviderParticipating(track.source)) return
    set({ queueIndex: index })
    schedulePreloadNeighbors()
    const contextId = get().queueContextId
    if (!track.pending) {
      void usePlayerStore.getState().loadTrack(track, { contextId })
      return
    }
    void resolvePending(track).then((resolved) => {
      const { queue, queueIndex } = get()
      // 等待补详情期间用户已切歌/换队列:丢弃
      if (queueIndex !== index || String(queue[index]?.id) !== String(track.id)) return
      const nextQueue = [...queue]
      nextQueue[index] = resolved
      set({ queue: nextQueue })
      void usePlayerStore.getState().loadTrack(resolved, { contextId })
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
      player.play()
      return
    }
    get().next()
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
